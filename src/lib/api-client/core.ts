import { can, resolveGrants, type Action, type AuditEvent, type Grants, type RoleCode, type User, type WorkflowInstance, type ApprovalStep, settingsToMap } from '../shared';
import { db, persist, nextNo, uid } from './db';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400, public fields?: Record<string, string>) { super(message); }
}

export const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

// ── Session ────────────────────────────────────────────────────────────────
let current: (User & { grants: Grants }) | null = null;
const SESSION_KEY = 'delbros.session';
try {
  const id = sessionStorage.getItem(SESSION_KEY);
  const u = id ? db.users.find((x) => x.userId === id) : undefined;
  if (u) current = { ...strip(u), grants: resolveGrants(u.roles, u.overrides) };
} catch { /* ignore */ }

function strip(u: (typeof db.users)[number]): User {
  const { password: _p, failed: _f, lockedUntil: _l, overrides: _o, ...rest } = u;
  return rest;
}
export function setSession(u: (typeof db.users)[number] | null) {
  current = u ? { ...strip(u), grants: resolveGrants(u.roles, u.overrides) } : null;
  try { if (u) sessionStorage.setItem(SESSION_KEY, u.userId); else sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
export function me() {
  if (!current) throw new ApiError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
  return current;
}
export const session = () => current;

export function requirePerm(resource: string, action: Action = 'view') {
  const u = me();
  if (u.realm !== 'INTERNAL') throw new ApiError('FORBIDDEN', 'Not available in the portal.', 403);
  if (!can(u.grants, resource, action)) throw new ApiError('FORBIDDEN', `You do not have ${action} permission on ${resource}.`, 403);
  return u;
}

/** Branch scope (docs/01 §6): HO users see all; branch users only their granted branches. */
export function inScope(branchCode?: string) {
  const u = current;
  if (!u || u.realm !== 'INTERNAL' || !branchCode) return true;
  return u.branchAccess === 'ALL' || u.branchAccess.includes(branchCode) || u.branchCode === branchCode;
}

export const settings = () => settingsToMap(db.settings) as Record<string, number & string>;

// ── Audit (append-only) ────────────────────────────────────────────────────
export function audit(action: string, entityType: string, entityId: string, after?: unknown, reason?: string, before?: unknown) {
  const snap = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))); // freeze values so later edits to the record can't alter the log
  const ev: AuditEvent = { id: uid(), at: new Date().toISOString(), actor: current?.userId ?? 'system', actorRole: current?.roles[0] ?? 'SYSTEM', action, entityType, entityId, before: snap(before), after: snap(after), reason,
    source: current ? `${current.realm === 'INTERNAL' ? 'Web (internal)' : 'Portal'} · ${typeof navigator !== 'undefined' ? navigator.platform || 'browser' : 'server'}` : 'System job' };
  sealAudit(ev, db.audit[0]?.hash);
  db.audit.unshift(ev);
}
/** NFR-AUD-001 tamper evidence: each event carries hash(prevHash + content). Any edit/delete breaks the chain. */
export function auditHash(prev: string, e: AuditEvent) {
  const s = `${prev}|${e.id}|${e.at}|${e.actor}|${e.action}|${e.entityType}|${e.entityId}|${JSON.stringify(e.before ?? null)}|${JSON.stringify(e.after ?? null)}|${e.reason ?? ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export function sealAudit(e: AuditEvent, prev = 'GENESIS') { e.prevHash = prev; e.hash = auditHash(prev, e); return e; }

// ── Notifications (rule-driven, docs/06 §3) ────────────────────────────────
export function notify(eventType: string, title: string, body: string, opts: { link?: string; branchCode?: string; clientCode?: string; aeUserId?: string; extraUsers?: string[] } = {}) {
  const rule = db.notificationRules.find((r) => r.eventType === eventType && r.active);
  const recipients = new Set<string>(opts.extraUsers ?? []);
  if (rule) {
    for (const u of db.users) {
      if (u.realm !== 'INTERNAL') continue;
      const roleHit = u.roles.some((r) => rule.recipientRoles.includes(r));
      const branchHit = !opts.branchCode || u.branchAccess === 'ALL' || u.branchCode === opts.branchCode;
      if (roleHit && branchHit) recipients.add(u.userId);
    }
    if (rule.includeAe && opts.aeUserId) recipients.add(opts.aeUserId);
    if (rule.includeClient && opts.clientCode) db.users.filter((u) => u.clientCode === opts.clientCode).forEach((u) => recipients.add(u.userId));
  }
  const at = new Date().toISOString();
  for (const userId of recipients) {
    db.notifications.unshift({ id: uid(), at, title, body, link: opts.link, read: false, requiresAck: rule?.mode === 'Repeat until ack', userId });
  }
}

// ── Workflow / approval engine (docs/06 §1) ────────────────────────────────
type Handler = (wf: WorkflowInstance, approved: boolean) => void;
const handlers: Record<string, Handler> = {};
export const onWorkflowDone = (matrixCode: string, h: Handler) => { handlers[matrixCode] = h; };
/** SUP-05: per-approval-type escalation timer (wf.escalation_hours.<MATRIX>), falling back to the global timer. */
export const escalationHours = (matrixCode: string) => Number(settings()[`wf.escalation_hours.${matrixCode}`] ?? settings()['wf.escalation_hours'] ?? 48);

export function startWorkflow(matrixCode: string, title: string, subjectType: string, subjectId: string, steps: Omit<ApprovalStep, 'step' | 'decision'>[], amount?: number, branchCode?: string) {
  const esc = escalationHours(matrixCode);
  const wf: WorkflowInstance = {
    id: nextNo('WF', 'WF-', 5), matrixCode, title, subjectType, subjectId, amount, branchCode, requestedBy: me().userId, requestedAt: new Date().toISOString(),
    status: 'Pending', currentStep: 0,
    steps: steps.map((s, i) => ({ ...s, step: i + 1, decision: 'Pending', dueAt: i === 0 ? new Date(Date.now() + esc * 3_600_000).toISOString() : undefined })),
  };
  db.workflows.unshift(wf);
  notifyAssignees(wf);
  audit('workflow.started', subjectType, subjectId, { workflow: wf.id, matrixCode });
  return wf;
}

function notifyAssignees(wf: WorkflowInstance) {
  const step = wf.steps[wf.currentStep];
  if (!step) return;
  const users = db.users.filter((u) => u.realm === 'INTERNAL' && u.roles.some((r) => step.roles.includes(r))).map((u) => u.userId);
  notify('workflow.task', `Approval needed: ${wf.title}`, `${step.label}${wf.amount ? ` · ₱${wf.amount.toLocaleString('en-PH')}` : ''}`, { link: '/approvals', extraUsers: users });
}

/** Roles on the current step still waiting for a signature (multiset: ['EXEC_OFFICER','EXEC_OFFICER'] needs two). */
export function remainingRoles(step: ApprovalStep): RoleCode[] {
  const left = [...step.roles];
  for (const sig of (step.comment ?? '').split('|').filter(Boolean)) {
    const role = sig.split(':')[1] as RoleCode;
    const i = left.indexOf(role);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

export function canActOn(wf: WorkflowInstance, user: User) {
  if (wf.status !== 'Pending') return false;
  const step = wf.steps[wf.currentStep];
  if (!step) return false;
  if (wf.requestedBy === user.userId) return false; // segregation of duties
  const signed = (step.comment ?? '').split('|').filter(Boolean);
  if (signed.some((s) => s.startsWith(user.userId + ':'))) return false;
  const left = remainingRoles(step);
  return user.roles.some((r: RoleCode) => left.includes(r));
}

/** For 'all' steps with several roles, every role must approve (distinct users). Signatures are kept in comment as "user:role:text|". */
export function decide(wfId: string, decision: 'Approved' | 'Rejected', comment: string) {
  const u = me();
  const wf = db.workflows.find((w) => w.id === wfId);
  if (!wf) throw new ApiError('NOT_FOUND', 'Approval not found.', 404);
  if (wf.requestedBy === u.userId) throw new ApiError('APPROVAL_SOD_VIOLATION', 'You cannot approve a request you submitted (segregation of duties).', 409);
  if (!canActOn(wf, u)) throw new ApiError('FORBIDDEN', 'This approval step is not assigned to you, or you already signed it.', 403);
  if (decision === 'Rejected' && !comment.trim()) throw new ApiError('VALIDATION_FAILED', 'A comment is required when rejecting.', 422);
  const step = wf.steps[wf.currentStep];
  const role = u.roles.find((r) => remainingRoles(step).includes(r))!;
  step.comment = `${step.comment ?? ''}${u.userId}:${role}:${comment.replace(/\|/g, '/')}|`;
  audit(`workflow.${decision.toLowerCase()}`, wf.subjectType, wf.subjectId, { workflow: wf.id, step: step.label }, comment);

  if (decision === 'Rejected') {
    step.decision = 'Rejected'; step.decidedBy = u.userId; step.decidedAt = new Date().toISOString();
    wf.status = 'Rejected';
    handlers[wf.matrixCode]?.(wf, false);
    notify('workflow.task', `Rejected: ${wf.title}`, comment, { link: '/approvals', extraUsers: [wf.requestedBy] });
    persist();
    return wf;
  }
  // Every required role entry must be signed by a distinct user before the step completes.
  if (remainingRoles(step).length > 0) { persist(); return wf; }
  step.decision = 'Approved'; step.decidedBy = u.userId; step.decidedAt = new Date().toISOString();
  wf.currentStep++;
  if (wf.currentStep >= wf.steps.length) {
    wf.status = 'Approved';
    handlers[wf.matrixCode]?.(wf, true);
    notify('workflow.task', `Approved: ${wf.title}`, 'All approval steps completed.', { link: '/approvals', extraUsers: [wf.requestedBy] });
  } else {
    wf.steps[wf.currentStep].dueAt = new Date(Date.now() + escalationHours(wf.matrixCode) * 3_600_000).toISOString();
    notifyAssignees(wf);
  }
  persist();
  return wf;
}

export { db, persist, nextNo, uid };
