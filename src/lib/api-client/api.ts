import {
  addHours, agingBucket, emptyAging, formatDateTime, AGING_BUCKETS, billableDays, cashBondRefundable, computeRescueCharge, creditGate, daysBetween, holdLiftTier,
  invoiceTotals, lateEncodingPath, paymentRequestType, poApprovalTier, resolveGrants, round2, validateContractDuration, isContractExpired, ratesAboveTolerance, type Accreditation, type CashBond, type SalesActivity,
  CONTRACT_TYPES, ROLE_TEMPLATES, RESOURCES,
  type Assessment, type Client, type Contract, type ContractType, type EwaForm, type GateAction, type Grants, type InspectionLine,
  type Invoice, type JobOrder, type NotificationRule, type RepairCategory, type RescueRequest, type RoleCode, type StockTxnType, type User,
  type ClientInternalForm, type ClientPortalForm, type RescueRequestForm, type PaymentStatus, type AgingBuckets,
  type EwalletCategory, type EwalletTxn, nextCollectionStage, hireDays, PLATE_RE, LICENCE_RE, type Ewa, type EwaDelivery,
} from '../shared';
import {
  ApiError, audit, canActOn, db, decide, delay, inScope, me, nextNo, notify, onWorkflowDone, persist, requirePerm, session, setSession,
  settings, startWorkflow, uid,
} from './core';
import { resetDb } from './db';
// ── Billing (SCR-34..37) helpers ──
import { invoiceDates, periodDays, memoApprovalChain, debitMemoTotal, CREDIT_MEMO_CATEGORIES, DEBIT_MEMO_CATEGORIES, type InvoiceLine, type Memo, type Receipt, type ReceiptStatus } from '../shared';
// ── Admin (SUP-04/05/06) helpers ──
import { addDays, DEFAULT_SETTINGS, settingMeta, validateSetting, type RateCardRow } from '../shared';
import { auditHash } from './core';
// ── Portal sign-in (client & vendor) ──
import {
  checkResetToken, creditContact, demoResetToken, demoSignInCode, expireSession, portalPolicy, portalSignIn, requestPasswordReset, requestPortalAccess,
  resendSignInCode, resetPassword, verifySignInCode, type PortalRealm,
} from './portalAuth';
import { applyAdminSeed } from './seedAdmin';
export type MasterKind = 'branch' | 'equipmentType' | 'part' | 'vendor' | 'warehouse' | 'list';
const masterRef = (kind: MasterKind): { list: () => unknown[]; key: string } => ({
  branch: { list: () => db.branches, key: 'code' }, equipmentType: { list: () => db.equipmentTypes, key: 'code' }, part: { list: () => db.parts, key: 'partCode' },
  vendor: { list: () => db.vendors, key: 'vendorId' }, warehouse: { list: () => (db.warehouses ??= []), key: 'code' }, list: { list: () => (db.masterLists ??= []), key: 'code' },
}[kind]);
/** Future-dated setting changes take effect on their date (checked on sign-in and when settings are read). */
function applyScheduledSettings() {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  for (const s of db.settings) if (s.scheduled && s.scheduled.from <= today) {
    const before = s.value; s.value = s.scheduled.value; s.updatedBy = s.scheduled.by; s.updatedAt = new Date().toISOString(); s.effectiveFrom = s.scheduled.from;
    audit('settings.changed', 'setting', s.key, { value: s.value, effectiveFrom: s.effectiveFrom, scheduledBy: s.scheduled.by }, s.scheduled.reason, { value: before }); s.scheduled = undefined;
  }
}

const nowIso = () => new Date().toISOString();
const S = () => settings();
const clientOf = (code: string) => db.clients.find((c) => c.clientCode === code);
const clientName = (code?: string) => (code ? clientOf(code)?.clientName ?? code : '—');
/**
 * Gate pass number in the FRS format (GEN0001 / CEB0001): the branch's gate-pass prefix + a per-branch sequence of
 * gat.gatepass_seq_digits digits (Q-GAT-07). Portal dashboard review 2026-11-11 — replaces the GP-MNL-000881 format.
 */
export function gatePassNo(branchCode: string) {
  const prefix = db.branches.find((b) => b.code === branchCode)?.gatePassPrefix || branchCode;
  const digits = Number(S()['gat.gatepass_seq_digits'] ?? 4);
  const key = `GP.${branchCode}`;
  if (db.seq[key] == null) {
    // First pass at this branch: continue after the highest number already issued with this prefix.
    const re = new RegExp(`^${prefix}(\\d+)$`);
    db.seq[key] = Math.max(0, ...db.gatePasses.map((g) => Number(re.exec(g.gatePassNo)?.[1] ?? 0)));
  }
  return nextNo(key, prefix, digits);
}
// ── Portal New EWA review (2026-11-11) ─────────────────────────────────────
/** Units of one equipment type free for release at a branch (status Available). */
const availableUnits = (branchCode: string, equipmentType: string) =>
  db.chassis.filter((x) => x.branchCode === branchCode && x.chassisType === equipmentType && x.status === 'Available').length;
/**
 * What a client can still request under a contract: per type when the contract sets an entitled quantity for it (Contracts page
 * "Entitled: N units"), and in total against the contract's unit quantity. Units on hire and units still to be released on open
 * EWAs (Active, Partially Used, Extension Pending) both count against it.
 */
export function ewaEntitlement(ct: Contract) {
  const onHire = db.chassis.filter((x) => x.currentContractNo === ct.contractNo && ['On Hire', 'Rescue'].includes(x.status));
  const open = db.ewas.filter((e) => e.contractNo === ct.contractNo && ['Active', 'Partially Used', 'Extension Pending'].includes(e.status));
  const pendingOf = (eq?: string) => open.reduce((a, e) => a + e.units.filter((l) => !eq || l.equipmentType === eq).reduce((s, l) => s + Math.max(0, l.qty - l.usedChassis.length), 0), 0);
  const contractRemaining = Math.max(0, ct.unitQty - onHire.length - pendingOf());
  return {
    unitQty: ct.unitQty, onHire: onHire.length, pending: pendingOf(), contractRemaining,
    types: ct.rates.map((r) => {
      const oh = onHire.filter((x) => x.chassisType === r.equipmentType).length;
      const pd = pendingOf(r.equipmentType);
      const typeLeft = r.qty ? Math.max(0, r.qty - oh - pd) : undefined;
      return { equipmentType: r.equipmentType, entitled: r.qty || undefined, onHire: oh, pending: pd, dailyRate: r.dailyRate, remaining: typeLeft == null ? contractRemaining : Math.min(typeLeft, contractRemaining) };
    }),
  };
}
/**
 * GAT-002 / N08: the full-detail EWA email goes to the client (the portal user who created it and the company email) and to Delbros
 * (the pickup branch's Branch Generalists and the Account Executive). The mock records each send as Sent; the mail service sets the real status.
 */
function ewaDelivery(e: Ewa, c: Client, resend = false): EwaDelivery[] {
  const at = nowIso();
  const out: EwaDelivery[] = [];
  const add = (audience: EwaDelivery['audience'], recipient: string, to?: string) => { if (to && !out.some((d) => d.to === to)) out.push({ at, channel: 'Email', audience, recipient, to, status: 'Sent', ...(resend ? { resend } : {}) }); };
  const creator = db.users.find((x) => x.userId === e.createdBy);
  if (creator?.realm === 'CLIENT_PORTAL') add('Client', creator.name, creator.email);
  add('Client', `${c.clientName} (company email)`, c.email);
  db.users.filter((x) => x.realm === 'INTERNAL' && x.status === 'Active' && x.roles.includes('BRANCH_GENERALIST') && x.branchCode === e.branchCode).forEach((x) => add('Delbros', `${x.name} — Branch Generalist, ${e.branchCode}`, x.email));
  const ae = db.users.find((x) => x.userId === c.aeAssigned);
  if (ae) add('Delbros', `${ae.name} — Account Executive`, ae.email);
  return out;
}

/** Notification links are written for the staff app; a portal user gets the matching portal screen (record opened when the screen supports it). */
function portalLink(link?: string) {
  if (!link) return '/client';
  if (link.startsWith('/client')) return link;
  const id = link.split(/[/?]/).filter(Boolean)[1];
  if (link.startsWith('/rescue')) return id && /^RSC-/.test(id) ? `/client/rescue?open=${id}` : '/client/rescue';
  if (link.startsWith('/ewallet') || link.startsWith('/cashbond')) return '/client/ewallet';
  if (link.startsWith('/billing') || link.startsWith('/invoices') || link.startsWith('/credit')) return id && /^INV-/.test(id) ? `/client/invoices?open=${id}` : '/client/invoices';
  if (link.startsWith('/contracts')) return '/client/contracts';
  if (link.startsWith('/gate') || link.startsWith('/ewa')) return id && /^EU-/.test(id) ? `/client/ewa?open=${id}` : '/client/ewa';
  return '/client';
}
const mustClient = (code: string) => { const c = clientOf(code); if (!c) throw new ApiError('NOT_FOUND', `Client ${code} not found.`, 404); return c; };
const mustChassis = (no: string) => { const c = db.chassis.find((x) => x.chassisNo === no); if (!c) throw new ApiError('NOT_FOUND', `Chassis ${no} not found.`, 404); return c; };
const assertGate = (clientCode: string, action: GateAction) => {
  const r = creditGate(clientOf(clientCode), action, (db.gateOverrides ?? []).filter((o) => o.clientCode === clientCode));
  if (!r.allowed) throw new ApiError(r.code ?? 'CREDIT_GATE_BLOCKED', r.reason ?? 'Blocked', 409);
};
async function tx<T>(fn: () => T, ms?: number): Promise<T> {
  await delay(ms);
  const out = fn();
  persist();
  return structuredClone(out);
}

// ── Derived finance helpers ────────────────────────────────────────────────
export function paymentStatus(i: Invoice): PaymentStatus {
  if (i.status === 'Cancelled') return 'Cancelled';
  const bal = balance(i);
  if (bal <= 0.005) return (i.credited ?? 0) > 0 && i.amountPaid <= 0.005 ? 'Credited' : 'Paid';
  if (new Date(i.dueDate) < new Date(new Date().toDateString())) return 'Overdue';
  return i.amountPaid > 0 || (i.credited ?? 0) > 0 ? 'Partially Paid' : 'Unpaid';
}
// SCR-35: credit memos reduce the balance separately from payments; a cancelled invoice carries no balance; never "-₱0.00".
function balance(i: Invoice) { return i.status === 'Cancelled' ? 0 : Math.max(0, round2(i.total - i.amountPaid - (i.credited ?? 0))) + 0; }
const daysOverdue = (i: Invoice) => Math.max(0, daysBetween(new Date(i.dueDate).toISOString(), nowIso()));
const rescueIsOpen = (r: RescueRequest) => !['Completed', 'Cancelled', 'Blocked'].includes(r.status);
function outstandingOf(clientCode: string) {
  return round2(db.invoices.filter((i) => i.clientCode === clientCode && i.status !== 'Draft').reduce((a, i) => a + Math.max(0, balance(i)), 0));
}
function agingFor(clientCode?: string): AgingBuckets {
  const b: AgingBuckets = emptyAging();
  for (const i of db.invoices) {
    if (i.status === 'Draft' || (clientCode && i.clientCode !== clientCode) || balance(i) <= 0) continue;
    const k = agingBucket(daysOverdue(i));
    b[k] = round2(b[k] + balance(i)); b.total = round2(b.total + balance(i));
  }
  return b;
}

// DBL-EWL-003: category derived from the source document when the caller doesn't give one.
const ewalletCategory = (type: string, referenceType: string): EwalletCategory =>
  type === 'Replenishment' ? 'Top-up' : type === 'Reversal' ? 'Reversal' : type === 'Adjustment' ? 'Adjustment'
    : referenceType === 'Rescue' ? 'Rescue' : referenceType === 'Repair' || referenceType === 'Job Order' ? 'Repair' : referenceType === 'Invoice' || referenceType === 'Contract termination' ? 'Contract-termination lease' : 'Debit Memo';
function ewalletPost(clientCode: string, type: 'Replenishment' | 'Deduction' | 'Adjustment' | 'Reversal', signedAmount: number, referenceType: string, referenceId?: string, reason?: string, extra: Partial<EwalletTxn> = {}) {
  const w = db.ewallets.find((e) => e.clientCode === clientCode);
  if (!w) throw new ApiError('NOT_FOUND', 'Client has no e-wallet yet. Create it after Treasury confirms the initial payment.', 404);
  w.balance = round2(w.balance + signedAmount);
  const t: EwalletTxn = { id: nextNo('EWT', 'EWT-', 6), clientCode, at: nowIso(), type, amount: signedAmount, balanceAfter: w.balance, referenceType, referenceId, reason, by: session()?.userId ?? 'system', category: ewalletCategory(type, referenceType), ...extra };
  if (t.reversesId) { const orig = db.ewalletTxns.find((x) => x.id === t.reversesId); if (orig) orig.reversedById = t.id; }
  db.ewalletTxns.unshift(t);
  const c = clientOf(clientCode);
  notify('ewallet.movement', `E-wallet ${type.toLowerCase()}: ${c?.clientName}`, `₱${Math.abs(signedAmount).toLocaleString('en-PH')} · balance ₱${w.balance.toLocaleString('en-PH')}${w.balance < w.minimumBalance ? ' (below minimum)' : ''}`, { link: `/ewallet/${clientCode}`, clientCode, aeUserId: c?.aeAssigned });
  audit('ewallet.posted', 'ewallet', clientCode, t, reason);
  return t;
}

// ── Workflow completion handlers ───────────────────────────────────────────
onWorkflowDone('ACCREDITATION', (wf, ok) => {
  const c = clientOf(wf.subjectId); const a = db.accreditations.find((x) => x.workflowId === wf.id);
  if (!c || !a) return;
  a.status = ok ? 'Approved' : 'Rejected';
  if (ok) {
    c.status = 'Active';
    // DBL-CLT-005: eligibility flags, CWS branches and credit limit set on VP sign-off.
    if (a.activation) { const { creditLimit, signOffDate: _d, ...flags } = a.activation; Object.assign(c, flags); if (creditLimit != null) c.creditLimit = creditLimit; }
    audit('client.activated', 'client', c.clientCode, { status: 'Active', ...a.activation });
  }
  const rej = wf.steps.find((s) => s.decision === 'Rejected');
  notify('workflow.task', `Accreditation ${ok ? 'approved' : 'rejected'}: ${c.clientName}`, ok ? 'Client is now Active with eligibility flags applied.' : `Rejected at ${rej?.label ?? 'review'} — client remains in Draft; the AE may resubmit.`, { extraUsers: [c.aeAssigned], link: '/clients/accreditation' });
  notify('client.accreditation.stage', `Accreditation ${ok ? 'complete' : 'rejected'}: ${c.clientName}`, ok ? 'VP sign-off — client Active.' : `Rejected at ${rej?.label ?? 'review'}.`, { aeUserId: c.aeAssigned, branchCode: c.branchCode, link: '/clients/accreditation' }); // N46
});
onWorkflowDone('HOLD_LIFT', (wf, ok) => {
  const c = clientOf(wf.subjectId); if (!c) return;
  if (ok) {
    c.status = 'Active';
    db.holdEvents.unshift({ id: uid(), clientCode: c.clientCode, type: 'Reactivated', at: nowIso(), by: session()?.userId ?? 'system', outstanding: wf.amount ?? 0, reason: `Hold lift approved — ${wf.steps.map((s) => s.label).join(' → ')}`, approvedBy: wf.steps.flatMap((s) => (s.comment ?? '').split('|').filter(Boolean).map((x) => x.split(':')[0])).join(', ') || session()?.userId, workflowId: wf.id });
    notify('client.reactivated', `Client reactivated: ${c.clientName}`, 'Hold lifted after tiered approval (BR-03).', { clientCode: c.clientCode, aeUserId: c.aeAssigned, link: `/clients/${c.clientCode}` });
    audit('client.reactivated', 'client', c.clientCode, { status: 'Active' });
  }
});
onWorkflowDone('CASH_BOND_WITHDRAWAL', (wf, ok) => {
  for (const b of db.cashBonds) {
    const w = b.withdrawals.find((x) => x.workflowId === wf.id);
    // Approved → Accounting records the refund (method, date, reference) before the bond moves to Refunded.
    if (w) { w.status = ok ? 'Approved — awaiting refund' : 'Rejected'; b.status = ok ? 'Withdrawal Pending' : 'Held'; audit(`cashbond.withdrawal.${ok ? 'approved' : 'rejected'}`, 'cashbond', b.id, { withdrawal: w.id }); }
  }
});
// SCR-08: custom contract type / rate variance approval, and termination approval.
onWorkflowDone('CONTRACT_APPROVAL', (wf, ok) => {
  const ct = db.contracts.find((x) => x.contractNo === wf.subjectId); if (!ct?.approval) return;
  ct.approval.status = ok ? 'Approved' : 'Rejected';
  (ct.history ??= []).push({ status: ok ? 'Approved (terms)' : 'Rejected (terms)', at: nowIso(), by: session()?.userId ?? 'system', note: ct.approval.kind });
  audit(`contract.approval.${ok ? 'approved' : 'rejected'}`, 'contract', ct.contractNo, { kind: ct.approval.kind });
});
onWorkflowDone('CONTRACT_TERMINATION', (wf, ok) => {
  const ct = db.contracts.find((x) => x.contractNo === wf.subjectId); if (!ct?.termination) return;
  ct.termination.status = ok ? 'Approved' : 'Rejected';
  if (ok) { ct.status = 'Terminated'; (ct.history ??= []).push({ status: 'Terminated', at: nowIso(), by: session()?.userId ?? 'system', note: ct.termination.reason }); }
  audit(`contract.termination.${ok ? 'approved' : 'rejected'}`, 'contract', ct.contractNo, { status: ct.status });
});
onWorkflowDone('LATE_ENCODING_CM', (wf, ok) => {
  const le = db.lateEncodings.find((l) => l.workflowId === wf.id); if (!le) return;
  le.status = ok ? 'Approved' : 'Rejected';
  const gp = db.gatePasses.find((g) => g.gatePassNo === le.gatePassNo);
  if (ok && gp) {
    gp.actualEventAt = le.correctedDate;
    // SCR-37: a late-encoding CM seeded/raised with this workflow is completed instead of creating a second one.
    const existing = db.memos.find((m) => m.workflowId === wf.id);
    const memoNo = existing?.memoNo ?? nextNo('CM', 'CM-', 6);
    if (!existing) db.memos.unshift({ memoNo, type: 'Credit', clientCode: gp.clientCode, referenceType: 'Late Encoding', referenceId: le.id, amount: 0, reason: `Late encoding ${le.daysLate} days — billing corrected to actual date (BR-05)`, status: 'Posted', createdAt: nowIso(), category: 'Late-encoding correction', source: 'Auto', createdBy: 'system', approvalChain: ['Deputy Yard Manager', 'Treasury'], workflowId: wf.id });
    le.memoNo = memoNo;
    releaseHeldLines(memoNo, gp.chassisNo);
    db.invoices.forEach((i) => i.lines.forEach((l) => { if (l.held && l.chassisNo === gp.chassisNo) l.held = false; }));
  } else if (!ok) { const m = db.memos.find((x) => x.workflowId === wf.id); if (m) m.status = 'Rejected'; }
});
onWorkflowDone('EWA_EXTENSION', (wf, ok) => {
  const e = db.ewas.find((x) => x.euNo === wf.subjectId); if (!e) return;
  if (ok) { e.status = 'Active'; e.validUntil = addHours(nowIso(), Number(S()['gat.ewa_validity_hours'] ?? 24)); e.extensionCount++; } else e.status = 'Expired';
});
onWorkflowDone('JOB_ORDER', (wf, ok) => {
  const jo = db.jobOrders.find((j) => j.joNo === wf.subjectId); if (!jo) return;
  if (ok) { jo.status = 'Confirmed'; jo.confirmedBy = session()?.userId; const c = db.chassis.find((x) => x.chassisNo === jo.chassisNo); if (c && c.status === 'Breakdown') { c.status = 'In Repair'; c.statusSince = nowIso(); } }
});
onWorkflowDone('FORCE_INBOUND', (wf, ok) => {
  const c = db.chassis.find((x) => x.chassisNo === wf.subjectId); if (!c || !ok) return;
  const gpNo = gatePassNo(c.branchCode);
  const fiOut = db.gatePasses.find((g) => g.direction === 'OUT' && g.chassisNo === c.chassisNo && !g.pairedGatePassNo);
  const fiEir = fiOut ? db.eirs.find((x) => x.gatePassOutNo === fiOut.gatePassNo) : undefined;
  db.gatePasses.unshift({ gatePassNo: gpNo, direction: 'IN', chassisNo: c.chassisNo, clientCode: c.currentClientCode ?? '', contractNo: c.currentContractNo ?? '', trucker: '—', truckPlateNo: '—', driverName: '—', driverLicenseNo: '—', generalAssessment: 'Unroadworthy', inspection: [], actualEventAt: nowIso(), encodedAt: nowIso(), branchCode: c.branchCode, isForceInbound: true, eirNo: fiEir?.eirNo ?? '—', pairedGatePassNo: fiOut?.gatePassNo, remarks: 'Force Inbound (WF-12) — loss/indemnity settled', encodedBy: session()?.userId ?? 'system' });
  if (fiOut) fiOut.pairedGatePassNo = gpNo;
  if (fiEir) { fiEir.gatePassInNo = gpNo; fiEir.eirInDate = nowIso(); }
  c.status = 'Killed'; c.statusSince = nowIso(); c.remarks = 'Force Inbound after indemnity settlement (BR-17)'; c.currentClientCode = undefined; c.currentContractNo = undefined;
  audit('gate.force_inbound.applied', 'chassis', c.chassisNo, { gatePassNo: gpNo });
});
onWorkflowDone('PR_PO', (wf, ok) => {
  const pr = db.prs.find((p) => p.prNo === wf.subjectId); if (!pr) return;
  pr.status = ok ? 'Approved' : 'Rejected';
});
onWorkflowDone('PAYMENT_REQUEST', (wf, ok) => { const p = db.paymentRequests.find((x) => x.docNo === wf.subjectId); if (p) p.status = ok ? 'Approved' : 'Rejected'; });
onWorkflowDone('MEMO', (wf, ok) => { const m = db.memos.find((x) => x.memoNo === wf.subjectId); if (m) { m.status = ok ? 'Approved' : 'Rejected'; if (ok) applyMemo(m.memoNo); audit(`memo.${ok ? 'approved' : 'rejected'}`, 'memo', m.memoNo, { status: m.status }); } });
onWorkflowDone('EWALLET_SPECIAL', (wf, ok) => {
  if (!ok) return;
  const p = wf as unknown as { payload?: { clientCode: string; type: 'Deduction' | 'Adjustment' | 'Reversal'; amount: number; referenceType: string; referenceId?: string; reason: string; category?: EwalletCategory; reversesId?: string } };
  if (p.payload) ewalletPost(p.payload.clientCode, p.payload.type, p.payload.amount, p.payload.referenceType, p.payload.referenceId, p.payload.reason, { ...(p.payload.category ? { category: p.payload.category } : {}), reversesId: p.payload.reversesId, workflowId: wf.id });
});
// DBL-CNC-001 gate override approved → active until validUntil
onWorkflowDone('GATE_OVERRIDE', (wf, ok) => {
  const o = (db.gateOverrides ?? []).find((x) => x.workflowId === wf.id); if (!o) return;
  o.status = ok ? 'Approved' : 'Rejected';
  if (ok) { o.approvedBy = session()?.userId; o.approvedAt = nowIso(); }
  audit(`gate_override.${ok ? 'approved' : 'rejected'}`, 'client', o.clientCode, o, o.reason);
});
// DBL-CNC-006 demand letter released only after approval (proposed default, Q-CNC-06)
onWorkflowDone('DEMAND_LETTER', (wf, ok) => {
  const cc = db.collections.find((x) => x.clientCode === wf.subjectId); if (!cc) return;
  cc.pendingWorkflowId = undefined;
  if (ok) collectionAdvance(wf.subjectId, 'Demand letter approved and sent', 'Demand letter');
  else cc.actions.unshift({ at: nowIso(), action: 'Demand letter rejected', by: session()?.userId ?? 'system' });
});
function collectionAdvance(code: string, notes?: string, letter?: string) {
  let cc = db.collections.find((x) => x.clientCode === code);
  if (!cc) { cc = { clientCode: code, stage: 'None', actions: [] }; db.collections.push(cc); }
  const next = nextCollectionStage(cc.stage);
  if (!next) throw new ApiError('INVALID_STATE', 'Already at the final stage (Demand letter).', 409);
  cc.stage = next; cc.stageChangedAt = nowIso();
  const days = { 'SOA Sent': Number(S()['cnc.first_reminder_days'] ?? 5), '1st Reminder': Number(S()['cnc.second_reminder_days'] ?? 10) - Number(S()['cnc.first_reminder_days'] ?? 5), '2nd Reminder': Number(S()['cnc.demand_letter_days'] ?? 20) - Number(S()['cnc.second_reminder_days'] ?? 10) } as Record<string, number>;
  cc.nextActionDue = days[cc.stage] ? new Date(Date.now() + days[cc.stage] * 86400000).toISOString().slice(0, 10) : undefined;
  cc.actions.unshift({ at: nowIso(), action: cc.stage, by: session()?.userId ?? 'system', notes, letter });
  const c = mustClient(code);
  notify('collection.reminder', `${cc.stage}: ${c.clientName}`, `Outstanding ₱${outstandingOf(code).toLocaleString('en-PH')}`, { clientCode: code, aeUserId: c.aeAssigned });
  // Stage-specific rules N43–N45 (DBL-CNC-006).
  const stageEvent = ({ '1st Reminder': 'collection.first_reminder', '2nd Reminder': 'collection.second_reminder', 'Demand Letter': 'collection.demand_letter' } as Record<string, string>)[cc.stage];
  if (stageEvent) notify(stageEvent, `${cc.stage}: ${c.clientName}`, `Outstanding ₱${outstandingOf(code).toLocaleString('en-PH')}`, { clientCode: code, aeUserId: c.aeAssigned, link: `/credit/soa/${code}` });
  audit('collection.advanced', 'client', code, { stage: cc.stage }, notes);
  return cc;
}
onWorkflowDone('STOCK_ADJUSTMENT', (wf, ok) => {
  const t = db.stockTxns.find((x) => x.txnNo === wf.subjectId); if (!t) return;
  t.status = ok ? 'Posted' : 'Rejected'; if (!ok) return;
  const bal = db.stock.find((s) => s.partCode === t.partCode && s.warehouseCode === t.fromWarehouse);
  if (bal) { bal.qtyOnHand += t.qty; t.balanceAfter = bal.qtyOnHand; }
});
// SCR-28 inter-branch transfer — stock moves only after approval; the workflow id is the approval reference.
onWorkflowDone('STOCK_TRANSFER', (wf, ok) => {
  const t = db.stockTxns.find((x) => x.txnNo === wf.subjectId); if (!t) return;
  if (!ok) { t.status = 'Rejected'; return; }
  const get = (wh: string) => { let b = db.stock.find((s) => s.partCode === t.partCode && s.warehouseCode === wh); if (!b) { b = { partCode: t.partCode, warehouseCode: wh, qtyOnHand: 0 }; db.stock.push(b); } return b; };
  const from = get(t.fromWarehouse ?? ''), qty = Math.abs(t.qty);
  if (from.qtyOnHand < qty) { t.status = 'Rejected'; t.remarks = `${t.remarks ? t.remarks + ' · ' : ''}Insufficient stock at approval (on hand ${from.qtyOnHand}).`; return; }
  from.qtyOnHand -= qty; t.balanceAfter = from.qtyOnHand; t.status = 'Posted'; t.approvalRef = t.approvalRef || wf.id;
  const to = get(t.toWarehouse ?? ''); to.qtyOnHand += qty;
  db.stockTxns.unshift({ id: uid(), txnNo: t.txnNo + '-R', type: 'Receive', partCode: t.partCode, qty, fromWarehouse: t.toWarehouse, referenceType: 'Transfer', referenceId: t.txnNo, balanceAfter: to.qtyOnHand, entityCode: t.entityCode, at: nowIso(), by: session()?.userId ?? 'system', status: 'Posted', source: 'Manual', approvalRef: wf.id });
});
// SCR-29 pre-audit count submission (DBL-INV-004/007) — variance is posted only after approval.
onWorkflowDone('STOCK_COUNT', (wf, ok) => {
  const [partCode, wh] = wf.subjectId.split('@');
  const b = db.stock.find((s) => s.partCode === partCode && s.warehouseCode === wh); if (!b?.pendingCount) return;
  const pc = b.pendingCount; b.pendingCount = undefined;
  if (!ok) { audit('stock.count_rejected', 'stock', wf.subjectId, pc); return; }
  const variance = pc.counted - b.qtyOnHand;
  b.lastPhysicalCount = pc.counted; b.lastCountDate = nowIso().slice(0, 10);
  if (variance !== 0) {
    b.qtyOnHand = pc.counted;
    db.stockTxns.unshift({ id: uid(), txnNo: nextNo('STK', 'STK-', 6), type: 'Adjustment', partCode, qty: variance, fromWarehouse: wh, referenceType: 'Count', referenceId: wf.id, reason: pc.reason ?? `${pc.auditType} variance`, balanceAfter: b.qtyOnHand, entityCode: b.entityCode ?? 'DBL', at: nowIso(), by: session()?.userId ?? 'system', status: 'Posted', source: 'Auto — Count', workflowId: wf.id });
  }
  audit('stock.count_posted', 'stock', wf.subjectId, { counted: pc.counted, variance });
});
// SCR-13 retire / dispose (DBL-CHS-011).
onWorkflowDone('ASSET_DISPOSAL', (wf, ok) => {
  const a = db.assets.find((x) => x.assetId === wf.subjectId); if (!a?.disposal) return;
  a.disposal.status = ok ? 'Approved' : 'Rejected';
  if (ok) { const from = a.status; a.status = a.disposal.action === 'Retire' ? 'Retired' : 'Disposed'; a.nextPmDate = undefined; audit('asset.status', 'asset', a.assetId, { status: a.status }, a.disposal.reason, { status: from }); }
});

/** SCR-37: an approved memo with a reference invoice is applied (CM reduces the balance, DM adds to it); without one it stays Approved as client-level credit / charge. */
function applyMemo(memoNo: string) {
  const m = db.memos.find((x) => x.memoNo === memoNo); if (!m || !m.referenceInvoiceNo) return;
  const inv = db.invoices.find((i) => i.invoiceNo === m.referenceInvoiceNo); if (!inv) return;
  if (m.category === 'Late-encoding correction') { releaseHeldLines(m.memoNo); return; }
  if (m.type === 'Credit') inv.credited = round2((inv.credited ?? 0) + Math.min(m.amount, balance(inv))); else { inv.total = round2(inv.total + m.amount); }
  m.status = 'Applied'; m.appliedTo = inv.invoiceNo; m.appliedAt = nowIso(); m.balanceAfter = balance(inv);
  (inv.history ??= []).push({ at: nowIso(), by: session()?.userId ?? 'system', action: m.type === 'Credit' ? 'Credit memo applied' : 'Debit memo applied', note: `${m.memoNo} · ₱${m.amount.toLocaleString('en-PH')}` });
}
// ── Billing derived helpers (SCR-34..37) ──
const billingUser = (id?: string) => (id ? db.users.find((u) => u.userId === id)?.name ?? id : undefined);
const invoiceDateOf = (i: Invoice) => i.invoiceDate ?? i.issuedAt.slice(0, 10);
const creditTermOf = (i: Invoice) => i.creditTermDays ?? db.contracts.find((c) => c.contractNo === i.contractNo)?.creditTermDays ?? 30;
/** Legacy rows without a status: an OR was issued; a bare PR is still provisional. */
const receiptStatusOf = (r: Receipt): ReceiptStatus => r.status ?? (r.type === 'OR' ? 'OR Issued' : 'Provisional');
/** Amount on Provisional Receipts awaiting Treasury clearance (not yet posted to the invoice). */
const pendingClearanceOf = (invoiceNo: string) => round2(db.receipts.filter((r) => receiptStatusOf(r) === 'Provisional').reduce((a, r) => a + r.applications.filter((x) => x.invoiceNo === invoiceNo).reduce((b, x) => b + x.amount, 0), 0));
/** DBL-CNC-008 client credit: unapplied remainders on issued ORs + approved credit memos not yet applied to an invoice. */
const clientCreditOf = (code: string) => round2(db.receipts.filter((r) => r.clientCode === code && receiptStatusOf(r) === 'OR Issued').reduce((a, r) => a + r.unapplied, 0)
  + db.memos.filter((m) => m.clientCode === code && m.type === 'Credit' && m.status === 'Approved' && !m.appliedTo).reduce((a, m) => a + m.amount, 0));
function memoDefaults(m: Memo) {
  const auto = ['Rescue', 'Late Encoding', 'Park & Fix'].includes(m.referenceType);
  return { source: m.source ?? (auto ? 'Auto' : 'Manual') as 'Auto' | 'Manual', createdBy: m.createdBy ?? (auto ? 'system' : undefined),
    category: m.category ?? (m.referenceType === 'Rescue' ? 'Rescue billing' : m.referenceType === 'Late Encoding' ? 'Late-encoding correction' : m.referenceType === 'Park & Fix' ? 'Other charges' : undefined),
    rescueNo: m.rescueNo ?? (m.referenceType === 'Rescue' ? m.referenceId : undefined), approvalChain: m.approvalChain ?? (auto ? ['Automatic (system rule)'] : ['Finance Manager']) };
}
function validateMemo(v: { type: 'Credit' | 'Debit'; clientCode: string; referenceInvoiceNo?: string; amount: number; reason: string; category?: string; evidence?: string[]; breakdown?: Memo['breakdown']; joNo?: string; rescueNo?: string }) {
  const f: Record<string, string> = {};
  if (!v.clientCode) f.clientCode = 'Required';
  if (!v.category || !(v.type === 'Credit' ? CREDIT_MEMO_CATEGORIES : DEBIT_MEMO_CATEGORIES).includes(v.category as never)) f.category = 'Select a reason category';
  if (!v.reason.trim()) f.reason = 'Required';
  if (!(v.amount > 0)) f.amount = 'Must be greater than zero';
  if (!v.evidence?.length) f.evidence = 'Attach supporting evidence (DBL-FIN-011)';
  if (Object.keys(f).length) throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, f);
  if (v.type === 'Debit' && ['Rescue billing', 'Repair cost'].includes(v.category!) && !v.joNo && !v.rescueNo) throw new ApiError('MISSING_LINKED_JO', 'Missing linked Job Order for DM — link the Job Order (repair) or the rescue record before submitting.', 422, { joNo: 'Required' });
  if (v.joNo && !db.jobOrders.some((j) => j.joNo === v.joNo)) throw new ApiError('VALIDATION_FAILED', `Job Order ${v.joNo} not found.`, 422, { joNo: 'Not found' });
  if (v.rescueNo && !db.rescues.some((r) => r.rescueNo === v.rescueNo && r.clientCode === v.clientCode)) throw new ApiError('VALIDATION_FAILED', `Rescue ${v.rescueNo} is not a rescue of this client.`, 422, { rescueNo: 'Not found' });
  if (v.referenceInvoiceNo) {
    const i = db.invoices.find((x) => x.invoiceNo === v.referenceInvoiceNo);
    if (!i || i.clientCode !== v.clientCode || i.status === 'Cancelled' || (balance(i) <= 0 && v.category !== 'Late-encoding correction')) throw new ApiError('VALIDATION_FAILED', 'Reference invoice must be an open invoice of the selected client.', 422, { referenceInvoiceNo: 'Not an open invoice of this client' });
    if (v.type === 'Credit' && v.category !== 'Late-encoding correction' && v.amount > balance(i) + 0.001) throw new ApiError('EXCEEDS_BALANCE', `Credit amount exceeds the invoice balance (₱${balance(i).toLocaleString('en-PH')}).`, 422, { amount: 'Exceeds invoice balance' });
  }
}
/** BR-05: on late-encoding CM approval the held lines are released to billing and the invoice totals recomputed. */
function releaseHeldLines(memoNo: string, chassisNo?: string) {
  const m = db.memos.find((x) => x.memoNo === memoNo);
  for (const inv of db.invoices) {
    const hits = inv.lines.filter((l) => l.heldMemoNo === memoNo || (chassisNo && l.chassisNo === chassisNo && (l.held || l.heldMemoNo)));
    if (!hits.length) continue;
    hits.forEach((l) => { l.held = false; l.recalculated = true; });
    const t = invoiceTotals(inv.lines.filter((l) => !l.held).map((l) => l.amount), Number(S()['fin.vat_pct'] ?? 0.12));
    Object.assign(inv, t); if (!inv.lines.some((l) => l.held)) inv.heldReason = undefined;
    (inv.history ??= []).push({ at: nowIso(), by: session()?.userId ?? 'system', action: 'Held lines released', note: `${memoNo} approved (BR-05)` });
    if (m) { m.status = 'Applied'; m.appliedTo = inv.invoiceNo; m.appliedAt = nowIso(); m.balanceAfter = balance(inv); }
  }
}

// ── Auto-hold job (BR-02), run on read for the demo ────────────────────────
function runAutoHold() {
  const threshold = Number(S()['cnc.hold_threshold_days'] ?? 30);
  for (const c of db.clients.filter((x) => x.status === 'Active')) {
    const breach = db.invoices.find((i) => i.clientCode === c.clientCode && i.status !== 'Draft' && balance(i) > 0 && daysOverdue(i) > threshold);
    if (breach) {
      c.status = 'Hold';
      const reh = db.holdEvents.some((h) => h.clientCode === c.clientCode && h.type === 'Reactivated');
      db.holdEvents.unshift({ id: uid(), clientCode: c.clientCode, type: reh ? 'Re-Hold' : 'Auto Hold', at: nowIso(), by: 'system', outstanding: outstandingOf(c.clientCode), daysOverdue: daysOverdue(breach), invoiceNo: breach.invoiceNo });
      notify('client.hold.applied', `Credit hold: ${c.clientName}`, `Invoice ${breach.invoiceNo} is ${daysOverdue(breach)} days past due. Release, gate pass, repair and new services are blocked.`, { clientCode: c.clientCode, aeUserId: c.aeAssigned, link: `/credit/status?client=${c.clientCode}` });
      audit('client.hold.applied', 'client', c.clientCode, { status: 'Hold' }, `Auto hold (BR-02) — ${breach.invoiceNo}`);
    }
  }
}

// SCR-07: accreditation stage follows the workflow's current step.
const ACC_STAGES = ['Pending C&C', 'Pending Finance', 'Pending VP'] as const;
function accreditationStage(a: Client['clientCode'] | undefined) {
  const acc = a ? db.accreditations.find((x) => x.clientCode === a) : undefined; if (!acc) return undefined;
  const wf = db.workflows.find((w) => w.id === acc.workflowId);
  if (wf?.status === 'Pending') acc.status = ACC_STAGES[wf.currentStep] ?? acc.status;
  return acc.status;
}
// SCR-06: list/profile extras — contracts, on-hire units, accreditation sub-state, portal approval, hold reason, rescue marker.
function clientExtras(c: Client) {
  const hold = c.status === 'Hold' ? db.holdEvents.find((h) => h.clientCode === c.clientCode && h.type !== 'Reactivated') : undefined;
  const wallet = db.ewallets.find((e) => e.clientCode === c.clientCode);
  const portalUser = c.registrationSource === 'Portal' ? db.users.find((u) => u.clientCode === c.clientCode) : undefined;
  return {
    activeContracts: db.contracts.filter((x) => x.clientCode === c.clientCode && x.status === 'Active').length,
    onHireUnits: db.chassis.filter((x) => x.currentClientCode === c.clientCode && x.status === 'On Hire').length,
    accreditationStage: c.status === 'Draft' ? accreditationStage(c.clientCode) : undefined,
    portalPending: !!portalUser && portalUser.status === 'Inactive' && c.status === 'Draft',
    holdReason: hold ? `${hold.type}${hold.invoiceNo ? ` — ${hold.invoiceNo} ${hold.daysOverdue ?? ''} days past due` : ''} (DBL-CLT-006) · ${formatPhpPlain(hold.outstanding)} outstanding` : undefined,
    rescueEligible: c.allowRescue && c.status === 'Active' && !!wallet && wallet.balance > 0,
  };
}
// SCR-09: bond balance = received less refunded withdrawals.
const bondBalance = (b: CashBond) => round2(b.amount - b.withdrawals.filter((w) => w.status === 'Refunded').reduce((a, w) => a + w.amount, 0));
const formatPhpPlain = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// DBL-CLT-010: Active contracts move to Expired on the expiry date (run on read for the demo).
function expireContracts() {
  for (const ct of db.contracts) {
    // DBL-CLT-011: renewal notices at 3, 2 and 1 months (rule N05 — AE + Sales Director), once each, logged on the contract.
    if (ct.status === 'Active' && ct.expiryDate) {
      const left = (new Date(ct.expiryDate).getTime() - Date.now()) / 86_400_000;
      const due = [3, 2, 1].filter((m) => left >= 0 && left <= m * 30).pop();
      const label = due ? `Renewal notice — ${due} month${due > 1 ? 's' : ''}` : undefined;
      if (label && !(ct.history ?? []).some((h) => h.status === label)) {
        (ct.history ??= []).push({ status: label, at: nowIso(), by: 'system', note: `Expires ${ct.expiryDate}` });
        notify('contract.expiring', `Contract expiring: ${ct.contractNo}`, `${clientName(ct.clientCode)} · expires ${ct.expiryDate} (${due} month notice)`, { clientCode: ct.clientCode, aeUserId: clientOf(ct.clientCode)?.aeAssigned, link: `/contracts/${ct.contractNo}` });
      }
    }
    if (!isContractExpired(ct)) continue;
    ct.status = 'Expired'; (ct.history ??= []).push({ status: 'Expired', at: nowIso(), by: 'system', note: `Expiry date ${ct.expiryDate} reached` });
    audit('contract.expired', 'contract', ct.contractNo, { status: 'Expired' });
  }
}

function expireEwas() {
  for (const e of db.ewas) if (e.status === 'Active' && new Date(e.validUntil) < new Date()) e.status = 'Expired';
}

// ── Allocation helpers (M05) — every count derives from db.chassis so all screens show one fleet ──
type YardCat = import('../shared').YardCategory;
const ISLAND_OF: Record<string, 'Luzon' | 'Visayas' | 'Mindanao'> = { NCR: 'Luzon', 'North Luzon': 'Luzon', 'South Luzon': 'Luzon', Visayas: 'Visayas', Mindanao: 'Mindanao' };
const islandOf = (branchCode: string) => ISLAND_OF[db.branches.find((b) => b.code === branchCode)?.region ?? 'NCR'] ?? 'Luzon';
const openJoOf = (no: string) => db.jobOrders.find((j) => j.chassisNo === no && !j.status.startsWith('Closed'));
/** DCIR yard / repair category (DBL-ALO-003). TQS = repair finished, awaiting the BR-07 quality sign-off (proposed mapping — confirm). */
function yardCategoryOf(c: { chassisNo: string; status: string; generalAssessment: Assessment; yardCategory?: YardCat }): YardCat | undefined {
  if (c.status === 'Breakdown' || c.status === 'In Repair') { const jo = openJoOf(c.chassisNo); if (jo) return jo.isMajor || c.yardCategory === 'Major Repair' ? 'Major Repair' : 'Minor Repair'; return c.yardCategory && c.yardCategory !== 'Roadworthy' ? c.yardCategory : 'TQS'; }
  if (['Available', 'Allocated', 'Parked', 'New'].includes(c.status)) return c.generalAssessment === 'Roadworthy' ? 'Roadworthy' : 'Minor Repair';
  return undefined;
}
/** Registration / OR-CR state used by allocation and DCIR availability. Expired or missing = cannot leave the gate. */
function regStateOf(no: string, asOf = nowIso()): 'Current' | 'Near expiry' | 'Expired' | 'Missing' {
  const r = db.registrations.find((x) => x.subjectId === no); if (!r) return 'Missing';
  const d = daysBetween(asOf, new Date(r.expiryDate).toISOString());
  return d < 0 ? 'Expired' : d <= Number(S()['alo.reg_warn_days'] ?? 14) ? 'Near expiry' : 'Current';
}
function monetaryStatusOf(clientCode: string, contractNo?: string) {
  const g = creditGate(clientOf(clientCode), 'EWA_CREATE');
  if (!g.allowed) return { status: 'Blocked' as const, note: g.reason ?? 'Credit gate blocked' };
  const bond = db.cashBonds.find((b) => b.clientCode === clientCode && (!contractNo || b.contractNo === contractNo) && b.status === 'Held');
  return bond ? { status: 'Cleared' as const, note: `Cash bond ${bond.receiptRef} held` } : { status: 'Pending' as const, note: 'Cash bond / deposit not yet received' };
}
const pendingTransferOf = (no: string) => db.workflows.find((w) => w.matrixCode === 'CHASSIS_TRANSFER' && w.subjectId === no && w.status === 'Pending') as (import('../shared').WorkflowInstance & { payload?: { from: string; to: string } }) | undefined;
onWorkflowDone('CHASSIS_TRANSFER', (wf, ok) => {
  const c = db.chassis.find((x) => x.chassisNo === wf.subjectId); const p = (wf as unknown as { payload?: { from: string; to: string } }).payload;
  if (!c || !p || !ok) return;
  if (c.status !== 'Available') { audit('chassis.transfer_skipped', 'chassis', c.chassisNo, undefined, `Transfer approved but chassis is ${c.status}`); return; }
  c.branchCode = p.to; c.statusSince = nowIso();
  audit('chassis.transferred', 'chassis', c.chassisNo, { branchCode: p.to }, `Cross-branch transfer ${wf.id}`, { branchCode: p.from });
});

// ══════════════════════════════════════════════════════════════════════════
export const api = {
  // ── Auth (M01) ───────────────────────────────────────────────────────────
  auth: {
    async login(userId: string, password: string, realm: User['realm'] = 'INTERNAL') {
      await delay(250);
      applyAdminSeed(db); applyScheduledSettings();
      const u = db.users.find((x) => x.userId.toLowerCase() === userId.trim().toLowerCase() && x.realm === realm);
      const maxFail = Number(S()['auth.max_failed_logins'] ?? 5);
      if (u?.lockedUntil && new Date(u.lockedUntil) > new Date()) throw new ApiError('ACCOUNT_LOCKED', `Your account is locked. Try again after ${new Date(u.lockedUntil).toLocaleTimeString('en-PH')} or contact IT.`, 423);
      if (u && u.realm !== 'INTERNAL' && u.password === password && u.status !== 'Active') throw new ApiError('ACCOUNT_PENDING', 'Your portal account is not active yet — your registration is pending Account Executive approval (DBL-CLT-019). We will email you once access is enabled.', 403);
      if (!u || u.password !== password || u.status !== 'Active') {
        if (u) {
          u.failed++;
          audit('auth.login_failed', 'user', u.userId);
          if (u.failed >= maxFail) {
            u.lockedUntil = addHours(nowIso(), Number(S()['auth.lockout_minutes'] ?? 30) / 60); audit('auth.account_locked', 'user', u.userId, { failedAttempts: u.failed }, `Locked after ${u.failed} failed sign-in attempts`); persist();
            throw new ApiError('ACCOUNT_LOCKED', `Too many failed attempts — your account is locked for ${Number(S()['auth.lockout_minutes'] ?? 30)} minutes. Try again after ${new Date(u.lockedUntil).toLocaleTimeString('en-PH')} or ask IT to unlock it.`, 423);
          }
          persist();
        }
        throw new ApiError('INVALID_CREDENTIALS', 'Invalid user ID or password.', 401);
      }
      u.failed = 0; u.lockedUntil = undefined; u.lastLogin = nowIso();
      setSession(u); audit('auth.login', 'user', u.userId); persist();
      return api.auth.me();
    },
    async logout() { if (session()) audit('auth.logout', 'user', me().userId); setSession(null); persist(); },
    me() { const u = session(); return u ? structuredClone(u) : null; },
    async changePassword(current: string, next: string) {
      return tx(() => {
        const u = db.users.find((x) => x.userId === me().userId)!;
        if (u.password !== current) throw new ApiError('VALIDATION_FAILED', 'Current password is incorrect.', 422, { current: 'Current password is incorrect' });
        if (next.includes(u.userId)) throw new ApiError('VALIDATION_FAILED', 'Password must not contain your user ID.', 422, { next: 'Must not contain your user ID' });
        u.password = next; audit('auth.password_changed', 'user', u.userId); return true;
      });
    },
    // ── Portal sign-in (client & vendor) — portal sign-in review 2026-11-11, see ./portalAuth.ts ──
    /** Public sign-in policy (lockout, password rules, session timeout, second factor, support contacts). */
    policy: () => portalPolicy(),
    /** Email + password; returns signed_in, or otp_required when the second factor is on. Account states are refused here (hold is not). */
    async portalLogin(email: string, password: string, realm: PortalRealm) { applyAdminSeed(db); applyScheduledSettings(); return portalSignIn(email, password, realm); },
    verifyOtp: (challengeId: string, code: string) => verifySignInCode(challengeId, code),
    resendOtp: (challengeId: string) => resendSignInCode(challengeId),
    /** DEMO ONLY — the code that would be emailed (used by the review demo box when showDemoLogins is on). */
    demoOtp: (challengeId: string) => demoSignInCode(challengeId),
    expireSession: (idleMinutes: number) => expireSession(idleMinutes),
    async forgotPassword(email: string) { return requestPasswordReset(email); },
    /** DEMO ONLY — the reset link token that would be emailed. */
    demoResetToken: (email: string) => demoResetToken(email),
    checkResetToken: (token: string) => checkResetToken(token),
    resetPassword: (token: string, password: string) => resetPassword(token, password),
    demoAccounts() {
      return db.users.map((u) => ({ userId: u.userId, name: u.name, designation: u.designation, realm: u.realm, roles: u.roles }));
    },
    resetDemo() { resetDb(); setSession(null); },
  },

  // ── Admin (M01) ──────────────────────────────────────────────────────────
  admin: {
    async users() { requirePerm('admin.users'); return tx(() => db.users.map(({ password: _p, ...u }) => ({ ...u, grants: resolveGrants(u.roles, u.overrides) }))); },
    async saveUser(input: Partial<User> & { userId: string; password?: string; overrides?: Grants }, isNew: boolean) {
      requirePerm('admin.users', isNew ? 'add' : 'edit');
      return tx(() => {
        const existing = db.users.find((u) => u.userId.toLowerCase() === input.userId.toLowerCase());
        if (isNew && existing) throw new ApiError('DUPLICATE_KEY', `User ID ${input.userId} already exists.`, 409, { userId: 'Duplicate User ID' });
        if (input.warehouseCode && db.warehouses && !db.warehouses.some((w) => w.code === input.warehouseCode && w.active)) throw new ApiError('VALIDATION_FAILED', `Stockroom ${input.warehouseCode} is not an active warehouse.`, 422, { warehouseCode: 'Unknown or inactive' });
        if (isNew) {
          db.users.push({ realm: 'INTERNAL', status: 'Active', branchAccess: [input.branchCode ?? 'HO'], roles: [], designation: '', email: '', name: '', branchCode: 'HO', ...input, password: input.password || 'Welcome@2026', failed: 0 } as (typeof db.users)[number]);
          audit('user.created', 'user', input.userId, { ...input, password: undefined });
          // US-ADM-001: credentials go only to the user's registered email (rule N48); the temporary password must be changed at first login.
          notify('user.credentials_issued', 'Your Delbros Leasing account', `User ID ${input.userId} · temporary password sent to ${input.email}`, { extraUsers: [input.userId] });
          audit('user.credentials_issued', 'user', input.userId, { channel: 'Email', to: input.email, forcedChange: true });
        } else if (existing) {
          const before = { roles: existing.roles, status: existing.status, overrides: existing.overrides, warehouseCode: existing.warehouseCode, branchCode: existing.branchCode };
          Object.assign(existing, { ...input, password: input.password || existing.password });
          audit(before.status !== existing.status ? `user.${existing.status === 'Inactive' ? 'deactivated' : 'reactivated'}` : 'user.updated', 'user', input.userId, { roles: existing.roles, status: existing.status, overrides: existing.overrides, warehouseCode: existing.warehouseCode, branchCode: existing.branchCode }, undefined, before);
          if (input.password) { notify('user.credentials_issued', 'Your Delbros password was reset', `A temporary password was sent to ${existing.email}`, { extraUsers: [existing.userId] }); audit('user.password_reset', 'user', existing.userId, { channel: 'Email', to: existing.email, forcedChange: true }); }
        }
        return true;
      });
    },
    async unlock(userId: string) { requirePerm('admin.users', 'edit'); return tx(() => { const u = db.users.find((x) => x.userId === userId)!; u.failed = 0; u.lockedUntil = undefined; audit('user.unlocked', 'user', userId); return true; }); },
    roles() { return Object.entries(ROLE_TEMPLATES).map(([code, r]) => ({ code: code as RoleCode, ...r })); },
    resources() { return RESOURCES; },
    /** SUP-04 (NFR-AUD-001): filters by text, actor, entity, action prefix and date range (local dates, Asia/Manila). */
    async audit(filter: { q?: string; entityType?: string; actor?: string; action?: string; from?: string; to?: string } = {}) {
      requirePerm('admin.audit'); applyAdminSeed(db);
      const from = filter.from ? new Date(`${filter.from}T00:00:00+08:00`).getTime() : -Infinity;
      const to = filter.to ? new Date(`${filter.to}T23:59:59.999+08:00`).getTime() : Infinity;
      return tx(() => db.audit.filter((a) => (!filter.entityType || a.entityType === filter.entityType) && (!filter.actor || a.actor === filter.actor) && (!filter.action || a.action.startsWith(filter.action))
        && new Date(a.at).getTime() >= from && new Date(a.at).getTime() <= to && (!filter.q || JSON.stringify(a).toLowerCase().includes(filter.q.toLowerCase()))).slice(0, 2000));
    },
    /** Tamper evidence: recompute the hash chain oldest → newest. */
    async verifyAudit() {
      requirePerm('admin.audit'); applyAdminSeed(db);
      return tx(() => {
        let prev: string | undefined; let broken: string | undefined; let sealed = 0;
        for (let i = db.audit.length - 1; i >= 0; i--) {
          const e = db.audit[i];
          if (e.hash) { sealed++; if (!broken && (e.prevHash !== (prev ?? 'GENESIS') || e.hash !== auditHash(e.prevHash ?? 'GENESIS', e))) broken = e.id; }
          prev = e.hash;
        }
        return { ok: !broken, sealed, total: db.audit.length, brokenAt: broken, checkedAt: nowIso() };
      });
    },
    /** Export is itself an audited event (audit.export) and needs the export permission. */
    async logAuditExport(rows: number, filter: Record<string, string | undefined>) {
      requirePerm('admin.audit', 'export');
      return tx(() => { audit('audit.export', 'audit', 'audit-log.csv', { rows, filter }, 'Audit log exported to CSV'); return true; });
    },
    async settings() {
      requirePerm('admin.settings'); applyAdminSeed(db); applyScheduledSettings();
      return tx(() => db.settings.map((s) => { const d = DEFAULT_SETTINGS.find((x) => x.key === s.key); return settingMeta(d ? { ...d, value: s.value, updatedBy: s.updatedBy, updatedAt: s.updatedAt, effectiveFrom: s.effectiveFrom, scheduled: s.scheduled } : s); }));
    },
    async settingHistory(key: string) { requirePerm('admin.settings'); return tx(() => db.audit.filter((a) => a.entityType === 'setting' && a.entityId === key)); },
    /** Impact preview for settings that change account status (DBL-CNC-001 re-evaluates holds when the threshold changes). */
    async settingImpact(key: string, value: unknown) {
      requirePerm('admin.settings');
      return tx(() => {
        const n = Number(value);
        if (key === 'cnc.hold_threshold_days' && Number.isFinite(n)) {
          const hit = db.clients.filter((c) => c.status === 'Active' && db.invoices.some((i) => i.clientCode === c.clientCode && i.status !== 'Draft' && balance(i) > 0 && daysOverdue(i) > n));
          return { tone: hit.length ? 'danger' as const : 'success' as const, lines: [hit.length ? `${hit.length} active client(s) would go On Hold immediately at ${n} days: ${hit.map((c) => `${c.clientName} (${c.clientCode})`).join(', ')}.` : `No active client would go On Hold at ${n} days.`, 'Clients already on hold are not lifted automatically — a hold lift still needs the BR-03 tiered approval.'] };
        }
        if (key.startsWith('cnc.tier')) { const open = db.workflows.filter((w) => w.matrixCode === 'HOLD_LIFT' && w.status === 'Pending').length; return { tone: 'warning' as const, lines: [`Applies to new hold-lift requests only. ${open} pending request(s) keep the tier they were routed to.`] }; }
        if (key === 'cnc.hold_age_basis') return { tone: 'warning' as const, lines: ['Changes how every client’s aging buckets and the 30-day hold window are measured. Already-issued SOAs and holds are not rewritten (BR-18).'] };
        if (['fin.vat_pct', 'res.service_charge_pct', 'res.rate_per_km'].includes(key)) return { tone: 'warning' as const, lines: ['Applies to documents created on or after the effective date. Finalized invoices and memos keep their stamped values (BR-18).'] };
        return { tone: 'info' as const, lines: [] as string[] };
      });
    },
    /** SUP-05: validated, audited change. effectiveFrom in the future schedules the change; expected guards against concurrent edits. */
    async saveSetting(key: string, value: unknown, reason: string, opts: { effectiveFrom?: string; expected?: unknown } = {}) {
      requirePerm('admin.settings', 'edit');
      if (reason.trim().length < 10) throw new ApiError('VALIDATION_FAILED', 'Give a reason of at least 10 characters — it is kept in the audit trail.', 422, { reason: 'At least 10 characters' });
      return tx(() => {
        const s = db.settings.find((x) => x.key === key);
        if (!s) throw new ApiError('NOT_FOUND', `Setting ${key} not found.`, 404);
        const def = settingMeta({ ...(DEFAULT_SETTINGS.find((d) => d.key === key) ?? s), value: s.value });
        const err = validateSetting(def, value);
        if (err) throw new ApiError('VALIDATION_FAILED', err, 422, { value: err });
        if (opts.expected !== undefined && JSON.stringify(opts.expected) !== JSON.stringify(s.value)) throw new ApiError('CONCURRENT_EDIT', `Another administrator changed this setting to “${String(s.value)}” while you were editing. Reload and review before saving.`, 409);
        if (JSON.stringify(value) === JSON.stringify(s.value)) throw new ApiError('VALIDATION_FAILED', 'The new value is the same as the current value.', 422, { value: 'Unchanged' });
        const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
        const from = opts.effectiveFrom || today;
        if (from < today) throw new ApiError('VALIDATION_FAILED', 'The effective date cannot be in the past (BR-18 — history is never rewritten).', 422, { effectiveFrom: 'Today or later' });
        if (from > today) {
          s.scheduled = { value, from, by: me().userId, reason };
          audit('settings.scheduled', 'setting', key, { value, effectiveFrom: from }, reason, { value: s.value });
          return { scheduled: true, from };
        }
        const before = s.value; s.value = value; s.updatedBy = me().userId; s.updatedAt = nowIso(); s.effectiveFrom = from; s.scheduled = undefined;
        audit('settings.changed', 'setting', key, { value, effectiveFrom: from }, reason, { value: before });
        return { scheduled: false, from };
      });
    },
    async masterData() {
      requirePerm('admin.masterdata'); applyAdminSeed(db);
      return tx(() => ({
        branches: db.branches.map((b) => ({ ...b, usage: db.chassis.filter((c) => c.branchCode === b.code).length, warehouses: (db.warehouses ?? []).filter((w) => w.branchCode === b.code).map((w) => w.code) })),
        equipmentTypes: db.equipmentTypes.map((e) => ({ ...e, usage: db.chassis.filter((c) => c.chassisType === e.code).length, contracts: db.contracts.filter((c) => c.rates.some((r) => r.equipmentType === e.code && r.dailyRate > 0)).length })),
        parts: db.parts.map((p) => ({ ...p, onHand: db.stock.filter((s) => s.partCode === p.partCode).reduce((a, s) => a + s.qtyOnHand, 0) })),
        vendors: db.vendors.map((v) => ({ ...v, parts: db.parts.filter((p) => p.preferredVendorId === v.vendorId).map((p) => p.partCode), poCount: db.pos.filter((p) => p.vendorId === v.vendorId).length })),
        warehouses: db.warehouses ?? [], rateCards: db.rateCards ?? [], lists: db.masterLists ?? [],
      }));
    },
    /** SUP-06 add / edit (audited; edits need a reason). Records are never deleted — see setMasterActive. */
    async saveMaster(kind: MasterKind, record: Record<string, unknown>, isNew: boolean, reason?: string) {
      requirePerm('admin.masterdata', isNew ? 'add' : 'edit');
      if (!isNew && !reason?.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required when changing master data.', 422, { reason: 'Required' });
      return tx(() => {
        const { list, key } = masterRef(kind);
        const id = String(record[key] ?? '').trim();
        if (!id) throw new ApiError('VALIDATION_FAILED', 'Code / ID is required.', 422, { [key]: 'Required' });
        const match = (x: Record<string, unknown>) => String(x[key]).toLowerCase() === id.toLowerCase() && (kind !== 'list' || x.list === record.list);
        const ex = (list() as Record<string, unknown>[]).find(match);
        if (isNew && ex) throw new ApiError('DUPLICATE_KEY', `${id} already exists.`, 409, { [key]: 'Duplicate code' });
        if (!isNew && !ex) throw new ApiError('NOT_FOUND', `${id} not found.`, 404);
        if (isNew) { (list() as Record<string, unknown>[]).push({ active: true, ...record, [key]: id }); audit(`masterdata.${kind}.created`, kind, id, record, reason); }
        else { const before = structuredClone(ex); Object.assign(ex!, record); audit(`masterdata.${kind}.updated`, kind, id, record, reason, before); }
        return true;
      });
    },
    /** Soft delete (deactivate) / reactivate with a mandatory reason. */
    async setMasterActive(kind: MasterKind, id: string, active: boolean, reason: string, list?: string) {
      requirePerm('admin.masterdata', active ? 'edit' : 'delete');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      return tx(() => {
        const { list: rows, key } = masterRef(kind);
        const r = (rows() as Record<string, unknown>[]).find((x) => x[key] === id && (!list || x.list === list));
        if (!r) throw new ApiError('NOT_FOUND', `${id} not found.`, 404);
        if (kind === 'vendor') { const before = r.status; r.status = active ? 'Active' : 'Inactive'; r.statusReason = reason; audit(`masterdata.vendor.${active ? 'reactivated' : 'deactivated'}`, 'vendor', id, { status: r.status }, reason, { status: before }); return true; }
        const before = r.active; r.active = active; r.inactiveReason = active ? undefined : reason;
        audit(`masterdata.${kind}.${active ? 'reactivated' : 'deactivated'}`, kind, id, { active }, reason, { active: before });
        return true;
      });
    },
    /** BR-18: a new rate closes the current row the day before and opens a new effective-dated row. */
    async addRate(row: Omit<RateCardRow, 'id' | 'createdBy' | 'contractClass' | 'validTo'>, reason: string) {
      requirePerm('admin.masterdata', 'edit');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      if (!(row.dailyRate > 0)) throw new ApiError('VALIDATION_FAILED', 'Daily rate must be greater than zero.', 422, { dailyRate: 'Must be > 0' });
      return tx(() => {
        const cards = (db.rateCards ??= []);
        const cur = cards.find((r) => r.equipmentType === row.equipmentType && r.contractType === row.contractType && !r.validTo);
        if (cur && row.validFrom <= cur.validFrom) throw new ApiError('VALIDATION_FAILED', `Valid-from must be after ${cur.validFrom} (current rate).`, 422, { validFrom: 'After the current row' });
        if (cur) cur.validTo = addDays(`${row.validFrom}T00:00:00Z`, -1).slice(0, 10);
        const r: RateCardRow = { ...row, id: `RC-${uid()}`, contractClass: CONTRACT_TYPES[row.contractType].class, createdBy: me().userId, reason };
        cards.push(r); audit('masterdata.ratecard.added', 'ratecard', `${row.equipmentType}-${row.contractType}`, r, reason, cur);
        return r;
      });
    },
    /** DBL-PRC-010: price trail per part and supplier; the standard cost follows the latest effective price. */
    async addPartPrice(partCode: string, p: { unitCost: number; validFrom: string; vendorId?: string; source: string }, reason: string) {
      requirePerm('admin.masterdata', 'edit');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      if (!(p.unitCost > 0)) throw new ApiError('VALIDATION_FAILED', 'Unit cost must be greater than zero.', 422, { unitCost: 'Must be > 0' });
      return tx(() => {
        const part = db.parts.find((x) => x.partCode === partCode); if (!part) throw new ApiError('NOT_FOUND', 'Part not found.', 404);
        const hist = (part.priceHistory ??= []);
        const cur = hist.find((h) => !h.validTo && (h.vendorId ?? '') === (p.vendorId ?? ''));
        if (cur) cur.validTo = addDays(`${p.validFrom}T00:00:00Z`, -1).slice(0, 10);
        hist.unshift({ ...p });
        const before = part.standardCost;
        if (p.validFrom <= nowIso().slice(0, 10)) { part.standardCost = p.unitCost; part.rescuePrice = Math.round((p.unitCost * Math.round(Number(S()['prc.rescue_parts_uplift_pct'] ?? 0.15) * 100 + 100)) / 100); }
        audit('masterdata.part.price_changed', 'part', partCode, { ...p, standardCost: part.standardCost }, reason, { standardCost: before });
        return part;
      });
    },
  },

  // ── Reference data (any signed-in user) ─────────────────────────────────
  ref: {
    async all() {
      await delay(40);
      return structuredClone({
        branches: db.branches, equipmentTypes: db.equipmentTypes, parts: db.parts, vendors: db.vendors,
        users: db.users.filter((u) => u.realm === 'INTERNAL').map((u) => ({ userId: u.userId, name: u.name, roles: u.roles, branchCode: u.branchCode })),
        clients: db.clients.map((c) => ({ clientCode: c.clientCode, clientName: c.clientName, status: c.status })),
        settings: settings(),
      });
    },
  },

  // ── Dashboard / inbox ────────────────────────────────────────────────────
  inbox: {
    async approvals() {
      const u = me();
      return tx(() => {
        const mine = db.workflows.filter((w) => canActOn(w, u));
        const escalated = mine.filter((w) => { const d = w.steps[w.currentStep]?.dueAt; return d && new Date(d) < new Date(); });
        return { pending: mine, escalated, submitted: db.workflows.filter((w) => w.requestedBy === u.userId), history: db.workflows.filter((w) => w.status !== 'Pending').slice(0, 50) };
      });
    },
    async workflow(id: string) { return tx(() => db.workflows.find((w) => w.id === id) ?? null); },
    async decide(id: string, decision: 'Approved' | 'Rejected', comment: string) { await delay(); const wf = decide(id, decision, comment); return structuredClone(wf); },
    async notifications() { const u = me(); return tx(() => db.notifications.filter((n) => n.userId === u.userId).slice(0, 100)); },
    async markRead(id?: string) { const u = me(); return tx(() => { db.notifications.forEach((n) => { if (n.userId === u.userId && (!id || n.id === id)) n.read = true; }); return true; }); },
    async ack(id: string) { return tx(() => { const n = db.notifications.find((x) => x.id === id); if (n) { n.ackAt = nowIso(); n.read = true; db.notifications.forEach((o) => { if (o.title === n.title) { o.ackAt = n.ackAt; } }); } return true; }); },
    async counts() {
      const u = session(); if (!u) return { approvals: 0, unread: 0 };
      await delay(20);
      return { approvals: db.workflows.filter((w) => canActOn(w, u)).length, unread: db.notifications.filter((n) => n.userId === u.userId && !n.read).length };
    },
  },

  // ── Clients (M02) ────────────────────────────────────────────────────────
  clients: {
    async list(f: { q?: string; status?: string; branch?: string } = {}) {
      requirePerm('clients.client'); runAutoHold(); expireContracts();
      return tx(() => db.clients.filter((c) => inScope(c.branchCode) || me().roles.includes('ACCOUNT_EXECUTIVE'))
        .filter((c) => (!f.status || c.status === f.status) && (!f.branch || c.branchCode === f.branch) && (!f.q || `${c.clientCode} ${c.clientName}`.toLowerCase().includes(f.q.toLowerCase())))
        .map((c) => ({ ...c, outstanding: outstandingOf(c.clientCode), ewallet: db.ewallets.find((e) => e.clientCode === c.clientCode)?.balance, ...clientExtras(c) })));
    },
    /** SCR-04: next auto-generated company code (peek — consumed only when the client is saved with it). */
    nextClientCode() { return `C-${String((db.seq.CL ?? 0) + 1).padStart(5, '0')}`; },
    async addContact(code: string, p: { firstName: string; lastName: string; phone: string; email: string; isSignatory?: boolean }) {
      requirePerm('clients.client', 'edit');
      return tx(() => {
        if (!p.firstName.trim() || !p.lastName.trim()) throw new ApiError('VALIDATION_FAILED', 'Contact first and last name are required.', 422);
        const c = mustClient(code); const ct = { id: uid(), ...p }; c.contacts.push(ct);
        audit('client.contact_added', 'client', code, ct); return ct;
      });
    },
    async get(code: string) {
      requirePerm('clients.client'); runAutoHold(); expireContracts();
      return tx(() => {
        const c = mustClient(code);
        return {
          ...clientExtras(c), activities: db.salesActivities.filter((a) => a.clientCode === code),
          accreditations: db.accreditations.filter((a) => a.clientCode === code).map((a) => ({ ...a, workflow: db.workflows.find((w) => w.id === a.workflowId) })),
          liftPending: db.workflows.some((w) => w.matrixCode === 'HOLD_LIFT' && w.subjectId === code && w.status === 'Pending'),
          client: c, outstanding: outstandingOf(code), ewallet: db.ewallets.find((e) => e.clientCode === code) ?? null,
          contracts: db.contracts.filter((x) => x.clientCode === code), cashBonds: db.cashBonds.filter((x) => x.clientCode === code),
          onHire: db.chassis.filter((x) => x.currentClientCode === code && x.status === 'On Hire').map((x) => ({ ...x, gateOut: db.gatePasses.find((g) => g.gatePassNo === x.currentGatePassNo)?.actualEventAt })),
          invoices: db.invoices.filter((i) => i.clientCode === code).map((i) => ({ ...i, payment: paymentStatus(i), balance: balance(i) })),
          ewas: db.ewas.filter((e) => e.clientCode === code), rescues: db.rescues.filter((r) => r.clientCode === code),
          accreditation: db.accreditations.find((a) => a.clientCode === code) ?? null,
          holdEvents: db.holdEvents.filter((h) => h.clientCode === code),
          audit: db.audit.filter((a) => a.entityType === 'client' && a.entityId === code),
        };
      });
    },
    async createInternal(f: ClientInternalForm) {
      requirePerm('clients.client', 'add');
      return tx(() => {
        if (clientOf(f.clientCode)) throw new ApiError('DUPLICATE_KEY', `Company code ${f.clientCode} already exists.`, 409, { clientCode: 'Company code already exists' });
        if (f.clientCode === api.clients.nextClientCode()) nextNo('CL', 'C-', 5); // consume the auto-generated number
        const dup = db.clients.find((c) => c.clientName.trim().toLowerCase() === f.clientName.trim().toLowerCase());
        const c: Client = {
          clientCode: f.clientCode, clientName: f.clientName, billingName: f.billingName, address1: f.address1, address2: f.address2, country: 'PHILIPPINES', billingCycle: 'Weekly',
          aeAssigned: f.aeAssigned, branchCode: f.branchCode, status: 'Draft', allowLt: false, allowSt: false, allowOnline: false, allowSpecial: false, allowRescue: false,
          cwsBranchAccess: [f.branchCode], isLegal: false, isCollectionAgency: false, registrationSource: 'Internal', createdAt: nowIso(),
          contacts: [{ id: uid(), firstName: f.firstName, lastName: f.lastName, phone: f.phone, email: f.email, isPrimary: true }],
        };
        db.clients.unshift(c); audit('client.created', 'client', c.clientCode, c);
        notify('client.internal_registered', `New client (Draft): ${c.clientName}`, `${c.clientCode} · ${c.branchCode} — start accreditation next.`, { aeUserId: c.aeAssigned, branchCode: c.branchCode, link: `/clients/${c.clientCode}` }); // N47
        return { client: c, possibleDuplicate: dup?.clientCode };
      });
    },
    /** Portal "Request portal access" for a client or a vendor: TIN, contact, branch, supporting documents; one email = one company (see ./portalAuth.ts). */
    async registerPortal(f: ClientPortalForm) { return requestPortalAccess(f); },
    async update(code: string, patch: Partial<Client>) {
      requirePerm('clients.client', 'edit');
      return tx(() => {
        const c = mustClient(code);
        const flags = ['allowLt', 'allowSt', 'allowOnline', 'allowSpecial', 'allowRescue'] as const;
        if (flags.some((k) => k in patch && patch[k] !== c[k])) requirePerm('clients.client', 'approve');
        if ('status' in patch && patch.status !== c.status) throw new ApiError('FORBIDDEN', 'Status changes go through accreditation, hold or hold-lift workflows.', 403);
        const before = structuredClone(c);
        Object.assign(c, patch); audit('client.updated', 'client', code, patch, undefined, before);
        return c;
      });
    },
    async approvePortal(code: string, approve: boolean, reason?: string) {
      requirePerm('clients.client', 'edit');
      return tx(() => {
        const c = mustClient(code); const pu = db.users.find((u) => u.clientCode === code);
        if (!approve) {
          c.status = 'Inactive'; notify('client.portal_denied', 'Registration not approved', reason ?? '', { clientCode: code });
          audit('client.portal_denied', 'client', code, undefined, reason);
        } else audit('client.portal_approved', 'client', code);
        if (pu && approve) pu.status = 'Active';
        return true;
      });
    },
    async submitAccreditation(code: string, bici: Record<string, unknown>) {
      requirePerm('clients.accreditation', 'add');
      await delay();
      const c = mustClient(code);
      if (c.status !== 'Draft') throw new ApiError('INVALID_STATE', 'Only Draft clients can be submitted for accreditation.', 409);
      if (clientExtras(c).portalPending) throw new ApiError('INVALID_STATE', 'Approve the portal registration first (DBL-CLT-019), then submit for accreditation.', 409);
      if (db.accreditations.some((a) => a.clientCode === code && a.status.startsWith('Pending'))) throw new ApiError('INVALID_STATE', 'An accreditation is already in progress.', 409);
      const wf = startWorkflow('ACCREDITATION', `Accreditation — ${c.clientName}`, 'client', code, [
        { label: 'C&C investigation (BICI)', roles: ['CNC_OFFICER'] }, { label: 'Finance endorsement', roles: ['FINANCE_MANAGER'] }, { label: 'VP final sign-off', roles: ['VP'] },
      ], undefined, c.branchCode);
      const prev = db.accreditations.find((a) => a.clientCode === code && a.status === 'Rejected');
      db.accreditations.unshift({ id: uid(), clientCode: code, status: 'Pending C&C', bici: bici as never, workflowId: wf.id, submittedAt: nowIso(), documents: [], log: [{ at: nowIso(), by: me().userId, action: prev ? 'Resubmitted after rejection' : 'Submitted for accreditation' }] });
      audit('client.accreditation_submitted', 'client', code, { workflow: wf.id });
      notify('client.accreditation.stage', `Accreditation started: ${c.clientName}`, 'Stage: C&C investigation (BICI) → Finance → VP.', { aeUserId: c.aeAssigned, branchCode: c.branchCode, link: '/clients/accreditation' }); // N46
      persist();
      return structuredClone(wf);
    },
    async accreditations() {
      requirePerm('clients.accreditation');
      return tx(() => db.accreditations.map((a) => {
        const wf = db.workflows.find((w) => w.id === a.workflowId);
        accreditationStage(a.clientCode);
        if (wf?.status === 'Pending') a.status = ACC_STAGES[wf.currentStep] ?? a.status;
        const c = clientOf(a.clientCode);
        const step = wf?.status === 'Pending' ? wf.steps[wf.currentStep] : undefined;
        const stageSince = wf ? (wf.currentStep > 0 ? wf.steps[wf.currentStep - 1]?.decidedAt : undefined) ?? wf.requestedAt : a.submittedAt;
        const endAt = wf?.status === 'Pending' ? nowIso() : wf?.steps.map((s) => s.decidedAt).filter(Boolean).pop() ?? nowIso();
        const rejected = wf?.steps.find((s) => s.decision === 'Rejected');
        return {
          ...a, clientName: clientName(a.clientCode), workflow: wf, branchCode: c?.branchCode, aeAssigned: c?.aeAssigned, clientStatus: c?.status, creditLimit: c?.creditLimit,
          dueAt: step?.dueAt, escalated: !!step?.dueAt && new Date(step.dueAt) < new Date(), stageSince, daysInStage: Math.max(0, daysBetween(stageSince, endAt)),
          elapsedHours: step?.dueAt ? Math.round((Date.now() - new Date(stageSince).getTime()) / 3_600_000) : undefined, windowHours: Number(S()['wf.escalation_hours'] ?? 48),
          currentApprovers: step ? db.users.filter((u) => u.realm === 'INTERNAL' && u.roles.some((r) => step.roles.includes(r))).map((u) => u.userId) : [],
          rejection: rejected ? { step: rejected.label, by: rejected.decidedBy, at: rejected.decidedAt, reason: (rejected.comment ?? '').split('|').filter(Boolean).map((s) => s.split(':').slice(2).join(':')).pop() } : undefined,
        };
      }));
    },
    async saveBici(id: string, bici: Record<string, unknown>) {
      requirePerm('clients.accreditation', 'check');
      return tx(() => { const a = db.accreditations.find((x) => x.id === id)!; a.bici = { ...a.bici, ...bici }; (a.log ??= []).push({ at: nowIso(), by: me().userId, action: `BICI form saved (${Object.keys(bici).filter((k) => bici[k] !== undefined && bici[k] !== '').length} fields)` }); audit('client.bici_saved', 'client', a.clientCode, bici); return a; });
    },
    /** SCR-07: supporting documents for BI/CI (SEC / DTI certificate, financial statements, site-visit photos — FRS 447). File content is stored by the document service; the mock keeps the name. */
    async addAccreditationDoc(id: string, kind: string, fileName: string) {
      requirePerm('clients.accreditation');
      return tx(() => { const a = db.accreditations.find((x) => x.id === id)!; const d = { id: uid(), kind, fileName, at: nowIso(), by: me().userId }; (a.documents ??= []).push(d); (a.log ??= []).push({ at: d.at, by: d.by, action: `Attached ${kind}: ${fileName}` }); audit('client.bici_document', 'client', a.clientCode, d); return d; });
    },
    /** SCR-07 step actions. C&C submits the evaluation (Recommend → next step; Do not recommend → rejected), Finance and VP approve/reject with comments; VP sets activation. */
    async decideAccreditation(id: string, decision: 'Approved' | 'Rejected', comment: string, opts: { bici?: Record<string, unknown>; activation?: NonNullable<Accreditation['activation']> } = {}) {
      await delay();
      const a = db.accreditations.find((x) => x.id === id); if (!a) throw new ApiError('NOT_FOUND', 'Accreditation not found.', 404);
      const wf = db.workflows.find((w) => w.id === a.workflowId)!;
      if (!comment.trim()) throw new ApiError('VALIDATION_FAILED', 'Comments are required for this decision.', 422, { comment: 'Comments are required' });
      if (wf.currentStep === 0 && opts.bici) {
        const b = { ...a.bici, ...opts.bici } as Record<string, unknown>;
        const missing = ['secReg', 'tin', 'tradeReferences', 'bankReferences', 'creditScore', 'grade', 'result', 'reasoning'].filter((k) => b[k] === undefined || b[k] === '' || b[k] === null);
        if (missing.length) throw new ApiError('VALIDATION_FAILED', `Complete the required BICI fields: ${missing.join(', ')}.`, 422, Object.fromEntries(missing.map((k) => [k, 'Required'])));
        a.bici = b as never;
      }
      if (wf.currentStep === 2 && decision === 'Approved') {
        if (!opts.activation?.signOffDate) throw new ApiError('VALIDATION_FAILED', 'Sign-off date is required.', 422, { signOffDate: 'Required' });
        a.activation = opts.activation;
      }
      const stepLabel = wf.steps[wf.currentStep]?.label;
      decide(wf.id, decision, comment);
      (a.log ??= []).push({ at: nowIso(), by: me().userId, action: `${stepLabel}: ${decision} — ${comment}` });
      accreditationStage(a.clientCode);
      persist();
      return structuredClone(a);
    },
    async setFlags(code: string, flags: Pick<Client, 'allowLt' | 'allowSt' | 'allowOnline' | 'allowSpecial' | 'allowRescue' | 'cwsBranchAccess'>) {
      return tx(() => { const c = mustClient(code); Object.assign(c, flags); audit('client.flags', 'client', code, flags); return c; });
    },
    async placeHold(code: string, reason: string) {
      requirePerm('cnc.aging', 'edit');
      return tx(() => {
        const c = mustClient(code); c.status = 'Hold';
        db.holdEvents.unshift({ id: uid(), clientCode: code, type: 'Manual Hold', at: nowIso(), by: me().userId, outstanding: outstandingOf(code) });
        notify('client.hold.applied', `Credit hold: ${c.clientName}`, reason, { clientCode: code, aeUserId: c.aeAssigned });
        audit('client.hold.manual', 'client', code, { status: 'Hold' }, reason); return c;
      });
    },
    /** SCR-11 (DBL-RPT-003 KPIs + DBL-CLT-015 targets). `month` = 'YYYY-MM'; every figure is for that calendar month unless labelled otherwise. */
    async salesKpis(f: { ae?: string; region?: string; month?: string } = {}) {
      requirePerm('clients.sales'); expireContracts();
      return tx(() => {
        const month = f.month || nowIso().slice(0, 7);
        const [y, m] = month.split('-').map(Number);
        const from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
        const inMonth = (d?: string) => !!d && new Date(d) >= from && new Date(d) < to;
        const regionOf = (b?: string) => db.branches.find((x) => x.code === b)?.region;
        const inRegion = (b?: string) => !f.region || regionOf(b) === f.region;
        const clientOk = (code?: string) => { const c = code ? clientOf(code) : undefined; return !c || ((!f.ae || c.aeAssigned === f.ae) && inRegion(c.branchCode)); };
        const cs = db.clients.filter((c) => (!f.ae || c.aeAssigned === f.ae) && inRegion(c.branchCode));
        const acts = db.salesActivities.filter((a) => (!f.ae || a.aeUserId === f.ae) && clientOk(a.clientCode));
        const mActs = acts.filter((a) => inMonth(a.at ?? a.date));
        const accreditedIn = (aeId?: string) => db.accreditations.filter((a) => a.status === 'Approved' && clientOk(a.clientCode) && (!aeId || clientOf(a.clientCode)?.aeAssigned === aeId) && inMonth(db.workflows.find((w) => w.id === a.workflowId)?.steps.slice(-1)[0]?.decidedAt)).length;
        const today = new Date(); const horizon = Number(S()['clt.renewal_amber_days'] ?? 90);
        const ctOk = (ct: Contract) => clientOk(ct.clientCode);
        const renewalsDue = db.contracts.filter((ct) => ctOk(ct) && ct.status === 'Active' && ct.expiryDate && new Date(ct.expiryDate) >= today && new Date(ct.expiryDate) < new Date(Date.now() + horizon * 86400000));
        const renewalsOverdue = db.contracts.filter((ct) => ctOk(ct) && ct.status === 'Expired' && db.contracts.find((x) => x.contractNo === ct.renewedTo)?.status !== 'Active');
        const gp = db.gatePasses.filter((g) => clientOk(g.clientCode) && inRegion(g.branchCode));
        const trackerDays = Number(S()['sal.tracker_logging_days'] ?? 1);
        const onTime = (a: SalesActivity) => !a.loggedAt || daysBetween(a.at ?? a.date, a.loggedAt) <= trackerDays;
        // Six calendar months ending with the selected month — same gate-pass data as the tiles.
        const byMonth = Array.from({ length: 6 }, (_, i) => {
          const d0 = new Date(y, m - 1 - (5 - i), 1), d1 = new Date(y, m - (5 - i), 1);
          const inM = (d?: string) => !!d && new Date(d) >= d0 && new Date(d) < d1;
          return { month: d0.toLocaleString('en-PH', { month: 'short', year: '2-digit' }), pullOuts: gp.filter((g) => g.direction === 'OUT' && inM(g.actualEventAt)).length, returns: gp.filter((g) => g.direction === 'IN' && inM(g.actualEventAt)).length };
        });
        // Weekly visits (Mon-start weeks overlapping the month).
        const weeks: { label: string; start: Date; end: Date }[] = [];
        for (let d = new Date(from); d < to; d.setDate(d.getDate() + 7)) { const s = new Date(d); const e = new Date(d); e.setDate(e.getDate() + 7); weeks.push({ label: `Wk ${weeks.length + 1} (${s.getDate()}–${Math.min(new Date(e.getTime() - 86400000).getDate(), new Date(y, m, 0).getDate())})`, start: s, end: e < to ? e : to }); }
        const aes = db.users.filter((u) => u.realm === 'INTERNAL' && u.roles.includes('ACCOUNT_EXECUTIVE') && (!f.ae || u.userId === f.ae));
        const isVisit = (a: SalesActivity) => a.type === 'Visit' || a.type === 'Meeting';
        const isCall = (a: SalesActivity) => a.type === 'Call' || a.type === 'Email';
        const byAe = aes.map((u) => {
          const mine = mActs.filter((a) => a.aeUserId === u.userId); const myClients = cs.filter((c) => c.aeAssigned === u.userId);
          return {
            aeUserId: u.userId, ae: u.name, clients: myClients.length, activities: mine.length,
            newClients: myClients.filter((c) => inMonth(c.createdAt)).length, accreditations: accreditedIn(u.userId),
            visits: mine.filter(isVisit).length, calls: mine.filter(isCall).length, combinedCalls: mine.filter((a) => isVisit(a) || isCall(a)).length,
            trackerCompliancePct: mine.length ? Math.round((mine.filter(onTime).length / mine.length) * 100) : null,
            weeklyVisits: weeks.map((w) => mine.filter((a) => isVisit(a) && new Date(a.at ?? a.date) >= w.start && new Date(a.at ?? a.date) < w.end).length),
            renewalsDue: renewalsDue.filter((ct) => clientOf(ct.clientCode)?.aeAssigned === u.userId).length,
            pullOuts: gp.filter((g) => g.direction === 'OUT' && inMonth(g.actualEventAt) && clientOf(g.clientCode)?.aeAssigned === u.userId).length,
            returns: gp.filter((g) => g.direction === 'IN' && inMonth(g.actualEventAt) && clientOf(g.clientCode)?.aeAssigned === u.userId).length,
          };
        });
        return {
          month, weeks: weeks.map((w) => w.label),
          newClients: cs.filter((c) => inMonth(c.createdAt)).length, accredited: accreditedIn(), activeClients: cs.filter((c) => c.status === 'Active').length,
          visits: mActs.filter(isVisit).length, calls: mActs.filter(isCall).length,
          renewalsDue: renewalsDue.length, renewalsOverdue: renewalsOverdue.length, renewalHorizonDays: horizon,
          renewalList: [...renewalsDue, ...renewalsOverdue].map((ct) => ({ contractNo: ct.contractNo, clientName: clientName(ct.clientCode), expiryDate: ct.expiryDate, status: ct.status })),
          pullOuts: gp.filter((g) => g.direction === 'OUT' && inMonth(g.actualEventAt)).length, returns: gp.filter((g) => g.direction === 'IN' && inMonth(g.actualEventAt)).length,
          byMonth, byAe,
          activities: mActs.sort((a, b) => (b.at ?? b.date).localeCompare(a.at ?? a.date)),
        };
      });
    },
    /** DBL-CLT-014 activity log. AE defaults to the signed-in user; a Sales Director may log for another AE. */
    async logActivity(a: Omit<SalesActivity, 'id' | 'aeUserId' | 'date' | 'loggedAt' | 'loggedBy'> & { aeUserId?: string }) {
      const u = requirePerm('clients.sales');
      return tx(() => {
        const missing = (['type', 'at', 'businessType', 'location', 'outcome'] as const).filter((k) => !String(a[k] ?? '').trim());
        if (!a.clientCode && !a.prospectCompany?.trim()) missing.push('prospectCompany' as never);
        if (missing.length) throw new ApiError('VALIDATION_FAILED', 'Complete the required fields.', 422, Object.fromEntries(missing.map((k) => [k, 'Required'])));
        if (new Date(a.at!) > new Date()) throw new ApiError('VALIDATION_FAILED', 'Activity date cannot be in the future.', 422, { at: 'Cannot be in the future' });
        const aeUserId = a.aeUserId && a.aeUserId !== u.userId && u.roles.includes('SALES_DIRECTOR') ? a.aeUserId : u.userId;
        const rec: SalesActivity = { ...a, id: uid(), aeUserId, date: a.at!.slice(0, 10), loggedAt: nowIso(), loggedBy: u.userId };
        db.salesActivities.unshift(rec); audit('sales.activity_logged', 'client', a.clientCode ?? a.prospectCompany ?? '—', rec); return rec;
      });
    },
  },

  // ── Contracts & cash bond (M02) ─────────────────────────────────────────
  contracts: {
    async list(f: { client?: string; status?: string } = {}) {
      requirePerm('clients.contract'); expireContracts();
      return tx(() => db.contracts.filter((c) => (!f.client || c.clientCode === f.client) && (!f.status || c.status === f.status)).map((c) => {
        const cl = clientOf(c.clientCode);
        return { ...c, clientName: clientName(c.clientCode), clientStatus: cl?.status, branchCode: c.branchCode ?? cl?.branchCode, aeUserId: c.aeUserId ?? cl?.aeAssigned, version: c.version ?? 1, onHireUnits: db.chassis.filter((x) => x.currentContractNo === c.contractNo && x.status === 'On Hire').length };
      }));
    },
    async get(no: string) {
      requirePerm('clients.contract'); expireContracts();
      return tx(() => {
        const c = db.contracts.find((x) => x.contractNo === no); if (!c) throw new ApiError('NOT_FOUND', 'Contract not found', 404);
        const cl = clientOf(c.clientCode);
        const sig = cl?.contacts.find((x) => x.id === c.signatoryId);
        return {
          ...c, clientName: clientName(c.clientCode), clientStatus: cl?.status, branchCode: c.branchCode ?? cl?.branchCode, aeUserId: c.aeUserId ?? cl?.aeAssigned, version: c.version ?? 1,
          signatoryName: sig ? `${sig.firstName} ${sig.lastName}` : undefined, clientAddress: [cl?.address1, cl?.address2, cl?.city].filter(Boolean).join(', '),
          units: db.chassis.filter((x) => x.currentContractNo === no && x.status === 'On Hire').map((x) => ({ ...x, gateOut: db.gatePasses.find((g) => g.gatePassNo === x.currentGatePassNo)?.actualEventAt })),
          cashBonds: db.cashBonds.filter((b) => b.contractNo === no),
          approvalWf: c.approval ? db.workflows.find((w) => w.id === c.approval!.workflowId) : undefined,
          terminationWf: c.termination ? db.workflows.find((w) => w.id === c.termination!.workflowId) : undefined,
          audit: db.audit.filter((a) => a.entityType === 'contract' && a.entityId === no),
        };
      });
    },
    /** SCR-08: next contract number preview (assigned on save). */
    peekNo(type: ContractType) { return `${type}-${new Date().getFullYear()}-${String((db.seq.CT ?? 0) + 1).padStart(4, '0')}`; },
    rateTemplate(type: ContractType) {
      const base = { LTL: 900, SPL: 1100, QLP: 1200 }[type];
      return db.equipmentTypes.map((e, i) => ({ equipmentType: e.code, dailyRate: base + i * 50, indemnity: 350000 + i * 25000 }));
    },
    async create(input: Omit<Contract, 'contractNo' | 'class' | 'status' | 'createdAt'> & { varianceReason?: string }) {
      const u = requirePerm('clients.contract', 'add');
      return tx(() => {
        const c = mustClient(input.clientCode);
        if (c.status !== 'Active') throw new ApiError('CREDIT_GATE_BLOCKED', `${c.clientName} is ${c.status}; contracts can only be created for Active, accredited clients.`, 409);
        if (input.contractType === 'LTL' && !c.allowLt) throw new ApiError('ELIGIBILITY', 'Client is not eligible for long-term leases (Allow LT = off).', 409);
        if (input.contractType !== 'LTL' && !c.allowSt) throw new ApiError('ELIGIBILITY', 'Client is not eligible for short-term leases (Allow ST = off).', 409);
        const err = validateContractDuration(input.contractType, input.effectiveDate, input.expiryDate);
        if (err) throw new ApiError('VALIDATION_FAILED', err, 422, { expiryDate: err });
        if (!input.signatoryId) throw new ApiError('VALIDATION_FAILED', 'Select the client signatory.', 422, { signatoryId: 'Signatory is required' });
        if (input.customType && !input.customType.name.trim()) throw new ApiError('VALIDATION_FAILED', 'Name the custom contract type.', 422, { customName: 'Required' });
        const qty = input.rates.reduce((a, r) => a + (r.qty ?? 0), 0);
        if (qty < 1) throw new ApiError('VALIDATION_FAILED', 'Enter the quantity for at least one equipment type.', 422, { unitQty: 'At least 1 unit' });
        const template = api.contracts.rateTemplate(input.contractType);
        const tol = Number(S()['clt.rate_variance_tolerance_pct'] ?? 10);
        const above = ratesAboveTolerance(input.rates, template, tol);
        const changed = input.rates.some((r) => r.dailyRate !== template.find((t) => t.equipmentType === r.equipmentType)?.dailyRate);
        if ((changed || input.customType) && !input.varianceReason?.trim()) throw new ApiError('VALIDATION_FAILED', 'Give the reason for the custom type / rate override.', 422, { varianceReason: 'Reason is required' });
        const { varianceReason, ...rest } = input;
        const no = nextNo('CT', `${input.contractType}-${new Date().getFullYear()}-`, 4);
        const ct: Contract = {
          ...rest, unitQty: qty, rates: input.rates.map((r) => ({ ...r, templateRate: template.find((t) => t.equipmentType === r.equipmentType)?.dailyRate })),
          contractNo: no, class: CONTRACT_TYPES[input.contractType].class, status: 'Draft', createdAt: nowIso(), version: 1, createdBy: u.userId, aeUserId: c.aeAssigned, branchCode: c.branchCode,
          history: [{ status: 'Draft', at: nowIso(), by: u.userId }], versions: [{ version: 1, at: nowIso(), by: u.userId, reason: 'Created' }],
        };
        // DBL-ALO-001: custom types and rates above tolerance need approval before the contract goes to the client.
        if (input.customType || above.length) {
          const kind = input.customType && above.length ? 'Custom type + rate variance' : input.customType ? 'Custom type' : 'Rate variance';
          const wf = startWorkflow('CONTRACT_APPROVAL', `Contract terms (${kind}) — ${no}`, 'contract', no, [{ label: 'Sales Director review', roles: ['SALES_DIRECTOR'] }, { label: 'Finance Manager approval', roles: ['FINANCE_MANAGER'] }], undefined, c.branchCode);
          ct.approval = { workflowId: wf.id, reason: varianceReason ?? '', status: 'Pending', kind };
        }
        if (changed) audit('contract.rate_override', 'contract', no, { rates: input.rates }, varianceReason, { rates: template });
        db.contracts.unshift(ct); audit('contract.created', 'contract', no, ct); return ct;
      });
    },
    /** DBL-CLT-010 lifecycle step. Each step records date + user; signed and notarized steps carry the uploaded copy. */
    async advance(no: string, to: Contract['status'], opts: { note?: string; fileName?: string } = {}) {
      const u = requirePerm('clients.contract', 'edit');
      return tx(() => {
        const ct = db.contracts.find((x) => x.contractNo === no)!;
        const from = ct.status === 'Printed' ? 'Sent to Client' : ct.status;
        const next: Record<string, string> = { Draft: 'Sent to Client', 'Sent to Client': 'Signed', Signed: 'For Notarisation', 'For Notarisation': 'Notarized', Notarized: 'Active' };
        if (next[from] !== to) throw new ApiError('INVALID_STATE', `A ${ct.status} contract cannot move to ${to}.`, 409);
        if (to === 'Sent to Client' && ct.approval && ct.approval.status !== 'Approved') throw new ApiError('APPROVAL_REQUIRED', `The ${ct.approval.kind.toLowerCase()} approval is ${ct.approval.status.toLowerCase()}; the contract cannot be sent yet.`, 409);
        if ((to === 'Signed' || to === 'Notarized') && !opts.fileName) throw new ApiError('VALIDATION_FAILED', `Upload the ${to === 'Signed' ? 'signed' : 'notarized'} copy.`, 422, { fileName: 'Upload required' });
        if (to === 'Active') {
          assertGate(ct.clientCode, 'CONTRACT_ACTIVATE');
          notify('contract.activated', `Contract activated: ${no}`, `${clientName(ct.clientCode)} · ${ct.contractType} Class ${ct.class}`, { clientCode: ct.clientCode, aeUserId: clientOf(ct.clientCode)?.aeAssigned });
          const prev = ct.renewalOf ? db.contracts.find((x) => x.contractNo === ct.renewalOf) : undefined;
          if (prev && ['Active', 'Expired'].includes(prev.status)) { prev.status = 'Renewed'; prev.renewedTo = no; (prev.history ??= []).push({ status: 'Renewed', at: nowIso(), by: u.userId, note: `Renewed by ${no}` }); }
        }
        if (opts.fileName) (ct.documents ??= []).push({ kind: to === 'Signed' ? 'Signed copy' : 'Notarized copy', fileName: opts.fileName, at: nowIso(), by: u.userId });
        (ct.history ??= []).push({ status: to, at: nowIso(), by: u.userId, note: opts.note, fileName: opts.fileName });
        const before = ct.status; ct.status = to; audit('contract.status', 'contract', no, { status: to, fileName: opts.fileName }, opts.note, { status: before }); return ct;
      });
    },
    /** DBL-CLT-011 renewal: a new linked Draft contract carrying the current terms; the old one becomes Renewed when the renewal is activated. */
    async renew(no: string, dates: { effectiveDate: string; expiryDate?: string }) {
      const u = requirePerm('clients.contract', 'add');
      return tx(() => {
        const old = db.contracts.find((x) => x.contractNo === no)!;
        if (!['Active', 'Expired'].includes(old.status)) throw new ApiError('INVALID_STATE', 'Only Active or Expired contracts can be renewed.', 409);
        if (db.contracts.some((x) => x.renewalOf === no && !['Terminated'].includes(x.status))) throw new ApiError('INVALID_STATE', 'A renewal already exists for this contract.', 409);
        const err = validateContractDuration(old.contractType, dates.effectiveDate, dates.expiryDate);
        if (err) throw new ApiError('VALIDATION_FAILED', err, 422, { expiryDate: err });
        const nn = nextNo('CT', `${old.contractType}-${new Date().getFullYear()}-`, 4);
        const ct: Contract = { ...structuredClone(old), ...dates, contractNo: nn, status: 'Draft', createdAt: nowIso(), renewalOf: no, renewedTo: undefined, version: 1, createdBy: u.userId, approval: undefined, termination: undefined, documents: [], history: [{ status: 'Draft', at: nowIso(), by: u.userId, note: `Renewal of ${no}` }], versions: [{ version: 1, at: nowIso(), by: u.userId, reason: `Renewal of ${no}` }] };
        db.contracts.unshift(ct); old.renewedTo = nn; (old.history ??= []).push({ status: 'Renewal drafted', at: nowIso(), by: u.userId, note: nn });
        audit('contract.renewal_created', 'contract', nn, { renewalOf: no }); return ct;
      });
    },
    /** Amendment = new version of the same contract. Rate snapshots never change silently (BR-18); every version is audited. */
    async amend(no: string, patch: { reason: string; rates?: Contract['rates']; creditTermDays?: number; paymentMethod?: string; billingCycle?: Contract['billingCycle']; expiryDate?: string; fileName?: string }) {
      const u = requirePerm('clients.contract', 'edit');
      return tx(() => {
        const ct = db.contracts.find((x) => x.contractNo === no)!;
        if (!['Active', 'Draft', 'Sent to Client'].includes(ct.status)) throw new ApiError('INVALID_STATE', `A ${ct.status} contract cannot be amended.`, 409);
        if (!patch.reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required for an amendment.', 422, { reason: 'Required' });
        if (patch.expiryDate !== undefined) { const err = validateContractDuration(ct.contractType, ct.effectiveDate, patch.expiryDate || undefined); if (err) throw new ApiError('VALIDATION_FAILED', err, 422, { expiryDate: err }); }
        const { reason, fileName, ...p } = patch;
        const before = structuredClone({ rates: ct.rates, creditTermDays: ct.creditTermDays, paymentMethod: ct.paymentMethod, billingCycle: ct.billingCycle, expiryDate: ct.expiryDate, version: ct.version ?? 1 });
        Object.assign(ct, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
        ct.version = (ct.version ?? 1) + 1;
        (ct.versions ??= []).push({ version: ct.version, at: nowIso(), by: u.userId, reason });
        (ct.history ??= []).push({ status: `Amended → v${ct.version}`, at: nowIso(), by: u.userId, note: reason, fileName });
        if (fileName) (ct.documents ??= []).push({ kind: 'Amendment', fileName, at: nowIso(), by: u.userId });
        const tol = Number(S()['clt.rate_variance_tolerance_pct'] ?? 10);
        if (patch.rates && ratesAboveTolerance(patch.rates, api.contracts.rateTemplate(ct.contractType), tol).length) {
          const wf = startWorkflow('CONTRACT_APPROVAL', `Contract amendment v${ct.version} (rate variance) — ${no}`, 'contract', no, [{ label: 'Sales Director review', roles: ['SALES_DIRECTOR'] }, { label: 'Finance Manager approval', roles: ['FINANCE_MANAGER'] }], undefined, ct.branchCode);
          ct.approval = { workflowId: wf.id, reason, status: 'Pending', kind: 'Rate variance' };
        }
        audit('contract.amended', 'contract', no, { ...p, version: ct.version }, reason, before); return ct;
      });
    },
    /** Termination needs Sales Director + Finance Manager approval (proposed matrix); pre-termination fee applies inside the lock-in (BR-15). */
    async terminate(no: string, reason: string, effectiveDate: string) {
      requirePerm('clients.contract', 'edit');
      await delay();
      const ct = db.contracts.find((x) => x.contractNo === no)!;
      if (ct.status !== 'Active') throw new ApiError('INVALID_STATE', 'Only Active contracts can be terminated.', 409);
      if (!reason.trim() || !effectiveDate) throw new ApiError('VALIDATION_FAILED', 'Reason and effective date are required.', 422);
      if (ct.termination?.status === 'Pending') throw new ApiError('INVALID_STATE', 'A termination request is already pending.', 409);
      const wf = startWorkflow('CONTRACT_TERMINATION', `Contract termination — ${no}`, 'contract', no, [{ label: 'Sales Director review', roles: ['SALES_DIRECTOR'] }, { label: 'Finance Manager approval', roles: ['FINANCE_MANAGER'] }], undefined, ct.branchCode);
      ct.termination = { workflowId: wf.id, reason, status: 'Pending', effectiveDate };
      (ct.history ??= []).push({ status: 'Termination requested', at: nowIso(), by: me().userId, note: reason });
      audit('contract.termination_requested', 'contract', no, { effectiveDate }, reason);
      persist();
      return structuredClone(ct);
    },
    /** SCR-09 list: balance after refunds, stage of the open withdrawal (C&C → Finance → Accounting → Admin), contract end status (BR-14). */
    async cashBonds() {
      requirePerm('clients.cashbond'); expireContracts();
      return tx(() => db.cashBonds.map((b) => {
        const open = b.withdrawals.find((w) => !['Rejected', 'Refunded'].includes(w.status));
        const wf = open ? db.workflows.find((x) => x.id === open.workflowId) : undefined;
        const ct = b.contractNo ? db.contracts.find((x) => x.contractNo === b.contractNo) : undefined;
        const last = b.withdrawals[0];
        const stage = wf?.status === 'Pending' ? `Pending ${wf.steps[wf.currentStep]?.label}` : open?.status === 'Approved — awaiting refund' ? 'Approved — awaiting refund' : b.status === 'Held' && last?.status === 'Rejected' ? 'Held (last request rejected)' : b.status;
        return { ...b, clientName: clientName(b.clientCode), balance: bondBalance(b), stage, contractStatus: ct?.status, contractExpiry: ct?.expiryDate, workflows: b.withdrawals.map((w) => db.workflows.find((x) => x.id === w.workflowId)).filter(Boolean) };
      }));
    },
    async recordCashBond(b: { clientCode: string; contractNo?: string; amount: number; dateReceived: string; receiptRef: string; paymentMethod?: string; receivedBy?: string; notes?: string; receiptFile?: string }) {
      const u = requirePerm('clients.cashbond', 'add');
      return tx(() => {
        const errs: Record<string, string> = {};
        if (!b.clientCode) errs.clientCode = 'Client is required';
        if (!(b.amount > 0)) errs.amount = 'Amount must be greater than zero';
        if (!b.dateReceived) errs.dateReceived = 'Date received is required'; else if (b.dateReceived > nowIso().slice(0, 10)) errs.dateReceived = 'Date cannot be in the future';
        if (!b.receiptRef?.trim()) errs.receiptRef = 'Receipt reference is required';
        if (b.contractNo && !db.contracts.some((x) => x.contractNo === b.contractNo && x.clientCode === b.clientCode)) errs.contractNo = 'Contract does not belong to this client';
        if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', 'Check the highlighted fields.', 422, errs);
        const cb: CashBond = { id: uid(), status: 'Held', withdrawals: [], receivedBy: u.userId, ...b };
        db.cashBonds.unshift(cb); audit('cashbond.recorded', 'cashbond', cb.id, cb); return cb;
      });
    },
    refundPreview(bondId: string) {
      const b = db.cashBonds.find((x) => x.id === bondId)!;
      const w = db.ewallets.find((e) => e.clientCode === b.clientCode);
      const openDm = db.memos.filter((m) => m.clientCode === b.clientCode && m.type === 'Debit' && m.status === 'Pending Approval').reduce((a, m) => a + m.amount, 0);
      const ct = b.contractNo ? db.contracts.find((x) => x.contractNo === b.contractNo) : undefined;
      const bal = bondBalance(b);
      return {
        bond: bal, unpaid: outstandingOf(b.clientCode), negativeWallet: w && w.balance < 0 ? -w.balance : 0, openDm, ...cashBondRefundable(bal, outstandingOf(b.clientCode), w && w.balance < 0 ? -w.balance : 0, openDm),
        contractNo: b.contractNo, contractStatus: ct?.status, contractExpiry: ct?.expiryDate, contractEnded: !ct || ['Expired', 'Terminated', 'Renewed'].includes(ct.status),
      };
    },
    /** BR-14: refundable at contract end; earlier withdrawal only as a flagged exception through the same four-tier chain (exception policy pending client decision). */
    async requestWithdrawal(bondId: string, amount: number, reason: string, opts: { earlyException?: boolean } = {}) {
      // DBL-CLT-017: portal clients may request withdrawal of their own bond; internal users need cash-bond access.
      const caller = me();
      if (caller.realm !== 'CLIENT_PORTAL') requirePerm('clients.cashbond', 'view');
      await delay();
      const b = db.cashBonds.find((x) => x.id === bondId);
      if (!b || (caller.realm === 'CLIENT_PORTAL' && b.clientCode !== caller.clientCode)) throw new ApiError('NOT_FOUND', 'Cash bond not found.', 404);
      const p = api.contracts.refundPreview(bondId);
      if (b.status !== 'Held') throw new ApiError('INVALID_STATE', 'A withdrawal is already in progress for this bond.', 409);
      if (!(amount > 0)) throw new ApiError('VALIDATION_FAILED', 'Enter a withdrawal amount greater than zero.', 422, { amount: 'Must be greater than zero' });
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      if (amount > p.refundable) throw new ApiError('THRESHOLD_EXCEEDED', `Withdrawal exceeds the refundable amount (₱${p.refundable.toLocaleString('en-PH')}).`, 422, { amount: 'Exceeds refundable amount' });
      if (!p.contractEnded && !opts.earlyException) throw new ApiError('BR14_CONTRACT_ACTIVE', `Contract ${p.contractNo} is ${p.contractStatus}; the bond is refundable at contract end (BR-14). Request an early-withdrawal exception instead.`, 409);
      const wf = startWorkflow('CASH_BOND_WITHDRAWAL', `Cash bond withdrawal${!p.contractEnded ? ' (EARLY — exception)' : ''} — ${clientName(b.clientCode)}`, 'cashbond', b.id, [
        { label: 'Credit & Collection', roles: ['CNC_OFFICER'] }, { label: 'Finance', roles: ['FINANCE_MANAGER'] }, { label: 'Accounting', roles: ['ACCOUNTING'] }, { label: 'Admin', roles: ['SYS_ADMIN'] },
      ], amount);
      b.withdrawals.unshift({ id: uid(), amount, reason, refundable: p.refundable, workflowId: wf.id, status: 'Pending', requestedAt: nowIso(), earlyException: !p.contractEnded });
      b.status = 'Withdrawal Pending';
      notify('cashbond.withdrawal', `Cash bond withdrawal requested`, `${clientName(b.clientCode)} · ₱${amount.toLocaleString('en-PH')}`, {});
      audit('cashbond.withdrawal_requested', 'cashbond', b.id, { amount, earlyException: !p.contractEnded }, reason);
      persist();
      return structuredClone(b);
    },
    /** After the Admin step, Accounting records how and when the refund was paid. */
    async recordRefund(bondId: string, withdrawalId: string, r: { method: string; date: string; reference: string }) {
      const u = requirePerm('clients.cashbond', 'approve');
      return tx(() => {
        const b = db.cashBonds.find((x) => x.id === bondId)!; const w = b.withdrawals.find((x) => x.id === withdrawalId)!;
        if (w.status !== 'Approved — awaiting refund') throw new ApiError('INVALID_STATE', 'Only approved withdrawals can be refunded.', 409);
        if (!r.method || !r.date || !r.reference.trim()) throw new ApiError('VALIDATION_FAILED', 'Refund method, date and Accounting reference are required.', 422);
        w.refund = { ...r, by: u.userId }; w.status = 'Refunded';
        b.status = bondBalance(b) <= 0 ? 'Refunded' : 'Held';
        audit('cashbond.refunded', 'cashbond', b.id, w.refund); return b;
      });
    },
  },

  // ── Chassis & assets (M03) ───────────────────────────────────────────────
  chassis: {
    /** Registration state for the SCR-12 badge (DBL-CHS-005): Missing / Expired / Expiring (≤ 30 days) / Renewal In Progress / Current. */
    regState(no: string): { state: 'Missing' | 'Expired' | 'Expiring' | 'Renewal In Progress' | 'Current'; expiryDate?: string } {
      const r = db.registrations.find((x) => x.subjectId === no);
      if (!r) return { state: 'Missing' };
      const days = (new Date(r.expiryDate).getTime() - Date.now()) / 86_400_000;
      return { state: days < 0 ? 'Expired' : r.renewalInProgress ? 'Renewal In Progress' : days <= 30 ? 'Expiring' : 'Current', expiryDate: r.expiryDate };
    },
    async list(f: { q?: string; status?: string; type?: string; branch?: string; owner?: string; axle?: string; hub?: string; tag?: string; reg?: string; standard?: string } = {}) {
      requirePerm('chassis.chassis');
      return tx(() => db.chassis.filter((c) => inScope(c.branchCode) || me().branchAccess === 'ALL')
        .filter((c) => (!f.status || c.status === f.status) && (!f.type || c.chassisType === f.type) && (!f.branch || c.branchCode === f.branch) && (!f.owner || (f.owner === 'DELWATER' ? c.owner === 'DELWATER' : c.owner !== 'DELWATER')) && (!f.q || `${c.chassisNo} ${c.plateNo}`.toLowerCase().includes(f.q.toLowerCase())))
        .filter((c) => (!f.axle || c.axleConfig === f.axle) && (!f.hub || c.hubType === f.hub) && (!f.tag || (c.tags ?? []).includes(f.tag)) && (!f.standard || c.standard === f.standard))
        .map((c) => ({ ...c, registration: db.registrations.find((r) => r.subjectId === c.chassisNo), regState: api.chassis.regState(c.chassisNo).state }))
        .filter((c) => !f.reg || c.regState === f.reg));
    },
    async get(no: string) {
      requirePerm('chassis.chassis');
      return tx(() => {
        const c = mustChassis(no);
        const openJos = db.jobOrders.filter((j) => j.chassisNo === no && !j.status.startsWith('Closed'));
        const reg = db.registrations.find((r) => r.subjectId === no);
        return {
          chassis: c, registration: reg, regState: api.chassis.regState(no).state,
          eirHistory: db.eirs.filter((e) => e.chassisNo === no).slice(0, 20),
          joHistory: db.jobOrders.filter((j) => j.chassisNo === no).map((j) => { const parts = j.bom.reduce((a, b) => a + b.qty * b.unitCost, 0), labor = j.labor.reduce((a, l) => a + l.hours * l.rate, 0); return { joNo: j.joNo, date: j.createdAt, remarks: j.notes, status: j.status, parts, labor, total: parts + labor }; }),
          statusHistory: db.audit.filter((a) => a.entityType === 'chassis' && a.entityId === no),
          availableSignoff: { eligible: ['Breakdown', 'In Repair'].includes(c.status) && openJos.length === 0 && !!reg && new Date(reg.expiryDate) >= new Date(), openJos: openJos.length, regOk: !!reg && new Date(reg.expiryDate) >= new Date() },
        };
      });
    },
    async save(input: Partial<import('../shared').Chassis> & { chassisNo: string }, isNew: boolean) {
      requirePerm('chassis.chassis', isNew ? 'add' : 'edit');
      return tx(() => {
        const ex = db.chassis.find((c) => c.chassisNo === input.chassisNo);
        if (isNew) {
          if ((input.chassisNo.match(/\d/g) ?? []).length < 10 || !/^[A-Z0-9-]+$/.test(input.chassisNo)) throw new ApiError('VALIDATION_FAILED', 'Chassis no. must contain at least 10 digits (letters, digits and hyphens only).', 422, { chassisNo: 'Minimum 10 digits (DBL-CHS-001)' });
          if (ex) throw new ApiError('DUPLICATE_KEY', `Chassis ${input.chassisNo} already exists.`, 409, { chassisNo: 'Duplicate chassis number' });
          const miss = (['chassisType', 'branchCode', 'owner', 'axleConfig', 'hubType'] as const).filter((k) => !input[k]);
          if (miss.length) throw new ApiError('VALIDATION_FAILED', 'Complete the required fields.', 422, Object.fromEntries(miss.map((k) => [k, 'Required'])));
          db.chassis.unshift({ status: 'New', owner: 'DELWATER', generalAssessment: 'Roadworthy', standard: 'DW', statusSince: nowIso(), branchCode: 'MNL', chassisType: 'EQ1', ...input } as import('../shared').Chassis);
          audit('chassis.created', 'chassis', input.chassisNo, input);
        } else if (ex) { const { status: _s, ...rest } = input; Object.assign(ex, rest); audit('chassis.updated', 'chassis', input.chassisNo, rest); }
        return true;
      });
    },
    async changeStatus(no: string, to: import('../shared').ChassisStatus, reason: string) {
      requirePerm('chassis.status', 'approve');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422);
      if (to === 'Available' && ['Breakdown', 'In Repair'].includes(mustChassis(no).status)) throw new ApiError('INVALID_STATE', 'Breakdown / In Repair → Available needs the BR-07 manual sign-off (Mark Available).', 409);
      return tx(() => { const c = mustChassis(no); const from = c.status; c.status = to; c.statusSince = nowIso(); audit('chassis.status', 'chassis', no, { status: to }, reason, { status: from }); return c; });
    },
    async markAvailable(no: string) {
      requirePerm('chassis.status', 'approve');
      const d = await api.chassis.get(no);
      if (!d.availableSignoff.eligible) throw new ApiError('INVALID_STATE', d.availableSignoff.openJos ? 'All job orders must be closed first (BR-07).' : 'Registration must be current (BR-07).', 409);
      return tx(() => { const c = mustChassis(no); const from = c.status; c.status = 'Available'; c.generalAssessment = 'Roadworthy'; c.statusSince = nowIso(); audit('chassis.status', 'chassis', no, { status: 'Available' }, 'BR-07 manual sign-off', { status: from }); return c; });
    },
    /** PM state for SCR-13 (BO-APS-04): due-soon window from setting ast.pm_due_soon_days. */
    pmState(a: import('../shared').Asset): 'Overdue' | 'Due soon' | 'Scheduled' | 'Suspended' | 'None' {
      if (['Retired', 'Disposed'].includes(a.status) || !a.nextPmDate) return a.status === 'Under Repair' ? 'Suspended' : 'None';
      const days = (new Date(a.nextPmDate).getTime() - Date.now()) / 86_400_000;
      return days < 0 ? 'Overdue' : days <= Number(S()['ast.pm_due_soon_days'] ?? 7) ? 'Due soon' : 'Scheduled';
    },
    async assets(f: { category?: string; branch?: string; status?: string; pmDue?: boolean; assigned?: string } = {}) {
      requirePerm('chassis.asset');
      return tx(() => db.assets.map((a) => ({ ...a, pmState: api.chassis.pmState(a), pendingDisposal: a.disposal?.status === 'Pending Approval' }))
        .filter((a) => (!f.category || a.category === f.category) && (!f.branch || a.branchCode === f.branch) && (!f.status || a.status === f.status) && (!f.pmDue || ['Overdue', 'Due soon'].includes(a.pmState)) && (!f.assigned || a.assignedTo === f.assigned)));
    },
    async asset(id: string) {
      requirePerm('chassis.asset');
      return tx(() => {
        const a = db.assets.find((x) => x.assetId === id); if (!a) throw new ApiError('NOT_FOUND', `Asset ${id} not found.`, 404);
        return { asset: a, pmState: api.chassis.pmState(a), audit: db.audit.filter((e) => e.entityType === 'asset' && e.entityId === id), workflow: a.disposal ? db.workflows.find((w) => w.id === a.disposal!.workflowId) : undefined };
      });
    },
    async saveAsset(a: import('../shared').Asset, isNew: boolean) {
      requirePerm('chassis.asset', isNew ? 'add' : 'edit');
      return tx(() => {
        const ex = db.assets.find((x) => x.assetId === a.assetId);
        if (!/^[A-Z0-9-]{4,20}$/.test(a.assetId)) throw new ApiError('VALIDATION_FAILED', 'Asset tag must be 4–20 letters, digits or hyphens.', 422, { assetId: 'Format: e.g. AST-FL-007' });
        if (isNew && ex) throw new ApiError('DUPLICATE_KEY', 'Duplicate asset tag.', 409, { assetId: 'Duplicate asset tag' });
        if (!a.description?.trim()) throw new ApiError('VALIDATION_FAILED', 'Description is required.', 422, { description: 'Required' });
        if (a.qty != null && !(a.qty > 0)) throw new ApiError('VALIDATION_FAILED', 'Quantity must be greater than zero.', 422, { qty: 'Must be > 0' });
        if ((isNew ? ['Retired', 'Disposed'].includes(a.status) : ex && a.status !== ex.status && ['Retired', 'Disposed'].includes(a.status))) throw new ApiError('INVALID_STATE', 'Retire / dispose goes through approval (DBL-CHS-011).', 409, { status: 'Use Retire / Dispose' });
        const next = a.lastMaintenanceDate && a.pmIntervalDays ? new Date(new Date(a.lastMaintenanceDate).getTime() + a.pmIntervalDays * 86_400_000).toISOString().slice(0, 10) : a.nextPmDate;
        const row = { ...a, nextPmDate: a.status === 'Under Repair' && !a.nextPmDate ? undefined : next, qrCode: a.qrCode ?? `QR-${a.assetId}` };
        if (ex) Object.assign(ex, row); else db.assets.unshift(row);
        audit(isNew ? 'asset.created' : 'asset.updated', 'asset', a.assetId, row); return row;
      });
    },
    async changeAssetStatus(id: string, to: 'Available' | 'In-Use' | 'Under Repair', reason: string) {
      requirePerm('chassis.asset', 'edit');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422);
      return tx(() => { const a = db.assets.find((x) => x.assetId === id)!; if (['Retired', 'Disposed'].includes(a.status)) throw new ApiError('INVALID_STATE', `Asset is ${a.status}.`, 409); const from = a.status; a.status = to; audit('asset.status', 'asset', id, { status: to }, reason, { status: from }); return a; });
    },
    async logMaintenance(id: string, e: { date: string; type: 'Preventive' | 'Corrective' | 'Inspection'; notes: string; joNo?: string }) {
      requirePerm('chassis.asset', 'edit');
      if (!e.date || !e.notes.trim()) throw new ApiError('VALIDATION_FAILED', 'Date and notes are required.', 422);
      return tx(() => {
        const a = db.assets.find((x) => x.assetId === id)!;
        a.maintenanceLog = [{ ...e, by: me().userId }, ...(a.maintenanceLog ?? [])];
        if (!a.lastMaintenanceDate || e.date > a.lastMaintenanceDate) { a.lastMaintenanceDate = e.date; if (a.pmIntervalDays) a.nextPmDate = new Date(new Date(e.date).getTime() + a.pmIntervalDays * 86_400_000).toISOString().slice(0, 10); }
        audit('asset.maintenance', 'asset', id, e); return a;
      });
    },
    async requestDisposal(id: string, action: 'Retire' | 'Dispose', reason: string) {
      requirePerm('chassis.asset', 'edit');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      return tx(() => {
        const a = db.assets.find((x) => x.assetId === id)!;
        if (a.disposal?.status === 'Pending Approval') throw new ApiError('INVALID_STATE', 'A retire / dispose request is already pending.', 409);
        if (a.status === 'Disposed' || (action === 'Retire' && a.status === 'Retired')) throw new ApiError('INVALID_STATE', `Asset is already ${a.status}.`, 409);
        const wf = startWorkflow('ASSET_DISPOSAL', `${action} asset ${id} — ${a.description}`, 'asset', id, [{ label: 'APS / MMG Manager approval', roles: ['APS_MANAGER'] }], undefined, a.branchCode);
        a.disposal = { action, reason, workflowId: wf.id, status: 'Pending Approval', requestedAt: nowIso() };
        audit('asset.disposal_requested', 'asset', id, { action }, reason); return wf.id;
      });
    },
  },

  // ── Gate operations (M04) ────────────────────────────────────────────────
  gate: {
    async ewas(f: { status?: string; client?: string; branch?: string; from?: string; to?: string } = {}) {
      expireEwas();
      const u = me();
      if (u.realm === 'INTERNAL') requirePerm('gate.ewa');
      return tx(() => db.ewas.filter((e) => (u.realm === 'CLIENT_PORTAL' ? e.clientCode === u.clientCode : inScope(e.branchCode) || u.branchAccess === 'ALL'))
        .filter((e) => (!f.status || e.status === f.status) && (!f.client || e.clientCode === f.client) && (!f.branch || e.branchCode === f.branch)
          && (!f.from || e.createdAt.slice(0, 10) >= f.from) && (!f.to || e.createdAt.slice(0, 10) <= f.to))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.euNo.localeCompare(a.euNo)) // review 1.1: newest first by default
        .map((e) => {
          const ext = db.workflows.find((w) => w.matrixCode === 'EWA_EXTENSION' && w.subjectId === e.euNo && w.status === 'Pending');
          return { ...e, clientName: clientName(e.clientCode), createdByName: db.users.find((x) => x.userId === e.createdBy)?.name ?? e.createdBy,
            // Review 1.1: gate passes released under this EWA (Gate Pass no., unit, time, truck OR/CR captured at the gate).
            gatePasses: db.gatePasses.filter((g) => g.euNo === e.euNo && g.direction === 'OUT').map((g) => ({ gatePassNo: g.gatePassNo, chassisNo: g.chassisNo, at: g.actualEventAt, truckOrcr: g.truckOrcr })),
            extension: ext ? { workflowId: ext.id, step: ext.currentStep, stepLabel: ext.steps[ext.currentStep]?.label, canAct: u.realm === 'INTERNAL' && canActOn(ext, u) } : undefined };
        }));
    },
    /** EWA detail (DBL-GAT-001/003): linked gate passes, extension history (workflows) and audit trail. */
    async ewaDetail(euNo: string) {
      requirePerm('gate.ewa'); expireEwas();
      return tx(() => {
        const e = db.ewas.find((x) => x.euNo === euNo);
        if (!e) throw new ApiError('NOT_FOUND', `EWA ${euNo} not found.`, 404);
        const ct = db.contracts.find((c) => c.contractNo === e.contractNo);
        return { ewa: { ...e, clientName: clientName(e.clientCode) }, contract: ct ? { contractNo: ct.contractNo, contractType: ct.contractType, effectiveDate: ct.effectiveDate, expiryDate: ct.expiryDate } : undefined,
          gatePasses: db.gatePasses.filter((g) => g.euNo === euNo || (g.direction === 'IN' && db.gatePasses.some((o) => o.euNo === euNo && o.gatePassNo === g.pairedGatePassNo))),
          extensions: db.workflows.filter((w) => w.matrixCode === 'EWA_EXTENSION' && w.subjectId === euNo),
          audit: db.audit.filter((a) => a.entityId === euNo).slice(0, 100) };
      });
    },
    /** DBL-GAT-003: Branch Generalist updates driver / truck / licence for the outbound or inbound leg. */
    async updateEwaCredentials(euNo: string, leg: 'OUT' | 'IN', cred: { trucker: string; driverName: string; driverLicenseNo: string; truckPlateNo: string }, reason: string) {
      requirePerm('gate.ewa', 'edit');
      return tx(() => {
        const e = db.ewas.find((x) => x.euNo === euNo);
        if (!e) throw new ApiError('NOT_FOUND', `EWA ${euNo} not found.`, 404);
        if (e.status === 'Cancelled') throw new ApiError('INVALID_STATE', 'Cancelled EWAs cannot be edited.', 409);
        if (leg === 'OUT' && e.status === 'Used') throw new ApiError('INVALID_STATE', 'All units have gone out — edit the inbound leg instead.', 409);
        if (!cred.driverName.trim() || !cred.driverLicenseNo.trim() || !cred.truckPlateNo.trim()) throw new ApiError('VALIDATION_FAILED', 'Driver name, licence no. and truck plate are required.', 422);
        if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
        const before = leg === 'OUT' ? { trucker: e.trucker, driverName: e.driverName, driverLicenseNo: e.driverLicenseNo, truckPlateNo: e.truckPlateNo } : e.inbound;
        if (leg === 'OUT') Object.assign(e, cred); else e.inbound = { ...cred };
        e.updatedAt = nowIso(); e.updatedBy = me().userId;
        audit(`ewa.credentials_updated.${leg.toLowerCase()}`, 'ewa', euNo, cred, reason, before);
        return true;
      });
    },
    async availability(branchCode: string) {
      return tx(() => Object.fromEntries(db.equipmentTypes.map((t) => [t.code, availableUnits(branchCode, t.code)])) as Record<string, number>);
    },
    async createEwa(f: EwaForm) {
      const u = me();
      const clientCode = u.realm === 'CLIENT_PORTAL' ? u.clientCode! : f.clientCode;
      if (u.realm === 'INTERNAL') requirePerm('gate.ewa', 'add');
      await delay(200);
      assertGate(clientCode, u.realm === 'CLIENT_PORTAL' ? 'PORTAL_EWA' : 'EWA_CREATE');
      const c = mustClient(clientCode);
      // Portal New EWA review: the Screen Inventory error "Missing driver/truck info" when any driver / truck field is blank.
      const clean = { driverName: f.driverName?.trim() ?? '', driverLicenseNo: f.driverLicenseNo?.trim().toUpperCase() ?? '', truckPlateNo: f.truckPlateNo?.trim().toUpperCase().replace(/\s+/g, ' ') ?? '', trucker: f.trucker?.trim() ?? '' };
      const blank = Object.fromEntries(Object.entries(clean).filter(([, v]) => !v).map(([k]) => [k, 'Required']));
      if (Object.keys(blank).length) throw new ApiError('MISSING_DRIVER_TRUCK_INFO', 'Missing driver/truck info: enter the trucker, truck plate no., driver name and driver licence no.', 422, blank);
      const fmt: Record<string, string> = {};
      if (!PLATE_RE.test(clean.truckPlateNo)) fmt.truckPlateNo = 'Use the LTO format, e.g. NAB 5678';
      if (!LICENCE_RE.test(clean.driverLicenseNo)) fmt.driverLicenseNo = 'Use the LTO format, e.g. N01-23-456789';
      if (Object.keys(fmt).length) throw new ApiError('VALIDATION_FAILED', 'Check the truck plate and driver licence format.', 422, fmt);
      const ct = db.contracts.find((x) => x.contractNo === f.contractNo && x.clientCode === clientCode && x.status === 'Active');
      if (!ct) throw new ApiError('VALIDATION_FAILED', 'Select an active contract for this client.', 422, { contractNo: 'No active contract' });
      const branch = db.branches.find((b) => b.code === f.branchCode);
      if (!branch || branch.isHeadOffice || branch.active === false) throw new ApiError('VALIDATION_FAILED', 'Choose a pickup branch.', 422, { branchCode: 'Not a pickup branch' });
      if (u.realm === 'CLIENT_PORTAL' && !c.cwsBranchAccess.includes(f.branchCode)) throw new ApiError('ELIGIBILITY', 'Pickup branch is not in your CWS branch access.', 409, { branchCode: 'Branch not allowed' });
      if (!f.units?.length) throw new ApiError('VALIDATION_FAILED', 'Add at least one equipment type.', 422, { units: 'Required' });
      if (new Set(f.units.map((l) => l.equipmentType)).size !== f.units.length) throw new ApiError('VALIDATION_FAILED', 'Each equipment type can appear once — change its quantity instead.', 422, { units: 'Duplicate type' });
      // Limited by the free units at the pickup branch and by what is left on the contract (entitlement), per type and in total.
      const ent = ewaEntitlement(ct);
      for (const line of f.units) {
        const name = db.equipmentTypes.find((e) => e.code === line.equipmentType)?.name ?? line.equipmentType;
        const t = ent.types.find((x) => x.equipmentType === line.equipmentType);
        if (!t) throw new ApiError('VALIDATION_FAILED', `${name} is not on contract ${ct.contractNo}.`, 422, { units: 'Not on contract' });
        if (!Number.isInteger(line.qty) || line.qty < 1) throw new ApiError('VALIDATION_FAILED', 'Quantity must be a whole number of at least 1.', 422, { units: 'Whole number, at least 1' });
        const avail = availableUnits(f.branchCode, line.equipmentType);
        if (line.qty > avail) throw new ApiError('VALIDATION_FAILED', `Only ${avail} unit(s) of ${name} available at ${f.branchCode}.`, 422, { units: `Only ${avail} available` });
        if (line.qty > t.remaining) throw new ApiError('ENTITLEMENT_EXCEEDED', `Contract ${ct.contractNo} allows ${t.remaining} more ${name} unit(s) (${t.entitled != null ? `${t.entitled} entitled, ` : ''}${t.onHire} on hire, ${t.pending} on open EWAs).`, 422, { units: `${t.remaining} left on the contract` });
      }
      const total = f.units.reduce((a, l) => a + l.qty, 0);
      if (total > ent.contractRemaining) throw new ApiError('ENTITLEMENT_EXCEEDED', `Contract ${ct.contractNo} covers ${ent.unitQty} units; ${ent.onHire} are on hire and ${ent.pending} are on open EWAs, so ${ent.contractRemaining} more can be requested.`, 422, { units: `${ent.contractRemaining} left on the contract` });
      const validUntil = addHours(nowIso(), Number(S()['gat.ewa_validity_hours'] ?? 24));
      if (f.expectedPickupAt && (Number.isNaN(Date.parse(f.expectedPickupAt)) || f.expectedPickupAt > validUntil || Date.parse(f.expectedPickupAt) < Date.now() - 3_600_000)) throw new ApiError('VALIDATION_FAILED', 'The expected pickup must fall within the EWA validity.', 422, { expectedPickupAt: 'Within the next 24 hours' });
      if ((f.remarks?.length ?? 0) > 300) throw new ApiError('VALIDATION_FAILED', 'Remarks are limited to 300 characters.', 422, { remarks: 'Max 300 characters' });
      const euNo = nextNo('EU', 'EU-', 6);
      const e: Ewa = { euNo, clientCode, contractNo: f.contractNo, branchCode: f.branchCode, ...clean,
        units: f.units.map((l) => ({ ...l, usedChassis: [] })), createdAt: nowIso(), validUntil, createdVia: (u.realm === 'CLIENT_PORTAL' ? 'Portal' : 'Internal') as 'Portal' | 'Internal', status: 'Active' as const, extensionCount: 0, createdBy: u.userId,
        truckOrcr: f.truckOrcr?.trim() || undefined, expectedPickupAt: f.expectedPickupAt || undefined, remarks: f.remarks?.trim() || undefined };
      e.delivery = ewaDelivery(e, c);
      db.ewas.unshift(e);
      notify('ewa.created', `EWA ${euNo} created — ${c.clientName}`, `Branch ${f.branchCode} · driver ${clean.driverName} · truck ${clean.truckPlateNo} · valid until ${new Date(e.validUntil).toLocaleString('en-PH')}`, { branchCode: f.branchCode, clientCode, aeUserId: c.aeAssigned, link: `/gate/ewa` });
      // The client's own portal users get an in-app notice that opens the EWA (GAT-002).
      notify('ewa.created.portal', `EWA ${euNo} created`, `${f.branchCode} · ${clean.driverName} · ${clean.truckPlateNo} · valid until ${formatDateTime(e.validUntil)}`, { extraUsers: db.users.filter((x) => x.realm === 'CLIENT_PORTAL' && x.clientCode === clientCode && x.status === 'Active').map((x) => x.userId), link: `/client/ewa?open=${euNo}` });
      audit('ewa.created', 'ewa', euNo, e); persist();
      return structuredClone(e);
    },
    /** Portal New EWA review (GAT-002): send the full-detail EWA email again to the same recipients; each send is logged with its status. */
    async resendEwaEmail(euNo: string) {
      const u = me();
      await delay();
      return tx(() => {
        const e = db.ewas.find((x) => x.euNo === euNo && (u.realm !== 'CLIENT_PORTAL' || x.clientCode === u.clientCode));
        if (!e) throw new ApiError('NOT_FOUND', 'EWA not found.', 404);
        if (e.status !== 'Active' && e.status !== 'Partially Used') throw new ApiError('INVALID_STATE', `${euNo} is ${e.status.toLowerCase()} — there is nothing to resend.`, 409);
        const sent = ewaDelivery(e, mustClient(e.clientCode), true);
        (e.delivery ??= []).push(...sent);
        audit('ewa.email_resent', 'ewa', euNo, { recipients: sent.map((d) => d.to) });
        return sent;
      });
    },
    async requestExtension(euNo: string, reason: string) {
      await delay();
      const e = db.ewas.find((x) => x.euNo === euNo)!;
      if (me().realm === 'CLIENT_PORTAL' && e?.clientCode !== me().clientCode) throw new ApiError('NOT_FOUND', 'EWA not found.', 404); // portal scope
      if (e.status !== 'Expired') throw new ApiError('INVALID_STATE', 'Only expired EWAs can be extended.', 409);
      if (me().realm === 'INTERNAL') requirePerm('gate.ewa', 'add');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason for the extension is required.', 422, { reason: 'Required' });
      assertGate(e.clientCode, 'EWA_CREATE');
      e.status = 'Extension Pending';
      startWorkflow('EWA_EXTENSION', `EWA extension — ${euNo}`, 'ewa', euNo, [{ label: 'Manager approval', roles: ['DYM', 'REGIONAL_MANAGER', 'OPS_MANAGER'] }, { label: 'IT / authorised revalidation', roles: ['SYS_ADMIN'] }]);
      audit('ewa.extension_requested', 'ewa', euNo, undefined, reason); persist();
      return true;
    },
    async cancelEwa(euNo: string, reason: string) {
      requirePerm('gate.ewa', 'cancel');
      return tx(() => {
        const e = db.ewas.find((x) => x.euNo === euNo);
        if (!e) throw new ApiError('NOT_FOUND', `EWA ${euNo} not found.`, 404);
        if (!['Active', 'Partially Used', 'Expired'].includes(e.status)) throw new ApiError('INVALID_STATE', `EWA ${euNo} is ${e.status} and cannot be cancelled.`, 409);
        if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A cancellation reason is required.', 422, { reason: 'Required' });
        const from = e.status;
        Object.assign(e, { status: 'Cancelled', cancelledAt: nowIso(), cancelledBy: me().userId, cancelReason: reason });
        audit('ewa.cancelled', 'ewa', euNo, { status: 'Cancelled' }, reason, { status: from }); return true;
      });
    },
    async lookupEwa(euNo: string) {
      requirePerm('gate.out'); expireEwas();
      return tx(() => {
        const e = db.ewas.find((x) => x.euNo.toLowerCase() === euNo.trim().toLowerCase());
        if (!e) throw new ApiError('EWA_INVALID', `EWA ${euNo} not found.`, 404);
        if (e.status === 'Expired') throw new ApiError('EWA_EXPIRED', `EWA ${e.euNo} expired on ${formatDateTime(e.validUntil)}. Request an extension (BR-06).`, 409);
        if (e.status !== 'Active' && e.status !== 'Partially Used') throw new ApiError('EWA_INVALID', `EWA ${e.euNo} is ${e.status}.`, 409);
        const gate = creditGate(clientOf(e.clientCode), 'GATE_OUT');
        const candidates = db.chassis.filter((c) => c.branchCode === e.branchCode && ['Available', 'Allocated'].includes(c.status) && e.units.some((u) => u.equipmentType === c.chassisType && u.usedChassis.length < u.qty))
          .map((c) => ({ ...c, registration: db.registrations.find((r) => r.subjectId === c.chassisNo) }));
        return { ewa: { ...e, clientName: clientName(e.clientCode) }, gate, candidates };
      });
    },
    async gateOut(input: { euNo: string; chassisNo: string; trucker: string; truckPlateNo: string; truckOrcr?: string; driverName: string; driverLicenseNo: string; generalAssessment: Assessment; inspection: InspectionLine[]; signature?: string; actualEventAt?: string; remarks?: string; photos?: string[]; credentialMismatch?: string[] }) {
      requirePerm('gate.out', 'add');
      await delay(250);
      const e = db.ewas.find((x) => x.euNo === input.euNo);
      if (!e || !['Active', 'Partially Used'].includes(e.status)) throw new ApiError('EWA_INVALID', 'EWA is not valid for release.', 409);
      if (new Date(e.validUntil) < new Date()) throw new ApiError('EWA_EXPIRED', 'EWA has expired (BR-06).', 409);
      assertGate(e.clientCode, 'GATE_OUT');
      const c = mustChassis(input.chassisNo);
      if (!['Available', 'Allocated'].includes(c.status)) throw new ApiError('INVALID_STATE', `Chassis ${c.chassisNo} is ${c.status}, not available for release.`, 409);
      const reg = db.registrations.find((r) => r.subjectId === c.chassisNo);
      if (!reg || new Date(reg.expiryDate) < new Date()) throw new ApiError('REGISTRATION_EXPIRED', `Chassis ${c.chassisNo} registration is expired — release blocked.`, 409);
      const line = e.units.find((u) => u.equipmentType === c.chassisType && u.usedChassis.length < u.qty);
      if (!line) throw new ApiError('VALIDATION_FAILED', 'Chassis type does not match the EWA request.', 422);
      if (!input.signature) throw new ApiError('VALIDATION_FAILED', 'Driver signature is required.', 422, { signature: 'Signature required' });
      if (!input.truckOrcr?.trim()) throw new ApiError('VALIDATION_FAILED', 'Truck OR/CR (vehicle registration) must be verified and recorded (DBL-GAT-004).', 422, { truckOrcr: 'Required' });
      if (input.generalAssessment === 'Unroadworthy') throw new ApiError('VALIDATION_FAILED', 'Unroadworthy units cannot be released.', 422);
      const gpNo = gatePassNo(c.branchCode); const eirNo = nextNo('EIR', `EIR-${c.branchCode}-`, 6);
      if (input.credentialMismatch?.length) audit('gate.out.credential_override', 'ewa', e.euNo, { driverName: input.driverName, driverLicenseNo: input.driverLicenseNo, truckPlateNo: input.truckPlateNo, gatePassNo: gpNo }, `Differs from EWA: ${input.credentialMismatch.join(', ')}`, { driverName: e.driverName, driverLicenseNo: e.driverLicenseNo, truckPlateNo: e.truckPlateNo });
      const actual = input.actualEventAt ?? nowIso();
      db.gatePasses.unshift({ gatePassNo: gpNo, direction: 'OUT', chassisNo: c.chassisNo, clientCode: e.clientCode, contractNo: e.contractNo, euNo: e.euNo, trucker: input.trucker, truckPlateNo: input.truckPlateNo, truckOrcr: input.truckOrcr,
        driverName: input.driverName, driverLicenseNo: input.driverLicenseNo, generalAssessment: input.generalAssessment, inspection: input.inspection, signature: input.signature, actualEventAt: actual, encodedAt: nowIso(), branchCode: c.branchCode, eirNo, encodedBy: me().userId,
        remarks: input.remarks?.trim() || undefined, photos: input.photos?.length ? input.photos : undefined, credentialMismatch: input.credentialMismatch?.length ? input.credentialMismatch : undefined });
      db.eirs.unshift({ eirNo, gatePassOutNo: gpNo, clientCode: e.clientCode, chassisNo: c.chassisNo, chassisType: c.chassisType, eirOutDate: actual, depotCode: c.branchCode, contractNo: e.contractNo, reprintCount: 0 });
      line.usedChassis.push(c.chassisNo);
      e.status = e.units.every((u) => u.usedChassis.length >= u.qty) ? 'Used' : 'Partially Used';
      const from = c.status;
      Object.assign(c, { status: 'On Hire', statusSince: actual, currentClientCode: e.clientCode, currentContractNo: e.contractNo, currentGatePassNo: gpNo, allocation: undefined });
      // Job orders closed by R&M become Closed by EIR Out on departure.
      db.jobOrders.filter((j) => j.chassisNo === c.chassisNo && j.status === 'Closed by R&M').forEach((j) => { j.status = 'Closed by EIR Out'; });
      audit('gate.out', 'chassis', c.chassisNo, { status: 'On Hire', gatePassNo: gpNo }, undefined, { status: from });
      notify('gate.out.completed', `Chassis out: ${c.chassisNo}`, `${clientName(e.clientCode)} · ${gpNo}`, { branchCode: c.branchCode, clientCode: e.clientCode, aeUserId: clientOf(e.clientCode)?.aeAssigned, link: `/gate/eir?q=${eirNo}` });
      persist();
      return { gatePassNo: gpNo, eirNo };
    },
    async lookupInbound(q: string) {
      requirePerm('gate.in');
      return tx(() => {
        const key = q.trim().toLowerCase();
        const gp = db.gatePasses.find((g) => g.direction === 'OUT' && !g.pairedGatePassNo && (g.gatePassNo.toLowerCase() === key || g.chassisNo.toLowerCase() === key));
        if (!gp) throw new ApiError('NOT_FOUND', 'No open outbound gate pass for that gate pass / chassis number.', 404);
        const c = mustChassis(gp.chassisNo);
        return { out: gp, chassis: c, clientName: clientName(gp.clientCode), crossBranch: false, inboundCredentials: db.ewas.find((e) => e.euNo === gp.euNo)?.inbound };
      });
    },
    async gateIn(input: { outGatePassNo: string; returnBranchCode: string; truckPlateNo: string; driverName: string; driverLicenseNo: string; flatTires: number; vandalized: boolean; inspection: InspectionLine[]; generalAssessment: Assessment; crossBranchCode?: string; actualEventAt?: string; categories?: RepairCategory[]; signature?: string; remarks?: string; photos?: string[] }) {
      requirePerm('gate.in', 'add');
      await delay(250);
      const out = db.gatePasses.find((g) => g.gatePassNo === input.outGatePassNo);
      if (!out || out.pairedGatePassNo) throw new ApiError('NOT_FOUND', 'Outbound gate pass not found or already closed.', 404);
      const c = mustChassis(out.chassisNo);
      if (c.status !== 'On Hire' || c.currentGatePassNo !== out.gatePassNo || c.currentClientCode !== out.clientCode) throw new ApiError('INBOUND_STATE_MISMATCH', 'Chassis state does not match the open outbound pass (BR-08). Raise a correction with Operations.', 409);
      if (input.returnBranchCode !== out.branchCode) {
        const code = db.crossBranchCodes.find((x) => x.code === input.crossBranchCode?.trim().toUpperCase() && x.chassisNo === c.chassisNo && !x.used && new Date(x.expiresAt) > new Date());
        if (!code) throw new ApiError('CROSS_BRANCH_CODE_REQUIRED', `Return at ${input.returnBranchCode} differs from origin ${out.branchCode}. A valid IT-issued approval code is required (BR-16).`, 409, { crossBranchCode: 'Valid approval code required' });
        code.used = true;
      }
      if (!input.inspection.length) throw new ApiError('VALIDATION_FAILED', 'Record the parts inspection before finalising.', 422);
      if (!input.signature) throw new ApiError('VALIDATION_FAILED', 'Driver signature is required on the inbound EIR (DBL-GAT-006).', 422, { signature: 'Signature required' });
      if (input.generalAssessment === 'Unroadworthy' && !input.categories?.length) throw new ApiError('VALIDATION_FAILED', 'Select at least one repair system for an Unroadworthy return (DBL-GAT-013).', 422, { categories: 'Required' });
      const gpNo = gatePassNo(input.returnBranchCode);
      const actual = input.actualEventAt ?? nowIso();
      const eir = db.eirs.find((x) => x.gatePassOutNo === out.gatePassNo);
      db.gatePasses.unshift({ gatePassNo: gpNo, direction: 'IN', chassisNo: c.chassisNo, clientCode: out.clientCode, contractNo: out.contractNo, trucker: out.trucker, truckPlateNo: input.truckPlateNo, driverName: input.driverName, driverLicenseNo: input.driverLicenseNo,
        generalAssessment: input.generalAssessment, inspection: input.inspection, flatTires: input.flatTires, vandalized: input.vandalized, actualEventAt: actual, encodedAt: nowIso(), branchCode: input.returnBranchCode, originBranchCode: out.branchCode,
        crossBranchCode: input.crossBranchCode, eirNo: eir?.eirNo ?? '—', pairedGatePassNo: out.gatePassNo, encodedBy: me().userId, euNo: out.euNo,
        signature: input.signature, remarks: input.remarks?.trim() || undefined, photos: input.photos?.length ? input.photos : undefined });
      out.pairedGatePassNo = gpNo;
      if (eir) { eir.gatePassInNo = gpNo; eir.eirInDate = actual; }
      const from = c.status;
      Object.assign(c, { status: input.generalAssessment === 'Roadworthy' ? 'Available' : 'Breakdown', generalAssessment: input.generalAssessment, statusSince: actual, branchCode: input.returnBranchCode, currentClientCode: undefined, currentContractNo: undefined, currentGatePassNo: undefined });
      let joNo: string | undefined; const joNos: string[] = [];
      if (input.generalAssessment === 'Unroadworthy') {
        // One independent Draft job order per selected repair system (DBL-GAT-013, FRS 245).
        for (const cat of input.categories?.length ? input.categories : (['Mechanical'] as RepairCategory[])) {
          const no = nextNo('JO', `JO-${input.returnBranchCode}-`, 6); joNos.push(no);
          db.jobOrders.unshift({ joNo: no, chassisNo: c.chassisNo, branchCode: input.returnBranchCode, source: 'Gate In', sourceRef: gpNo, categories: [cat], notes: `Auto-created from Gate In ${gpNo} (Unroadworthy — ${cat}).${input.remarks ? ` Notes: ${input.remarks}` : ''}`, workers: [], status: 'Draft', isMajor: false, chargeable: input.inspection.some((l) => l.chargeable > 0), bom: [], labor: [], createdAt: nowIso(), createdBy: me().userId });
        }
        joNo = joNos[0];
        notify('gate.in.unroadworthy', `Unroadworthy return: ${c.chassisNo}`, `Draft ${joNos.join(', ')} created — approval chain started.`, { branchCode: input.returnBranchCode, link: `/repair/jo/${joNo}` });
      }
      audit('gate.in', 'chassis', c.chassisNo, { status: c.status, gatePassNo: gpNo }, undefined, { status: from });
      notify('gate.in.completed', `Chassis in: ${c.chassisNo}`, `${clientName(out.clientCode)} · ${gpNo} · ${input.generalAssessment}`, { branchCode: input.returnBranchCode, clientCode: out.clientCode, aeUserId: clientOf(out.clientCode)?.aeAssigned });
      persist();
      return { gatePassNo: gpNo, eirNo: eir?.eirNo, joNo, joNos, chargeable: round2(input.inspection.reduce((a, l) => a + l.chargeable, 0)), outGatePassNo: out.gatePassNo, billingStoppedAt: actual, chassisStatus: c.status, branchCode: c.branchCode };
    },
    async eirs(f: { q?: string; from?: string; to?: string; client?: string; depot?: string; status?: string; chassisNo?: string } = {}) {
      const u = me();
      if (u.realm === 'INTERNAL') requirePerm('gate.eir');
      return tx(() => db.eirs.filter((e) => (u.realm === 'CLIENT_PORTAL' ? e.clientCode === u.clientCode : true))
        .filter((e) => !f.q || `${e.eirNo} ${e.chassisNo} ${e.clientCode} ${clientName(e.clientCode)} ${e.gatePassOutNo} ${e.gatePassInNo ?? ''}`.toLowerCase().includes(f.q.toLowerCase()))
        .map((e) => {
          const out = db.gatePasses.find((g) => g.gatePassNo === e.gatePassOutNo), inn = e.gatePassInNo ? db.gatePasses.find((g) => g.gatePassNo === e.gatePassInNo) : undefined;
          const lateEncoded = db.lateEncodings.some((l) => l.gatePassNo === e.gatePassOutNo || l.gatePassNo === e.gatePassInNo);
          const eirStatus = inn?.isForceInbound ? 'Force Inbound' : inn ? 'Returned' : 'On Hire';
          return { ...e, clientName: clientName(e.clientCode), out, in: inn, eirStatus, lateEncoded, driverName: (inn ?? out)?.driverName, driverLicenseNo: (inn ?? out)?.driverLicenseNo, euNo: out?.euNo };
        })
        .filter((e) => (!f.client || e.clientCode === f.client) && (!f.depot || e.depotCode === f.depot) && (!f.chassisNo || e.chassisNo === f.chassisNo)
          && (!f.status || (f.status === 'Late-encoded' ? e.lateEncoded : e.eirStatus === f.status))
          && ((!f.from && !f.to) || [e.eirOutDate, e.eirInDate].some((d) => d && (!f.from || d.slice(0, 10) >= f.from) && (!f.to || d.slice(0, 10) <= f.to)))));
    },
    /** DBL-GAT-012: full movement history (every gate pass) for one chassis. */
    async chassisMovements(chassisNo: string) { requirePerm('gate.eir'); return tx(() => db.gatePasses.filter((g) => g.chassisNo === chassisNo).map((g) => ({ ...g, clientName: clientName(g.clientCode) }))); },
    /** DBL-GAT-006: reprint regenerates from stored data; reason, user and time are logged. */
    async reprint(eirNo: string, reason = 'Reprint', copy: 'OUT' | 'IN' = 'OUT') {
      if (me().realm === 'INTERNAL') requirePerm('gate.eir');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reprint reason is required.', 422, { reason: 'Required' });
      return tx(() => {
        const e = db.eirs.find((x) => x.eirNo === eirNo);
        if (!e) throw new ApiError('NOT_FOUND', `EIR ${eirNo} not found.`, 404);
        e.reprintCount++;
        const r = { no: e.reprintCount, at: nowIso(), by: me().userId, reason, copy };
        e.reprints = [r, ...(e.reprints ?? [])];
        audit('eir.reprinted', 'eir', eirNo, r, reason); return e.reprintCount;
      });
    },
    async lateEncodings() {
      requirePerm('gate.late_encoding'); const u = me();
      return tx(() => db.lateEncodings.map((l) => {
        const wf = db.workflows.find((w) => w.id === l.workflowId); const gp = db.gatePasses.find((g) => g.gatePassNo === l.gatePassNo);
        const statusLabel = l.path === 'AUTO' ? 'Auto-corrected' : l.status === 'Pending Approval' ? (wf?.currentStep === 1 ? 'Pending Treasury' : 'Pending DYM') : l.status;
        const heldLines = l.path === 'CREDIT_MEMO' && gp ? db.invoices.flatMap((i) => i.lines.filter((x) => x.held && x.chassisNo === gp.chassisNo).map((x) => ({ invoiceNo: i.invoiceNo, lineId: x.id, description: x.description, amount: x.amount }))) : [];
        return { ...l, workflow: wf, statusLabel, direction: gp?.direction, chassisNo: gp?.chassisNo, clientCode: gp?.clientCode, clientName: clientName(gp?.clientCode), heldLines, canAct: !!wf && canActOn(wf, u) };
      }));
    },
    async recordLateEncoding(gatePassNo: string, correctedDate: string, reason: string, attachment?: string) {
      requirePerm('gate.late_encoding', 'add');
      await delay();
      const gp = db.gatePasses.find((g) => g.gatePassNo === gatePassNo);
      if (!gp) throw new ApiError('NOT_FOUND', 'Gate pass not found.', 404);
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'Reason for delay is required.', 422, { reason: 'Required' });
      if (new Date(correctedDate) > new Date()) throw new ApiError('VALIDATION_FAILED', 'Corrected (actual) date cannot be in the future.', 422, { correctedDate: 'Cannot be in the future' });
      if (new Date(correctedDate) > new Date(gp.encodedAt)) throw new ApiError('VALIDATION_FAILED', 'Corrected (actual) date cannot be after the encoded date.', 422, { correctedDate: 'Must be on/before encoded date' });
      if (db.lateEncodings.some((l) => l.gatePassNo === gatePassNo && l.status === 'Pending Approval')) throw new ApiError('INVALID_STATE', `Gate pass ${gatePassNo} already has a late encoding awaiting approval.`, 409, { gatePassNo: 'Correction pending' });
      const { daysLate, path } = lateEncodingPath(correctedDate, gp.encodedAt, Number(S()['gat.late_encoding_auto_days'] ?? 7));
      const le = { id: nextNo('LE', 'LE-', 5), gatePassNo, originalDate: gp.encodedAt, correctedDate, daysLate, reason, path, status: path === 'AUTO' ? 'Posted' as const : 'Pending Approval' as const, createdAt: nowIso(), createdBy: me().userId, workflowId: undefined as string | undefined, attachment };
      if (path === 'AUTO') { gp.actualEventAt = correctedDate; }
      else {
        const wf = startWorkflow('LATE_ENCODING_CM', `Late encoding ${daysLate} days — ${gatePassNo}`, 'gatepass', gatePassNo, [{ label: 'Deputy Yard Manager', roles: ['DYM'] }, { label: 'Treasury', roles: ['TREASURY'] }], undefined, gp.branchCode);
        le.workflowId = wf.id;
        db.invoices.forEach((i) => i.lines.forEach((l) => { if (l.chassisNo === gp.chassisNo) { l.held = true; i.heldReason = 'Awaiting late-encoding credit memo approval (UC-08.EX.1)'; } }));
        notify('late_encoding.cm_required', `Late encoding CM approval: ${gatePassNo}`, `${daysLate} days late — ${reason}`, { branchCode: gp.branchCode, link: '/approvals' });
      }
      db.lateEncodings.unshift(le); audit('late_encoding.recorded', 'gatepass', gatePassNo, le, reason); persist();
      return structuredClone(le);
    },
    async gatePasses(q?: string) { requirePerm('gate.eir'); return tx(() => db.gatePasses.filter((g) => !q || `${g.gatePassNo} ${g.chassisNo}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50).map((g) => ({ ...g, clientName: clientName(g.clientCode) }))); },
    async requestCrossBranchCode(chassisNo: string, toBranch: string) {
      requirePerm('gate.in', 'add');
      return tx(() => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        db.crossBranchCodes.unshift({ code, chassisNo, toBranch, used: false, expiresAt: addHours(nowIso(), Number(S()['gat.cross_branch_code_ttl_hours'] ?? 72)) });
        audit('gate.cross_branch_code.issued', 'chassis', chassisNo, { toBranch }, 'Demo: issued immediately. Production: BG → RM/Ops → APS → IT issues the code (BR-16).');
        return code;
      });
    },
    async requestForceInbound(chassisNo: string, indemnity: number, settlementRef: string, reason = '') {
      requirePerm('gate.force_inbound', 'add');
      await delay();
      const c = mustChassis(chassisNo);
      if (c.status !== 'On Hire') throw new ApiError('INVALID_STATE', 'Force Inbound applies to on-hire chassis only.', 409);
      if (!(indemnity > 0) || !settlementRef.trim()) throw new ApiError('VALIDATION_FAILED', 'Full indemnity settlement must be recorded first (BR-17).', 422);
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason (loss / indemnity circumstances) is required (WF-12).', 422, { reason: 'Required' });
      if (db.workflows.some((w) => w.matrixCode === 'FORCE_INBOUND' && w.subjectId === chassisNo && w.status === 'Pending')) throw new ApiError('INVALID_STATE', `A Force Inbound request for ${chassisNo} is already awaiting approval.`, 409);
      audit('gate.force_inbound.requested', 'chassis', chassisNo, { indemnity, settlementRef }, reason);
      startWorkflow('FORCE_INBOUND', `Force inbound — ${chassisNo}`, 'chassis', chassisNo, [
        { label: 'Asset & Procurement (indemnity confirmed)', roles: ['APS_OFFICER'] }, { label: 'Operations Manager', roles: ['OPS_MANAGER'] }, { label: 'VP', roles: ['VP'] }, { label: 'President (final)', roles: ['PRESIDENT'] },
      ], indemnity, c.branchCode);
      persist(); return true;
    },
  },

  // ── Allocation & yard (M05) ──────────────────────────────────────────────
  alloc: {
    /** SCR-19 board. Same source + same branch scope as the Chassis master, DCIR and Executive dashboard (one fleet). */
    async board(f: { branch?: string; type?: string; status?: string; region?: string } = {}) {
      requirePerm('alloc.board');
      return tx(() => {
        const rows = db.chassis.filter((c) => (inScope(c.branchCode) || me().branchAccess === 'ALL') && (!f.branch || c.branchCode === f.branch) && (!f.region || islandOf(c.branchCode) === f.region) && (!f.type || c.chassisType === f.type) && (!f.status || c.status === f.status))
          .map((c) => {
            const contractNo = c.currentContractNo ?? c.allocation?.contractNo; const cat = yardCategoryOf(c); const jo = openJoOf(c.chassisNo); const tr = pendingTransferOf(c.chassisNo);
            return { ...c, clientName: clientName(c.currentClientCode ?? c.allocation?.clientCode), daysInStatus: Math.max(0, daysBetween(c.statusSince, nowIso())), registration: db.registrations.find((r) => r.subjectId === c.chassisNo),
              regState: regStateOf(c.chassisNo), region: islandOf(c.branchCode), contractNo, contractType: contractNo ? db.contracts.find((x) => x.contractNo === contractNo)?.contractType : undefined,
              yardCategory: cat, openJoNo: jo?.joNo, readyForSignoff: cat === 'TQS', pendingTransferTo: tr?.payload?.to, pendingTransferWf: tr?.id };
          });
        return rows;
      });
    },
    /** Clients eligible for allocation: accredited, active, no credit hold (same gate as New EWA) — with their active contracts. */
    async eligibleClients() {
      requirePerm('alloc.board');
      return tx(() => db.clients.filter((c) => creditGate(c, 'EWA_CREATE').allowed).map((c) => ({ clientCode: c.clientCode, clientName: c.clientName,
        contracts: db.contracts.filter((k) => k.clientCode === c.clientCode && k.status === 'Active').map((k) => ({ contractNo: k.contractNo, contractType: k.contractType, monetary: monetaryStatusOf(c.clientCode, k.contractNo) })) })).filter((c) => c.contracts.length));
    },
    async allocate(input: { chassisNo: string; clientCode: string; contractNo: string; targetPickupDate: string; expectedReturn?: string; requestNo?: string; acknowledgeRegWarning?: boolean }) {
      requirePerm('alloc.board', 'add');
      await delay();
      const c = mustChassis(input.chassisNo);
      if (c.status !== 'Available') throw new ApiError('INVALID_STATE', 'Only Available chassis can be allocated.', 409);
      if (pendingTransferOf(c.chassisNo)) throw new ApiError('INVALID_STATE', 'A cross-branch transfer is pending for this chassis.', 409);
      const reg = regStateOf(c.chassisNo);
      if (reg === 'Expired' || reg === 'Missing') throw new ApiError('REGISTRATION_EXPIRED', `Chassis ${c.chassisNo} registration / OR-CR is ${reg.toLowerCase()} — it cannot leave the gate, so it cannot be allocated.`, 409);
      if (reg === 'Near expiry' && !input.acknowledgeRegWarning) throw new ApiError('VALIDATION_FAILED', 'Registration expires soon — acknowledge the warning to continue.', 422, { acknowledgeRegWarning: 'Acknowledge the near-expiry warning' });
      assertGate(input.clientCode, 'EWA_CREATE');
      const ct = db.contracts.find((x) => x.contractNo === input.contractNo && x.clientCode === input.clientCode && x.status === 'Active');
      if (!ct) throw new ApiError('VALIDATION_FAILED', 'Select an active contract for this client.', 422, { contractNo: 'No active contract' });
      if (!input.targetPickupDate) throw new ApiError('VALIDATION_FAILED', 'Target pickup date is required.', 422, { targetPickupDate: 'Required' });
      if (input.targetPickupDate < nowIso().slice(0, 10)) throw new ApiError('VALIDATION_FAILED', 'Target pickup date cannot be in the past.', 422, { targetPickupDate: 'Must be today or later' });
      if (input.expectedReturn && input.expectedReturn < input.targetPickupDate) throw new ApiError('VALIDATION_FAILED', 'Expected return must be on or after the target pickup date.', 422, { expectedReturn: 'Must be after pickup' });
      const req = input.requestNo ? (db.unitRequests ?? []).find((r) => r.reqNo === input.requestNo) : undefined;
      if (input.requestNo && (!req || req.clientCode !== input.clientCode || req.equipmentType !== c.chassisType)) throw new ApiError('VALIDATION_FAILED', 'The unit request does not match this client / chassis type.', 422, { requestNo: 'Mismatch' });
      return tx(() => {
        c.status = 'Allocated'; c.statusSince = nowIso();
        c.allocation = { clientCode: input.clientCode, contractNo: input.contractNo, date: nowIso(), expectedReturn: input.expectedReturn || undefined, targetPickupDate: input.targetPickupDate, requestNo: req?.reqNo };
        if (req) { req.allocated.push(c.chassisNo); req.status = req.allocated.length >= req.qty ? 'Allocated' : 'Partially Allocated'; }
        audit('chassis.allocated', 'chassis', c.chassisNo, { status: 'Allocated', ...c.allocation }, reg === 'Near expiry' ? 'Registration near expiry acknowledged' : undefined, { status: 'Available' });
        return c;
      });
    },
    async release(chassisNo: string) {
      requirePerm('alloc.board', 'edit');
      return tx(() => {
        const c = mustChassis(chassisNo); if (c.status !== 'Allocated') throw new ApiError('INVALID_STATE', 'Only Allocated chassis can be released.', 409);
        const req = c.allocation?.requestNo ? (db.unitRequests ?? []).find((r) => r.reqNo === c.allocation?.requestNo) : undefined;
        if (req) { req.allocated = req.allocated.filter((x) => x !== chassisNo); req.status = req.allocated.length ? 'Partially Allocated' : 'Open'; }
        const before = c.allocation; c.status = 'Available'; c.allocation = undefined; c.statusSince = nowIso(); audit('chassis.allocation_released', 'chassis', chassisNo, { status: 'Available' }, undefined, { status: 'Allocated', ...before }); return c;
      });
    },
    /** BR-07 / DBL-ALO-004: manual, audited Breakdown → Available sign-off. Needs all JOs closed and current registration / OR-CR. */
    async signoff(chassisNo: string, remarks: string) {
      requirePerm('chassis.status', 'approve');
      await delay();
      const c = mustChassis(chassisNo);
      if (!['Breakdown', 'In Repair'].includes(c.status)) throw new ApiError('INVALID_STATE', `Chassis is ${c.status}, not Breakdown / In Repair.`, 409);
      const jo = openJoOf(chassisNo);
      if (jo) throw new ApiError('INVALID_STATE', `Job order ${jo.joNo} is still ${jo.status} — close it first (BR-07).`, 409);
      if (yardCategoryOf(c) !== 'TQS') throw new ApiError('INVALID_STATE', 'Repair is not finished (category is not TQS).', 409);
      const reg = regStateOf(chassisNo);
      if (reg === 'Expired' || reg === 'Missing') throw new ApiError('REGISTRATION_EXPIRED', `Registration / OR-CR is ${reg.toLowerCase()} — renew it before sign-off (BR-07).`, 409);
      if (!remarks.trim()) throw new ApiError('VALIDATION_FAILED', 'Sign-off remarks are required.', 422, { remarks: 'Required' });
      return tx(() => { const from = c.status; c.status = 'Available'; c.generalAssessment = 'Roadworthy'; c.yardCategory = undefined; c.statusSince = nowIso(); audit('chassis.status', 'chassis', chassisNo, { status: 'Available' }, `BR-07 manual sign-off: ${remarks}`, { status: from }); return c; });
    },
    /** Cross-branch transfer of an Available chassis — Operations Manager approval via the Inbox. */
    async requestTransfer(chassisNo: string, toBranch: string, reason: string) {
      requirePerm('alloc.board', 'edit');
      await delay();
      const c = mustChassis(chassisNo);
      if (c.status !== 'Available') throw new ApiError('INVALID_STATE', 'Only Available chassis can be transferred.', 409);
      if (!toBranch || toBranch === c.branchCode) throw new ApiError('VALIDATION_FAILED', 'Select a different destination branch.', 422, { toBranch: 'Different branch required' });
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      if (pendingTransferOf(chassisNo)) throw new ApiError('INVALID_STATE', 'A transfer is already pending for this chassis.', 409);
      const wf = startWorkflow('CHASSIS_TRANSFER', `Chassis transfer ${chassisNo}: ${c.branchCode} → ${toBranch}`, 'chassis', chassisNo, [{ label: 'Operations Manager', roles: ['OPS_MANAGER'] }], undefined, c.branchCode);
      (wf as unknown as { payload: { from: string; to: string } }).payload = { from: c.branchCode, to: toBranch };
      audit('chassis.transfer_requested', 'chassis', chassisNo, { toBranch, workflow: wf.id }, reason); persist();
      return { workflowId: wf.id };
    },
    /** Client unit requests — allocation-tracking pipeline (DBL-ALO-002). */
    async unitRequests(f: { status?: string; region?: string; branch?: string } = {}) {
      requirePerm('alloc.board');
      return tx(() => (db.unitRequests ?? []).filter((r) => (inScope(r.branchCode) || me().branchAccess === 'ALL') && (!f.status || r.status === f.status) && (!f.branch || r.branchCode === f.branch) && (!f.region || islandOf(r.branchCode) === f.region)).map((r) => ({
        ...r, clientName: clientName(r.clientCode), contractType: db.contracts.find((k) => k.contractNo === r.contractNo)?.contractType, region: islandOf(r.branchCode), monetary: monetaryStatusOf(r.clientCode, r.contractNo),
        daysToPickup: daysBetween(nowIso(), new Date(r.targetPickupDate).toISOString()),
        matches: db.chassis.filter((c) => c.branchCode === r.branchCode && c.chassisType === r.equipmentType && c.status === 'Available' && !['Expired', 'Missing'].includes(regStateOf(c.chassisNo))).length,
        matchesElsewhere: db.chassis.filter((c) => c.branchCode !== r.branchCode && c.chassisType === r.equipmentType && c.status === 'Available' && islandOf(c.branchCode) === islandOf(r.branchCode) && !['Expired', 'Missing'].includes(regStateOf(c.chassisNo))).length,
      })));
    },
    async createUnitRequest(input: { clientCode: string; contractNo: string; branchCode: string; equipmentType: string; qty: number; targetPickupDate: string; requiredParts?: string; notes?: string }) {
      requirePerm('alloc.board', 'add');
      await delay();
      const errs: Record<string, string> = {};
      if (!input.clientCode) errs.clientCode = 'Required'; if (!input.contractNo) errs.contractNo = 'Required'; if (!input.branchCode) errs.branchCode = 'Required'; if (!input.equipmentType) errs.equipmentType = 'Required';
      if (!(input.qty >= 1)) errs.qty = 'At least 1'; if (!input.targetPickupDate) errs.targetPickupDate = 'Required'; else if (input.targetPickupDate < nowIso().slice(0, 10)) errs.targetPickupDate = 'Must be today or later';
      if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, errs);
      assertGate(input.clientCode, 'EWA_CREATE');
      if (!db.contracts.some((k) => k.contractNo === input.contractNo && k.clientCode === input.clientCode && k.status === 'Active')) throw new ApiError('VALIDATION_FAILED', 'Select an active contract for this client.', 422, { contractNo: 'No active contract' });
      return tx(() => {
        db.unitRequests ??= []; db.seq.UR = Math.max(db.seq.UR ?? 0, 31);
        const r = { reqNo: nextNo('UR', 'UR-', 6), ...input, allocated: [] as string[], status: 'Open' as const, createdAt: nowIso(), createdBy: me().userId };
        db.unitRequests.unshift(r); audit('unit_request.created', 'unit_request', r.reqNo, r); return r;
      });
    },
    async cancelUnitRequest(reqNo: string, reason: string) {
      requirePerm('alloc.board', 'edit');
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422);
      return tx(() => { const r = (db.unitRequests ?? []).find((x) => x.reqNo === reqNo); if (!r) throw new ApiError('NOT_FOUND', 'Unit request not found.', 404); if (r.allocated.length) throw new ApiError('INVALID_STATE', 'Release the allocated chassis first.', 409); r.status = 'Cancelled'; audit('unit_request.cancelled', 'unit_request', reqNo, { status: 'Cancelled' }, reason); return r; });
    },
    /** SCR-20 DCIR. Today = live (as of now); a past date = read-only nightly snapshot rebuilt from the audited status history. */
    async dcir(f: { branches?: string[]; date?: string; region?: string } | string[] = {}) {
      requirePerm('alloc.dcir');
      const opt = Array.isArray(f) ? { branches: f } : f;
      return tx(() => {
        const idle = Number(S()['alo.idle_days_threshold'] ?? 30); const retention = Number(S()['alo.dcir_snapshot_days'] ?? 90);
        const today = nowIso().slice(0, 10); const date = opt.date && opt.date < today ? opt.date : today; const isSnapshot = date !== today;
        if (isSnapshot && daysBetween(new Date(date).toISOString(), nowIso()) > retention) throw new ApiError('VALIDATION_FAILED', `Snapshots are kept for ${retention} days.`, 422, { date: `Within the last ${retention} days` });
        const asOf = isSnapshot ? new Date(`${date}T23:59:59`).toISOString() : nowIso();
        // Rebuild state at `asOf`: walk audited chassis status/branch changes newer than asOf backwards.
        const state = new Map(db.chassis.map((c) => [c.chassisNo, { ...c }]));
        if (isSnapshot) for (const a of db.audit) {
          if (a.entityType !== 'chassis' || a.at <= asOf) continue;
          const s = state.get(a.entityId); if (!s) continue;
          if (a.action === 'chassis.created') { state.delete(a.entityId); continue; }
          const b = a.before as { status?: import('../shared').ChassisStatus; branchCode?: string } | undefined;
          if (b?.status) s.status = b.status; if (b?.branchCode) s.branchCode = b.branchCode;
        }
        const fleet = [...state.values()].filter((c) => inScope(c.branchCode) || me().branchAccess === 'ALL');
        const cols = ['Available', 'Allocated', 'On Hire', 'Rescue', 'Breakdown', 'In Repair', 'Parked', 'Other'] as const;
        const cats = ['TQS', 'Roadworthy', 'Minor Repair', 'Major Repair'] as const;
        const statusCol = (s: string) => ((cols as readonly string[]).includes(s) ? s : 'Other');
        // Every branch holding fleet units is listed (incl. HO if any) so the Total row always equals the fleet count.
        const bs = db.branches.filter((b) => fleet.some((c) => c.branchCode === b.code) || (!b.isHeadOffice && (inScope(b.code) || me().branchAccess === 'ALL')))
          .filter((b) => (!opt.branches?.length || opt.branches.includes(b.code)) && (!opt.region || islandOf(b.code) === opt.region));
        const rows = bs.map((b) => {
          const cs = fleet.filter((c) => c.branchCode === b.code);
          const avail = cs.filter((c) => c.status === 'Available');
          const regBlocked = avail.filter((c) => ['Expired', 'Missing'].includes(regStateOf(c.chassisNo, asOf))).length;
          return { branch: b.code, branchName: b.name, region: islandOf(b.code), ...Object.fromEntries(cols.map((s) => [s, cs.filter((c) => statusCol(c.status) === s).length])),
            ...Object.fromEntries(cats.map((k) => [k, cs.filter((c) => yardCategoryOf(c) === k).length])), total: cs.length, regBlocked, releasable: avail.length - regBlocked,
            regNear: avail.filter((c) => regStateOf(c.chassisNo, asOf) === 'Near expiry').length, signoff: cs.filter((c) => yardCategoryOf(c) === 'TQS').length,
            idle: avail.filter((c) => daysBetween(c.statusSince, asOf) > idle).length,
            parkFix: db.parkFix.filter((p) => p.branchCode === b.code && p.parkInAt <= asOf && (!p.parkOutAt || p.parkOutAt > asOf)).length } as Record<string, number | string>;
        });
        const idleUnits = fleet.filter((c) => c.status === 'Available' && daysBetween(c.statusSince, asOf) > idle && bs.some((b) => b.code === c.branchCode)).map((c) => ({ chassisNo: c.chassisNo, branchCode: c.branchCode, days: daysBetween(c.statusSince, asOf) }));
        return { cols, cats, rows, idleUnits, idleThreshold: idle, date, asOf, isSnapshot, retentionDays: retention, fleetTotal: fleet.length, scope: me().branchAccess === 'ALL' ? 'All branches (nationwide)' : `Your branches: ${(me().branchAccess as string[]).join(', ')}` };
      });
    },
    /** SCR-21 Park & Fix — client-owned trailers stored at a depot (not part of the Delbros fleet / DCIR availability). */
    async parkFix(f: { status?: string; branch?: string; client?: string } = {}) {
      requirePerm('alloc.parkfix');
      return tx(() => db.parkFix.map((p) => {
        const days = Math.max(1, Math.ceil((new Date(p.parkOutAt ?? nowIso()).getTime() - new Date(p.parkInAt).getTime()) / 86400000));
        const displayStatus = p.billingStatus === 'Billed' ? 'Billed' : p.status === 'Released' ? 'Parked out' : 'Parked';
        return { ...p, clientName: clientName(p.clientCode), days, amountToDate: round2(days * p.dailyRate), displayStatus, billingStatus: p.billingStatus ?? 'Unbilled', clientOwned: p.clientOwned ?? !db.chassis.some((c) => c.chassisNo === p.chassisNo), joStatus: p.joNo ? db.jobOrders.find((j) => j.joNo === p.joNo)?.status : undefined };
      }).filter((p) => (!f.status || p.displayStatus === f.status) && (!f.branch || p.branchCode === f.branch) && (!f.client || p.clientCode === f.client)));
    },
    async parkIn(p: { chassisNo: string; clientCode: string; branchCode: string; reason: 'Idle' | 'Awaiting Repair' | 'Client Request'; dailyRate: number; chassisType?: string; plateNo?: string; service?: 'Park only' | 'Park & Repair'; repairCategories?: RepairCategory[]; expectedParkOut?: string; rateOverrideReason?: string; gate?: import('../shared').ParkFixGate }) {
      requirePerm('alloc.parkfix', 'add');
      await delay();
      const no = p.chassisNo.trim().toUpperCase(); const g = p.gate;
      const errs: Record<string, string> = {};
      if (!no) errs.chassisNo = 'Required'; if (!p.clientCode) errs.clientCode = 'Required'; if (!p.plateNo?.trim()) errs.plateNo = 'Required'; if (!p.chassisType) errs.chassisType = 'Required';
      if (!g?.trucker.trim()) errs.trucker = 'Required'; if (!g?.truckPlateNo.trim()) errs.truckPlateNo = 'Required'; if (!g?.driverName.trim()) errs.driverName = 'Required'; if (!g?.driverLicenseNo.trim()) errs.driverLicenseNo = 'Required';
      if (!g?.signature) errs.signature = 'Driver signature required';
      if (p.expectedParkOut && p.expectedParkOut < nowIso().slice(0, 10)) errs.expectedParkOut = 'Must be today or later';
      if (db.chassis.some((c) => c.chassisNo === no)) errs.chassisNo = 'This number belongs to the Delbros fleet — Park & Fix is for client-owned trailers';
      if (db.parkFix.some((x) => x.chassisNo === no && x.status === 'Parked')) errs.chassisNo = 'This trailer is already parked';
      const configured = Number(S()['alo.parkfix_daily_rate'] ?? 350);
      if (p.dailyRate !== configured) {
        const mayOverride = (() => { try { requirePerm('alloc.parkfix', 'approve'); return true; } catch { return false; } })();
        if (!mayOverride) errs.dailyRate = `Rate is set by configuration (₱${configured}); you are not allowed to override it`;
        else if (!p.rateOverrideReason?.trim()) errs.rateOverrideReason = 'Reason required to override the configured rate';
      }
      if (!(p.dailyRate > 0)) errs.dailyRate = 'Must be greater than 0';
      if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, errs);
      assertGate(p.clientCode, 'PARK_IN');
      return tx(() => {
        db.seq.PFR = Math.max(db.seq.PFR ?? 0, 1);
        const id = nextNo('PF', 'PF-', 4); const inReceiptNo = nextNo('PFR', 'PFR-IN-', 6);
        let joNo: string | undefined;
        if (p.service === 'Park & Repair') {
          joNo = nextNo('JO', `JO-${p.branchCode}-`, 6);
          db.jobOrders.unshift({ joNo, chassisNo: no, branchCode: p.branchCode, source: 'Spot Repair', sourceRef: id, categories: p.repairCategories?.length ? p.repairCategories : ['Mechanical'], notes: `Park & Fix repair for client-owned trailer ${no} (${clientName(p.clientCode)}). Chargeable to client.`, workers: [], status: 'Draft', isMajor: false, chargeable: true, bom: [], labor: [], createdAt: nowIso(), createdBy: me().userId });
        }
        const r: import('../shared').ParkFixRecord = { id, chassisNo: no, clientOwned: true, chassisType: p.chassisType, plateNo: p.plateNo?.trim().toUpperCase(), clientCode: p.clientCode, branchCode: p.branchCode, reason: p.service === 'Park & Repair' ? 'Awaiting Repair' : p.reason,
          service: p.service ?? 'Park only', joNo, dailyRate: p.dailyRate, rateOverrideReason: p.dailyRate !== configured ? p.rateOverrideReason : undefined, expectedParkOut: p.expectedParkOut || undefined, parkInAt: nowIso(), status: 'Parked', inReceiptNo, billingStatus: 'Unbilled', reprintCount: 0, parkIn: { ...g!, by: me().userId } };
        db.parkFix.unshift(r);
        audit('parkfix.in', 'parkfix', id, { chassisNo: no, inReceiptNo, joNo, dailyRate: p.dailyRate }, r.rateOverrideReason ? `Rate override: ${r.rateOverrideReason}` : undefined);
        return r;
      });
    },
    /** Park-out: gate receipt + final days/amount; the fee is posted to billing as a Debit Memo (proposed timing — Q-ALO-02). */
    async parkOut(id: string, g?: import('../shared').ParkFixGate) {
      requirePerm('alloc.parkfix', 'edit');
      await delay();
      const r = db.parkFix.find((x) => x.id === id);
      if (!r) throw new ApiError('NOT_FOUND', 'Park & Fix record not found.', 404);
      if (r.status !== 'Parked') throw new ApiError('INVALID_STATE', 'This unit has already been parked out.', 409);
      const errs: Record<string, string> = {};
      if (!g?.trucker.trim()) errs.trucker = 'Required'; if (!g?.truckPlateNo.trim()) errs.truckPlateNo = 'Required'; if (!g?.driverName.trim()) errs.driverName = 'Required'; if (!g?.driverLicenseNo.trim()) errs.driverLicenseNo = 'Required'; if (!g?.signature) errs.signature = 'Driver signature required';
      if (Object.keys(errs).length) throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, errs);
      return tx(() => {
        r.parkOutAt = nowIso(); r.status = 'Released'; r.parkOut = { ...g!, by: me().userId };
        const days = Math.max(1, Math.ceil((new Date(r.parkOutAt).getTime() - new Date(r.parkInAt).getTime()) / 86400000)); const amount = round2(days * r.dailyRate);
        r.outReceiptNo = nextNo('PFR', 'PFR-OUT-', 6);
        const memoNo = nextNo('DM', 'DM-', 6);
        db.memos.unshift({ memoNo, type: 'Debit', clientCode: r.clientCode, referenceType: 'Park & Fix', referenceId: r.id, amount, reason: `Park & Fix ${r.chassisNo} — ${days} day(s) × ₱${r.dailyRate} (DBL-ALO-005)`, status: 'Posted', createdAt: nowIso() });
        r.billingStatus = 'Billed'; r.debitMemoNo = memoNo; r.billedAmount = amount;
        audit('parkfix.out', 'parkfix', r.id, { outReceiptNo: r.outReceiptNo, days, amount, debitMemoNo: memoNo });
        return { ...r, days, amount };
      });
    },
    async reprintParkReceipt(id: string, which: 'in' | 'out') {
      requirePerm('alloc.parkfix');
      return tx(() => { const r = db.parkFix.find((x) => x.id === id); if (!r) throw new ApiError('NOT_FOUND', 'Record not found.', 404); r.reprintCount = (r.reprintCount ?? 0) + 1; audit('parkfix.receipt_reprinted', 'parkfix', id, { which, reprint: r.reprintCount }); return r.reprintCount; });
    },
  },

  // ── Rescue (M06) ─────────────────────────────────────────────────────────
  rescue: {
    // isOpen excludes Completed / Cancelled / Blocked (single source for every "open rescues" view); the elapsed timer stops at completion, cancellation or block.
    async list(f: { status?: string; branch?: string; client?: string; from?: string; to?: string; open?: boolean } = {}) {
      const u = me();
      if (u.realm === 'INTERNAL') requirePerm('rescue.request');
      const svc = Number(S()['res.service_charge_pct'] ?? 0.1), vat = Number(S()['fin.vat_pct'] ?? 0.12);
      return tx(() => db.rescues.filter((r) => (u.realm === 'CLIENT_PORTAL' ? r.clientCode === u.clientCode : true)).filter((r) => (!f.status || r.status === f.status) && (!f.branch || r.branchCode === f.branch) && (!f.client || r.clientCode === f.client)
          && (!f.from || r.requestedAt.slice(0, 10) >= f.from) && (!f.to || r.requestedAt.slice(0, 10) <= f.to) && (f.open == null || rescueIsOpen(r) === f.open))
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
        .map((r) => {
          const endAt = r.completedAt ?? r.cancelledAt ?? r.blockedAt ?? (r.status === 'Blocked' ? r.requestedAt : undefined);
          const charge = r.oneWayKm != null ? computeRescueCharge({ oneWayKm: r.oneWayKm, ratePerKm: r.ratePerKm ?? 0, tireCost: r.tireCost ?? 0, partsCost: r.partsCost ?? 0, serviceChargePct: svc, vatPct: vat }) : undefined;
          return { ...r, clientName: clientName(r.clientCode), isOpen: rescueIsOpen(r), timerStopped: !rescueIsOpen(r),
            elapsedMin: !rescueIsOpen(r) && !endAt ? null : Math.max(0, Math.round(((endAt ? new Date(endAt) : new Date()).getTime() - new Date(r.requestedAt).getTime()) / 60000)), charge };
        }));
    },
    async get(no: string) {
      return tx(() => {
        const r = db.rescues.find((x) => x.rescueNo === no); if (!r) throw new ApiError('NOT_FOUND', 'Rescue not found', 404);
        const c = clientOf(r.clientCode);
        return { ...r, clientName: clientName(r.clientCode), client: c, ewallet: db.ewallets.find((e) => e.clientCode === r.clientCode), isOpen: rescueIsOpen(r),
          eligibility: { gate: creditGate(c, 'RESCUE_DISPATCH'), allowRescue: !!c?.allowRescue, accountStatus: c?.status ?? '—', outstanding: outstandingOf(r.clientCode), overdue: round2(agingFor(r.clientCode).total - agingFor(r.clientCode).current) },
          debitMemo: r.debitMemoNo ? db.memos.find((m) => m.memoNo === r.debitMemoNo) : undefined };
      });
    },
    async request(f: RescueRequestForm & { clientCode?: string; lat?: number; lng?: number; loadStatus?: 'Loaded' | 'Empty'; photos?: string[]; problemType?: string }) {
      const u = me();
      const clientCode = u.realm === 'CLIENT_PORTAL' ? u.clientCode! : f.clientCode!;
      await delay(250);
      const gate = creditGate(clientOf(clientCode), 'RESCUE_REQUEST');
      const c = mustClient(clientCode);
      const ch = db.chassis.find((x) => x.chassisNo === f.chassisNo);
      const r: RescueRequest = { rescueNo: nextNo('RSC', 'RSC-', 6), clientCode, chassisNo: f.chassisNo, locationText: f.locationText, lat: f.lat, lng: f.lng, incident: f.incident, sceneContactName: f.sceneContactName, sceneContactPhone: f.sceneContactPhone,
        urgent: f.urgent, status: gate.allowed ? 'Requested' : 'Blocked', blockedReason: gate.allowed ? undefined : gate.reason, requestedAt: nowIso(), requestedVia: u.realm === 'CLIENT_PORTAL' ? 'Portal' : 'Internal', branchCode: ch?.branchCode ?? c.branchCode, chargeable: true, loadStatus: f.loadStatus, photos: f.photos?.length ? f.photos : undefined, problemType: f.problemType || undefined };
      db.rescues.unshift(r);
      if (gate.allowed) notify('rescue.requested', `${f.urgent ? 'URGENT ' : ''}Rescue ${r.rescueNo}: ${c.clientName}`, `${f.chassisNo} · ${f.locationText} · ${f.incident}`, { branchCode: r.branchCode, link: `/rescue/${r.rescueNo}` });
      audit('rescue.requested', 'rescue', r.rescueNo, r); persist();
      return structuredClone(r);
    },
    async advance(no: string, action: 'verify' | 'confirm' | 'dispatch' | 'start' | 'cancel' | 'not-eligible', data: { crew?: string; eta?: string; reason?: string; rescueVehicle?: string; driverName?: string; driverPhone?: string } = {}) {
      requirePerm('rescue.dispatch', action === 'verify' || action === 'confirm' || action === 'not-eligible' ? 'check' : 'edit');
      return tx(() => {
        const r = db.rescues.find((x) => x.rescueNo === no); if (!r) throw new ApiError('NOT_FOUND', 'Rescue not found', 404);
        const from: Record<string, RescueRequest['status'][]> = { verify: ['Requested'], 'not-eligible': ['Requested', 'Verified'], confirm: ['Verified'], dispatch: ['Confirmed'], start: ['Dispatched'], cancel: ['Requested', 'Verified', 'Confirmed', 'Dispatched', 'In Progress'] };
        if (!from[action].includes(r.status)) throw new ApiError('INVALID_STATE', `Cannot ${action} a rescue in ${r.status}.`, 409);
        if (action === 'verify') { const g = creditGate(clientOf(r.clientCode), 'RESCUE_DISPATCH'); if (!g.allowed) { r.status = 'Blocked'; r.blockedReason = g.reason; r.blockedAt = nowIso(); r.notEligibleBy = me().userId; audit('rescue.blocked', 'rescue', no, undefined, g.reason); persist(); return r; } r.status = 'Verified'; r.verifiedBy = me().userId; }
        if (action === 'not-eligible') { if (!data.reason?.trim()) throw new ApiError('VALIDATION_FAILED', 'Give the reason the client is not eligible.', 422, { reason: 'Required' }); r.status = 'Blocked'; r.blockedReason = `Not eligible (C&C): ${data.reason}`; r.blockedAt = nowIso(); r.notEligibleBy = me().userId; }
        if (action === 'confirm') { r.status = 'Confirmed'; r.confirmedBy = me().userId; }
        if (action === 'dispatch') {
          assertGate(r.clientCode, 'RESCUE_DISPATCH');
          if (!data.crew) throw new ApiError('VALIDATION_FAILED', 'Assign a vendor or crew.', 422, { crew: 'Required' });
          if (!data.rescueVehicle?.trim() || !data.driverName?.trim()) throw new ApiError('VALIDATION_FAILED', 'Record the rescue vehicle and driver (DBL-RES-008).', 422, { rescueVehicle: data.rescueVehicle ? '' : 'Required', driverName: data.driverName ? '' : 'Required' });
          Object.assign(r, { status: 'Dispatched', crew: data.crew, eta: data.eta, rescueVehicle: data.rescueVehicle, driverName: data.driverName, driverPhone: data.driverPhone, dispatchedAt: nowIso() });
          notify('rescue.dispatched', `Rescue ${r.rescueNo} dispatched`, `${clientName(r.clientCode)} · ${r.chassisNo} · crew ${data.crew}${data.eta ? ` · ETA ${data.eta}` : ''}`, { clientCode: r.clientCode, aeUserId: clientOf(r.clientCode)?.aeAssigned, branchCode: r.branchCode, link: `/rescue/${r.rescueNo}` }); // N41
          const ch = db.chassis.find((x) => x.chassisNo === r.chassisNo); if (ch && ch.status === 'On Hire') { ch.status = 'Rescue'; ch.statusSince = nowIso(); }
        }
        if (action === 'start') r.status = 'In Progress';
        if (action === 'cancel') {
          if (!data.reason?.trim()) throw new ApiError('VALIDATION_FAILED', 'A cancellation reason is required.', 422, { reason: 'Required' });
          Object.assign(r, { status: 'Cancelled', cancelReason: data.reason, cancelledBy: me().userId, cancelledAt: nowIso() });
          const ch = db.chassis.find((x) => x.chassisNo === r.chassisNo); if (ch && ch.status === 'Rescue') { ch.status = 'On Hire'; ch.statusSince = nowIso(); }
        }
        audit(`rescue.${action}`, 'rescue', no, { status: r.status }, data.reason);
        persist();
        return r;
      });
    },
    // DBL-RES-005 / DBL-NOT-003: acknowledging an urgent request stops the repeating SMS.
    async acknowledge(no: string) {
      requirePerm('rescue.request', 'edit');
      return tx(() => {
        const r = db.rescues.find((x) => x.rescueNo === no); if (!r) throw new ApiError('NOT_FOUND', 'Rescue not found', 404);
        if (!r.urgent || r.urgentAckAt) throw new ApiError('INVALID_STATE', 'Only an unacknowledged urgent request can be acknowledged.', 409);
        r.urgentAckBy = me().userId; r.urgentAckAt = nowIso();
        audit('rescue.acknowledged', 'rescue', no, { urgentAckBy: r.urgentAckBy }); persist();
        return r;
      });
    },
    async complete(no: string, cost: { oneWayKm: number; tireCost: number; partsCost: number; chargeable: boolean; costLines?: RescueRequest['costLines']; onsiteAssessment?: string; beforePhotos?: string[]; afterPhotos?: string[]; clientAckName?: string }) {
      requirePerm('rescue.dispatch', 'edit');
      await delay();
      const r = db.rescues.find((x) => x.rescueNo === no); if (!r) throw new ApiError('NOT_FOUND', 'Rescue not found', 404);
      if (r.status !== 'In Progress') throw new ApiError('INVALID_STATE', `Cannot complete a rescue in ${r.status}.`, 409);
      const missing = { onsiteAssessment: cost.onsiteAssessment?.trim() ? '' : 'Required', beforePhotos: cost.beforePhotos?.length ? '' : 'Required', afterPhotos: cost.afterPhotos?.length ? '' : 'Required', clientAckName: cost.clientAckName?.trim() ? '' : 'Required' };
      if (Object.values(missing).some(Boolean)) throw new ApiError('VALIDATION_FAILED', 'On-site assessment, before/after photos and the client acknowledgment are required to complete (DBL-RES-006).', 422, missing);
      const rate = Number(S()['res.rate_per_km'] ?? 50);
      const charge = computeRescueCharge({ oneWayKm: cost.oneWayKm, ratePerKm: rate, tireCost: cost.tireCost, partsCost: cost.partsCost, serviceChargePct: Number(S()['res.service_charge_pct'] ?? 0.1), vatPct: Number(S()['fin.vat_pct'] ?? 0.12) });
      Object.assign(r, { status: 'Completed', completedAt: nowIso(), completedBy: me().userId, oneWayKm: cost.oneWayKm, ratePerKm: rate, tireCost: cost.tireCost, partsCost: cost.partsCost, chargeable: cost.chargeable, total: charge.total, acknowledgedAt: nowIso(),
        costLines: cost.costLines, onsiteAssessment: cost.onsiteAssessment, beforePhotos: cost.beforePhotos, afterPhotos: cost.afterPhotos, clientAckName: cost.clientAckName });
      const ch = db.chassis.find((x) => x.chassisNo === r.chassisNo); if (ch && ch.status === 'Rescue') { ch.status = 'On Hire'; ch.statusSince = nowIso(); }
      notify('rescue.completed', `Rescue completed: ${no}`, `${clientName(r.clientCode)} · total ₱${charge.total.toLocaleString('en-PH')}`, { clientCode: r.clientCode, branchCode: r.branchCode });
      audit('rescue.completed', 'rescue', no, { ...charge }); persist();
      return { rescue: structuredClone(r), charge };
    },
    // DBL-RES-006: Debit Memo from the completed rescue, posted for e-wallet deduction (BR-04: the wallet may go negative).
    async generateDebitMemo(no: string) {
      requirePerm('rescue.dispatch', 'edit');
      await delay();
      const r = db.rescues.find((x) => x.rescueNo === no); if (!r) throw new ApiError('NOT_FOUND', 'Rescue not found', 404);
      if (r.status !== 'Completed' || !r.chargeable || !r.total) throw new ApiError('INVALID_STATE', 'A Debit Memo needs a completed, chargeable rescue with a total.', 409);
      if (r.debitMemoNo) throw new ApiError('DUPLICATE', `Debit Memo ${r.debitMemoNo} already exists for ${no}.`, 409);
      const dm = nextNo('DM', 'DM-', 6);
      db.memos.unshift({ memoNo: dm, type: 'Debit', clientCode: r.clientCode, referenceType: 'Rescue', referenceId: no, amount: r.total, reason: 'Rescue charge (BR-11)', status: 'Posted', createdAt: nowIso() });
      r.debitMemoNo = dm;
      ewalletPost(r.clientCode, 'Deduction', -r.total, 'Debit Memo', dm, `Rescue ${no}`);
      r.ewalletBalanceAfter = db.ewallets.find((e) => e.clientCode === r.clientCode)?.balance;
      audit('rescue.debit_memo', 'rescue', no, { memoNo: dm, amount: r.total, balanceAfter: r.ewalletBalanceAfter }); persist();
      return structuredClone(r);
    },
  },

  // ── Repair (M07) ─────────────────────────────────────────────────────────
  repair: {
    async list(f: { status?: string; chassis?: string } = {}) {
      requirePerm('repair.jo');
      return tx(() => db.jobOrders.filter((j) => inScope(j.branchCode) || me().branchAccess === 'ALL').filter((j) => (!f.status || j.status === f.status) && (!f.chassis || j.chassisNo === f.chassis))
        .map((j) => ({ ...j, partsCost: j.bom.reduce((a, b) => a + b.qty * b.unitCost, 0), laborCost: j.labor.reduce((a, l) => a + l.hours * l.rate, 0) })));
    },
    async get(no: string) { requirePerm('repair.jo'); return tx(() => { const j = db.jobOrders.find((x) => x.joNo === no); if (!j) throw new ApiError('NOT_FOUND', 'Job order not found', 404); return { jo: j, workflow: db.workflows.find((w) => w.subjectId === no && w.matrixCode === 'JOB_ORDER'), chassis: db.chassis.find((c) => c.chassisNo === j.chassisNo) }; }); },
    async create(input: { chassisNo: string; source: JobOrder['source']; categories: RepairCategory[]; notes: string; workers: string[]; isMajor: boolean; chargeable: boolean; spotDriver?: JobOrder['spotDriver'] }) {
      requirePerm('repair.jo', 'add');
      await delay();
      const c = mustChassis(input.chassisNo);
      if (!input.categories.length) throw new ApiError('VALIDATION_FAILED', 'Select at least one repair system.', 422, { categories: 'Required' });
      if (input.source === 'Spot Repair') { if (!c.currentClientCode) throw new ApiError('VALIDATION_FAILED', 'Spot repair applies to on-hire chassis.', 422); assertGate(c.currentClientCode, 'JO_CREATE_SPOT'); }
      const conflicts = input.categories.filter((cat) => db.jobOrders.some((j) => j.chassisNo === c.chassisNo && !j.status.startsWith('Closed') && j.categories.includes(cat)));
      if (conflicts.length) throw new ApiError('JO_CONFLICT_OPEN_CATEGORY', `Chassis already has an open job order for: ${conflicts.join(', ')}.`, 409, { categories: 'Conflicting open JO' });
      const joNo = nextNo('JO', `JO-${c.branchCode}-`, 6);
      const jo: JobOrder = { joNo, ...input, branchCode: c.branchCode, status: 'Draft', bom: [], labor: [], createdAt: nowIso(), createdBy: me().userId };
      db.jobOrders.unshift(jo);
      notify(input.source === 'Spot Repair' ? 'jo.spot_repair' : 'jo.created', `Job order ${joNo}${input.isMajor ? ' (MAJOR — DYM escalation)' : ''}`, `${c.chassisNo} · ${input.categories.join(', ')}`, { branchCode: c.branchCode, link: `/repair/jo/${joNo}` });
      audit('jo.created', 'jo', joNo, jo); persist();
      return structuredClone(jo);
    },
    async transition(no: string, action: 'approve' | 'start' | 'hold' | 'resume' | 'close-rm') {
      requirePerm('repair.jo', action === 'approve' ? 'approve' : 'edit');
      await delay();
      const j = db.jobOrders.find((x) => x.joNo === no)!;
      const allowed: Record<string, JobOrder['status'][]> = { approve: ['Draft'], start: ['Confirmed'], hold: ['Ongoing'], resume: ['On Hold'], 'close-rm': ['Ongoing'] };
      if (!allowed[action].includes(j.status)) throw new ApiError('INVALID_STATE', `Cannot ${action} a job order in ${j.status}.`, 409);
      if (action === 'approve') {
        j.status = 'Approved'; j.approvedBy = me().userId;
        startWorkflow('JOB_ORDER', `Job order ${no} — DYM confirmation${j.isMajor ? ' (major)' : ''}`, 'jo', no, [{ label: 'Deputy Yard Manager — Confirm', roles: ['DYM'] }], undefined, j.branchCode);
      }
      if (action === 'start') j.status = 'Ongoing';
      if (action === 'hold') j.status = 'On Hold';
      if (action === 'resume') j.status = 'Ongoing';
      if (action === 'close-rm') { j.status = 'Closed by R&M'; j.closedAt = nowIso(); }
      audit(`jo.${action}`, 'jo', no, { status: j.status }); persist();
      return structuredClone(j);
    },
    async addBom(no: string, lines: { partCode: string; qty: number }[], warehouseCode: string) {
      requirePerm('repair.bom', 'add');
      await delay();
      const j = db.jobOrders.find((x) => x.joNo === no)!;
      if (j.status === 'Draft' || j.status.startsWith('Closed')) throw new ApiError('INVALID_STATE', 'BOM can be recorded only on Approved / Confirmed / Ongoing job orders.', 409);
      for (const l of lines) {
        const p = db.parts.find((x) => x.partCode === l.partCode); if (!p) throw new ApiError('NOT_FOUND', `Part code ${l.partCode} not found in inventory master.`, 404);
        const bal = db.stock.find((s) => s.partCode === l.partCode && s.warehouseCode === warehouseCode);
        if (!bal || bal.qtyOnHand < l.qty) throw new ApiError('STOCK_NEGATIVE', `Insufficient stock for ${l.partCode} at ${warehouseCode} (on hand ${bal?.qtyOnHand ?? 0}). Create a stock request or PR.`, 409);
      }
      for (const l of lines) {
        const p = db.parts.find((x) => x.partCode === l.partCode)!;
        const bal = db.stock.find((s) => s.partCode === l.partCode && s.warehouseCode === warehouseCode)!;
        bal.qtyOnHand -= l.qty;
        db.stockTxns.unshift({ id: uid(), txnNo: nextNo('STK', 'STK-', 6), type: 'Issue', partCode: l.partCode, qty: -l.qty, fromWarehouse: warehouseCode, referenceType: 'JO', referenceId: no, balanceAfter: bal.qtyOnHand, entityCode: 'DBL', at: nowIso(), by: me().userId });
        j.bom.push({ partCode: l.partCode, description: p.description, qty: l.qty, unitCost: p.standardCost });
      }
      audit('jo.bom', 'jo', no, lines); persist();
      return structuredClone(j);
    },
    async addLabor(no: string, l: { worker: string; hours: number; rate: number; shift: JobOrder['labor'][number]['shift'] }) {
      requirePerm('repair.bom', 'add');
      return tx(() => { const j = db.jobOrders.find((x) => x.joNo === no)!; j.labor.push({ ...l, date: nowIso().slice(0, 10) }); audit('jo.labor', 'jo', no, l); return j; });
    },
    // SCR-27 (DBL-RM-005/006/007). Filters: pay period / date range (labor date, JO close date), branch, week start for capacity.
    // Laborer ID / worker type and capacity / shift figures are sample values until the HRIS feed (Q-RM-01) and shift windows (Q-RM-02) are confirmed.
    async reports(f: { from?: string; to?: string; branch?: string; weekStart?: string } = {}) {
      requirePerm('repair.labor_reports');
      return tx(() => {
        const inRange = (d?: string) => !!d && (!f.from || d.slice(0, 10) >= f.from) && (!f.to || d.slice(0, 10) <= f.to);
        const shiftOf = (s: string) => (s === 'Day' ? 'Morning' : s === 'Night' ? 'Evening' : s) as 'Morning' | 'Afternoon' | 'Evening';
        const workers = new Map<string, { worker: string; branch: string; jos: Map<string, { joNo: string; status: string; chassisNo: string; hours: number; closedAt?: string }>; completed: Set<string>; hours: number; earnings: number; shifts: Record<string, number> }>();
        for (const j of db.jobOrders) {
          if (f.branch && j.branchCode !== f.branch) continue;
          for (const l of j.labor) {
            if (!inRange(l.date)) continue;
            const w = workers.get(l.worker) ?? { worker: l.worker, branch: j.branchCode, jos: new Map(), completed: new Set<string>(), hours: 0, earnings: 0, shifts: {} as Record<string, number> };
            w.hours += l.hours; w.earnings = round2(w.earnings + l.hours * l.rate); w.shifts[shiftOf(l.shift)] = (w.shifts[shiftOf(l.shift)] ?? 0) + l.hours;
            const e = w.jos.get(j.joNo) ?? { joNo: j.joNo, status: j.status, chassisNo: j.chassisNo, hours: 0, closedAt: j.closedAt }; e.hours += l.hours; w.jos.set(j.joNo, e);
            if (j.status.startsWith('Closed')) w.completed.add(j.joNo);
            workers.set(l.worker, w);
          }
        }
        const names = [...new Set(db.jobOrders.flatMap((j) => [...j.workers, ...j.labor.map((l) => l.worker)]))].sort();
        const branches = db.branches.filter((b) => !b.isHeadOffice).filter((b) => !f.branch || b.code === f.branch);
        const hpw = Number(S()['rm.hours_per_laborer_week'] ?? 48);
        const monday = (() => { const d = f.weekStart ? new Date(f.weekStart) : new Date(); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d; })();
        const weeks = [0, 1, 2, 3].map((w) => { const d = new Date(monday); d.setDate(d.getDate() + w * 7); return d.toISOString().slice(0, 10); });
        const allBranches = db.branches.filter((b) => !b.isHeadOffice);
        const capacity = branches.flatMap((b) => { const i = allBranches.findIndex((x) => x.code === b.code); const backlog = db.jobOrders.filter((j) => j.branchCode === b.code && !j.status.startsWith('Closed')).length; const hc = 2 + (i % 2);
          return weeks.map((week, w) => { const planned = 70 + ((i * 17 + w * 23) % 80) + (w === 0 ? backlog * 8 : 0); const available = hc * hpw;
            return { branch: b.code, week, planned, available, backlog: w === 0 ? backlog : 0, availableHeadcount: hc, requiredHeadcount: Math.ceil(planned / hpw), overCapacity: planned >= available }; }); });
        const efficiency = branches.map((b) => { const i = allBranches.findIndex((x) => x.code === b.code);
          const morning = round2(1.6 + (i % 4) * 0.3), afternoon = round2(1.3 + (i % 3) * 0.3), evening = round2(0.7 + (i % 2) * 0.4);
          return { branch: b.code, morning, afternoon, evening, perShift: round2((morning + afternoon + evening) / 3), completedJos: db.jobOrders.filter((j) => j.branchCode === b.code && j.status.startsWith('Closed') && (!f.from && !f.to ? true : inRange(j.closedAt))).length, turnaroundDays: 2 + (i % 5) }; });
        return {
          laborers: [...workers.values()].map((w) => ({ laborerId: `LBR-${String(names.indexOf(w.worker) + 1).padStart(3, '0')}`, worker: w.worker, branch: w.branch, workerType: names.indexOf(w.worker) % 2 ? 'Project-based' : 'Regular',
            completedJos: w.completed.size, hours: w.hours, rate: w.hours ? round2(w.earnings / w.hours) : 0, earnings: w.earnings, shifts: w.shifts, jos: [...w.jos.values()] })),
          weeks, capacity, efficiency, hoursPerLaborerWeek: hpw,
        };
      });
    },
  },

  // ── Inventory (M08) ──────────────────────────────────────────────────────
  inventory: {
    /** Warehouse → branch → island group (DBL-INV-002 roll-up: Luzon / Visayas / Mindanao). */
    whInfo(wh?: string) {
      const br = db.branches.find((b) => `WH-${b.code}` === wh);
      const region = br?.region === 'Visayas' ? 'Visayas' : br?.region === 'Mindanao' ? 'Mindanao' : 'Luzon';
      return { branchCode: br?.code ?? '', branchName: br?.name ?? wh ?? '', region: region as 'Luzon' | 'Visayas' | 'Mindanao' };
    },
    async warehouses() { requirePerm('inv.txn'); return tx(() => [...new Set(db.stock.map((s) => s.warehouseCode))].sort().map((code) => ({ code, ...api.inventory.whInfo(code) }))); },
    /** SCR-28 lookups: open job orders (issuance per equipment, DBL-INV-005) and open PO lines (receiving). */
    async lookups() {
      requirePerm('inv.txn');
      return tx(() => ({
        jos: db.jobOrders.filter((j) => !j.status.startsWith('Closed')).map((j) => ({ joNo: j.joNo, chassisNo: j.chassisNo, branchCode: j.branchCode, status: j.status })),
        pos: db.pos.filter((p) => ['Approved', 'Issued', 'Partially Received'].includes(p.status)).map((p) => ({ poNo: p.poNo, entityCode: p.entityCode, lines: p.lines.map((l) => ({ partCode: l.partCode, qty: l.qty, qtyReceived: l.qtyReceived })) })),
      }));
    },
    async balances(f: { warehouse?: string; lowOnly?: boolean; region?: string; branch?: string; category?: string; entity?: string; varianceOnly?: boolean; pendingPoOnly?: boolean; countDueOnly?: boolean } = {}) {
      requirePerm('inv.balance');
      const cycle = Number(S()['inv.count_cycle_days'] ?? 30), recount = Number(S()['inv.recount_variance_qty'] ?? 5);
      return tx(() => db.stock.filter((s) => (!f.warehouse || s.warehouseCode === f.warehouse)).map((s) => {
        const p = db.parts.find((x) => x.partCode === s.partCode)!;
        const wh = api.inventory.whInfo(s.warehouseCode);
        const pendingPo = db.pos.find((po) => ['Issued', 'Partially Received', 'Approved'].includes(po.status) && po.lines.some((l) => l.partCode === s.partCode))?.poNo;
        const variance = s.lastPhysicalCount == null ? null : s.lastPhysicalCount - s.qtyOnHand;
        const needsRecount = variance != null && Math.abs(variance) >= recount;
        // Low-stock flag uses the lower of system and last counted quantity, so a short count is never reported as OK.
        const effectiveQty = Math.min(s.qtyOnHand, s.lastPhysicalCount ?? s.qtyOnHand);
        const low = effectiveQty <= p.lowStockThreshold;
        const countDue = !s.lastCountDate || (Date.now() - new Date(s.lastCountDate).getTime()) / 86_400_000 > cycle;
        const requestedQty = db.stockTxns.filter((t) => t.type === 'Request' && t.status === 'Open' && t.partCode === s.partCode && t.toWarehouse === s.warehouseCode).reduce((a, t) => a + Math.abs(t.qty), 0);
        return {
          ...s, ...wh, description: p.description, uom: p.uom, category: p.category, weightKg: p.weightKg, movementClass: p.movementClass, entityCode: s.entityCode ?? 'DBL',
          threshold: p.lowStockThreshold, effectiveQty, low, needsRecount, flag: (needsRecount ? 'Recount' : low ? 'Low' : 'OK') as 'Recount' | 'Low' | 'OK',
          variance, value: s.qtyOnHand * p.standardCost, unitCost: p.standardCost, pendingPo, requestedQty, available: Math.max(0, s.qtyOnHand - requestedQty), countDue,
          auditStatus: (s.pendingCount ? 'Pending approval' : countDue ? 'Count due' : 'Counted') as 'Pending approval' | 'Count due' | 'Counted',
        };
      }).filter((r) => (!f.lowOnly || r.low) && (!f.region || r.region === f.region) && (!f.branch || r.branchCode === f.branch) && (!f.category || r.category === f.category) && (!f.entity || r.entityCode === f.entity)
        && (!f.varianceOnly || !!r.variance) && (!f.pendingPoOnly || !!r.pendingPo) && (!f.countDueOnly || r.countDue)));
    },
    async txns(f: string | { type?: string; warehouse?: string; entity?: string; from?: string; to?: string; partCode?: string; status?: string } = {}) {
      requirePerm('inv.txn');
      const q = typeof f === 'string' ? { partCode: f } : f;
      return tx(() => db.stockTxns.filter((t) => (!q.partCode || t.partCode === q.partCode) && (!q.type || t.type === q.type) && (!q.warehouse || t.fromWarehouse === q.warehouse || t.toWarehouse === q.warehouse) && (!q.entity || t.entityCode === q.entity)
        && (!q.status || (t.status ?? 'Posted') === q.status) && (!q.from || t.at.slice(0, 10) >= q.from) && (!q.to || t.at.slice(0, 10) <= q.to)).slice(0, 500).map((t) => {
        const p = db.parts.find((x) => x.partCode === t.partCode);
        return { ...t, status: t.status ?? 'Posted', source: t.source ?? (t.referenceType === 'RR' ? 'Auto — PO' : t.referenceType === 'JO' && !t.joNo ? 'Auto — Job Order' : 'Manual'), description: p?.description, uom: p?.uom, workflow: t.workflowId ? db.workflows.find((w) => w.id === t.workflowId) : undefined, poNo: t.poNo ?? (t.referenceType === 'RR' ? db.rrs.find((r) => r.rrNo === t.referenceId)?.poNo : undefined) };
      }));
    },
    async post(input: { type: StockTxnType; partCode: string; qty: number; fromWarehouse: string; toWarehouse?: string; referenceType?: string; referenceId?: string; reason?: string; entityCode: string; joNo?: string; equipmentRef?: string; approvalRef?: string; poNo?: string; requestingBranch?: string; department?: string; requestedBy?: string; damagedQty?: number; remarks?: string }) {
      requirePerm('inv.txn', 'add');
      await delay();
      const fail = (msg: string, fields: Record<string, string>, code = 'VALIDATION_FAILED', st = 422) => { throw new ApiError(code, msg, st, fields); };
      if (!input.partCode) fail('Select a part.', { partCode: 'Required' });
      if (!input.fromWarehouse) fail('Select a warehouse.', { fromWarehouse: 'Required' });
      if (input.type === 'Adjustment' ? input.qty === 0 : !(input.qty > 0)) fail(input.type === 'Adjustment' ? 'Adjustment quantity cannot be zero.' : 'Quantity must be greater than zero.', { qty: 'Invalid quantity' });
      if (input.type === 'Adjustment' && !input.reason?.trim()) fail('Adjustments require a reason.', { reason: 'Required' });
      if (input.type === 'Issue') {
        const jo = db.jobOrders.find((j) => j.joNo === input.joNo);
        if (!jo) fail('Issuance needs a valid Job Order reference (DBL-INV-005).', { joNo: input.joNo ? 'Job order not found' : 'Required' });
        if (!input.equipmentRef) input.equipmentRef = jo!.chassisNo;
        if (input.damagedQty != null && (input.damagedQty < 0 || input.damagedQty > input.qty)) fail('Damaged parts returned cannot exceed the quantity issued.', { damagedQty: '0 to issued qty' });
      }
      if (input.type === 'Transfer' && (!input.toWarehouse || input.toWarehouse === input.fromWarehouse)) fail('Choose a destination warehouse different from the source.', { toWarehouse: 'Required, ≠ source' });
      if (input.type === 'Request' && (!input.toWarehouse || input.toWarehouse === input.fromWarehouse)) fail('Choose the supplying warehouse (another branch).', { toWarehouse: 'Required, ≠ requesting' });
      if (input.type === 'Request' && (!input.department?.trim() || !input.requestedBy)) fail('Requesting department and requested-by are required.', { department: input.department?.trim() ? '' : 'Required', requestedBy: input.requestedBy ? '' : 'Required' });
      let orderedQty: number | undefined;
      if (input.type === 'Receive') {
        const po = db.pos.find((x) => x.poNo === input.poNo);
        if (!po) fail('Receiving needs a valid PO reference.', { poNo: input.poNo ? 'PO not found' : 'Required' });
        const line = po!.lines.find((l) => l.partCode === input.partCode);
        if (!line) fail(`Part ${input.partCode} is not on ${po!.poNo}.`, { partCode: 'Not on PO' });
        orderedQty = line!.qty;
        if (input.qty > line!.qty - line!.qtyReceived) fail(`Received quantity exceeds the PO balance (${line!.qty - line!.qtyReceived} outstanding).`, { qty: 'Exceeds PO balance' });
      }
      const get = (wh: string) => { let b = db.stock.find((s) => s.partCode === input.partCode && s.warehouseCode === wh); if (!b) { b = { partCode: input.partCode, warehouseCode: wh, qtyOnHand: 0 }; db.stock.push(b); } return b; };
      const from = get(input.fromWarehouse);
      const out = ['Issue', 'Transfer'].includes(input.type);
      if (out && from.qtyOnHand < input.qty) fail(`Insufficient stock — ${from.qtyOnHand} on hand at ${input.fromWarehouse}.`, { qty: 'Insufficient stock' }, 'STOCK_NEGATIVE', 409);
      const txnNo = nextNo('STK', 'STK-', 6);
      const base = { id: uid(), txnNo, ...input, orderedQty, referenceType: input.referenceType ?? ({ Issue: 'JO', Receive: 'PO', Transfer: 'Transfer', Request: 'Request' } as Record<string, string>)[input.type] ?? 'Manual', referenceId: input.referenceId || input.joNo || input.poNo || input.referenceId, at: nowIso(), by: me().userId, source: 'Manual' as const };
      if (input.type === 'Adjustment' || input.type === 'Transfer') {
        const wf = input.type === 'Adjustment'
          ? startWorkflow('STOCK_ADJUSTMENT', `Stock adjustment ${txnNo} — ${input.partCode}`, 'stock', txnNo, [{ label: 'APS approval', roles: ['APS_MANAGER'] }], undefined)
          : startWorkflow('STOCK_TRANSFER', `Stock transfer ${txnNo} — ${input.partCode} ${input.fromWarehouse} → ${input.toWarehouse}`, 'stock', txnNo, [{ label: 'APS approval', roles: ['APS_MANAGER'] }], undefined);
        db.stockTxns.unshift({ ...base, qty: input.type === 'Transfer' ? -input.qty : input.qty, balanceAfter: from.qtyOnHand, status: 'Pending Approval', workflowId: wf.id });
        audit('stock.submitted', 'stock', txnNo, input); persist(); return { txnNo, pendingApproval: true, workflowId: wf.id, balanceAfter: from.qtyOnHand };
      }
      if (input.type === 'Request') {
        db.stockTxns.unshift({ ...base, qty: input.qty, balanceAfter: from.qtyOnHand, status: 'Open' });
        audit('stock.requested', 'stock', txnNo, input); persist(); return { txnNo, pendingApproval: false, balanceAfter: from.qtyOnHand };
      }
      const signed = out ? -input.qty : input.qty;
      from.qtyOnHand += signed;
      db.stockTxns.unshift({ ...base, qty: signed, balanceAfter: from.qtyOnHand, status: 'Posted' });
      const p = db.parts.find((x) => x.partCode === input.partCode)!;
      if (from.qtyOnHand <= p.lowStockThreshold) notify('inventory.low_stock', `Low stock: ${p.partCode}`, `${p.description} at ${input.fromWarehouse}: ${from.qtyOnHand} ${p.uom}`, {});
      audit('stock.posted', 'stock', txnNo, input); persist();
      return { txnNo, pendingApproval: false, balanceAfter: from.qtyOnHand };
    },
    /** Pre-audit count submission (DBL-INV-004). Zero variance records directly; any variance waits for APS approval before posting (DBL-INV-007). */
    async submitCount(input: { partCode: string; warehouseCode: string; counted: number; auditType: 'Monthly cycle count' | 'Annual audit'; reason?: string; photoName?: string }) {
      requirePerm('inv.txn', 'edit');
      return tx(() => {
        const b = db.stock.find((s) => s.partCode === input.partCode && s.warehouseCode === input.warehouseCode)!;
        if (!(input.counted >= 0)) throw new ApiError('VALIDATION_FAILED', 'Counted quantity must be zero or more.', 422, { counted: 'Invalid' });
        if (b.pendingCount) throw new ApiError('INVALID_STATE', 'A count for this line is already awaiting approval.', 409);
        const variance = input.counted - b.qtyOnHand;
        if (variance === 0) { b.lastPhysicalCount = input.counted; b.lastCountDate = nowIso().slice(0, 10); audit('stock.count', 'stock', `${input.partCode}@${input.warehouseCode}`, input); return { pendingApproval: false, variance }; }
        if (!input.reason?.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required for any variance.', 422, { reason: 'Required' });
        if (!input.photoName) throw new ApiError('VALIDATION_FAILED', 'Attach the bin-card photo as count evidence.', 422, { photo: 'Required' });
        const wf = startWorkflow('STOCK_COUNT', `${input.auditType} ${input.partCode} @ ${input.warehouseCode} — variance ${variance > 0 ? '+' : ''}${variance}`, 'stock', `${input.partCode}@${input.warehouseCode}`, [{ label: 'APS / MMG Manager — audit report approval', roles: ['APS_MANAGER'] }], undefined);
        b.pendingCount = { counted: input.counted, auditType: input.auditType, reason: input.reason, photoName: input.photoName, submittedBy: me().userId, submittedAt: nowIso(), workflowId: wf.id };
        audit('stock.count_submitted', 'stock', `${input.partCode}@${input.warehouseCode}`, input); return { pendingApproval: true, variance, workflowId: wf.id };
      });
    },
    async postCount(partCode: string, warehouseCode: string, counted: number) {
      return api.inventory.submitCount({ partCode, warehouseCode, counted, auditType: 'Monthly cycle count', reason: 'Physical count', photoName: 'bin-card.jpg' });
    },
  },

  // ── Procurement (M09) ────────────────────────────────────────────────────
  procurement: {
    async overview() {
      requirePerm('prc.pr');
      const wfInfo = (id?: string) => {
        const w = db.workflows.find((x) => x.id === id); const s = w?.status === 'Pending' ? w.steps[w.currentStep] : undefined;
        return { workflow: w, currentStep: s?.label, pendingApprovers: s ? db.users.filter((u) => u.realm === 'INTERNAL' && u.roles.some((r) => s.roles.includes(r))).map((u) => u.name) : [], escalated: !!s?.dueAt && new Date(s.dueAt) < new Date(), dueAt: s?.dueAt };
      };
      return tx(() => ({
        prs: db.prs.map((p) => ({ ...p, total: p.lines.reduce((a, l) => a + l.qty * l.estUnitCost, 0), itemCount: p.lines.length, supplierName: db.vendors.find((v) => v.vendorId === (p.supplierId ?? p.lines[0]?.supplierId))?.name, requesterName: db.users.find((u) => u.userId === p.requestedBy)?.name, ...wfInfo(p.workflowId) })),
        pos: db.pos.map((p) => { const t = api.procurement.tally(p.poNo); const rrs = db.rrs.filter((r) => r.poNo === p.poNo); return { ...p, total: t.ordered, vendorName: db.vendors.find((v) => v.vendorId === p.vendorId)?.name, invoices: db.vendorInvoices.filter((i) => i.poNo === p.poNo), qtyOrdered: p.lines.reduce((a, l) => a + l.qty, 0), qtyDelivered: p.lines.reduce((a, l) => a + l.qtyReceived, 0), invoiced: t.invoiced, received: t.received, rrCount: rrs.length, matchStatus: t.matched ? 'Matched' : !rrs.length ? 'Awaiting RR' : !t.invoiced ? 'Awaiting invoice' : 'Variance' }; }),
        rrs: db.rrs.map((r) => { const po = db.pos.find((p) => p.poNo === r.poNo); return { ...r, itemsReceived: r.lines.filter((l) => l.qtyReceived > 0).length, qtyReceived: r.lines.reduce((a, l) => a + l.qtyReceived, 0), qtyRejected: r.lines.reduce((a, l) => a + l.qtyRejected, 0), qtyVariance: po ? po.lines.reduce((a, l) => a + (l.qtyReceived - l.qty), 0) : 0 }; }),
        payments: db.paymentRequests.map((p) => ({ ...p, fundingSource: p.fundingSource ?? (p.type === 'PCV' ? 'Petty Cash Fund' : 'Disbursement (check / bank transfer)'), ...wfInfo(p.workflowId) })),
        vendorInvoices: db.vendorInvoices.map((i) => { const t = db.pos.some((p) => p.poNo === i.poNo) ? api.procurement.tally(i.poNo) : undefined; const rr = db.rrs.some((r) => r.poNo === i.poNo); const matchStatus = !t ? 'No PO' : t.matched ? 'Matched' : !rr ? 'No RR yet' : 'Variance'; return { ...i, matchStatus, paymentHeld: matchStatus !== 'Matched' && i.status !== 'Rejected' }; }),
        vendors: db.vendors,
        lowStock: db.stock.filter((s) => s.qtyOnHand <= (db.parts.find((p) => p.partCode === s.partCode)?.lowStockThreshold ?? 0)).map((s) => ({ ...s, ref: `Low stock · ${s.partCode} @ ${s.warehouseCode}` })),
        stockRequests: db.stockTxns.filter((t) => t.type === 'Request').map((t) => ({ txnNo: t.txnNo, partCode: t.partCode, qty: t.qty, warehouseCode: t.fromWarehouse })),
        openJos: db.jobOrders.filter((j) => !j.status.startsWith('Closed')).map((j) => ({ joNo: j.joNo, chassisNo: j.chassisNo, status: j.status })),
      }));
    },
    /** Petty cash fund check (BR-10): float (configurable, pending) less PCVs submitted, approved or paid this month for the entity. */
    pettyCash(entityCode: string) {
      const float = Number(S()['fin.pcv_fund_float'] ?? 20000); const m = nowIso().slice(0, 7);
      const used = db.paymentRequests.filter((p) => p.type === 'PCV' && p.entityCode === entityCode && p.status !== 'Rejected' && p.createdAt.slice(0, 7) === m).reduce((a, p) => a + p.amount, 0);
      return { float, used, available: Math.max(0, float - used) };
    },
    async createPr(input: { department: string; justification: string; entityCode: string; sourceJo?: string; lines: { partCode: string; description: string; qty: number; estUnitCost: number; uom?: string; standardCost?: number; priceOverride?: boolean; supplierId?: string }[]; supplierId?: string; neededBy?: string; priority?: 'Normal' | 'Urgent' | 'Critical'; deliveryWarehouse?: string; stockRef?: string; attachments?: string[]; draft?: boolean; prNo?: string }) {
      requirePerm('prc.pr', 'add');
      await delay();
      const { draft, prNo: existing, ...rest } = input;
      if (!draft) {
        if (!input.lines.length) throw new ApiError('VALIDATION_FAILED', 'Add at least one item.', 422);
        if (!input.entityCode) throw new ApiError('VALIDATION_FAILED', 'Entity is required.', 422, { entityCode: 'Required' });
        if (!input.justification.trim()) throw new ApiError('VALIDATION_FAILED', 'Justification is required.', 422, { justification: 'Required' });
        if (input.lines.some((l) => !l.partCode || !(l.qty > 0))) throw new ApiError('VALIDATION_FAILED', 'Every line needs an item and a quantity greater than zero.', 422, { qty: 'Must be > 0' });
      }
      const old = existing ? db.prs.find((p) => p.prNo === existing && p.status === 'Draft') : undefined;
      const prNo = old?.prNo ?? nextNo('PR', 'PR-', 6);
      if (old) db.prs.splice(db.prs.indexOf(old), 1);
      if (draft) { db.prs.unshift({ prNo, requestedBy: me().userId, status: 'Draft', createdAt: old?.createdAt ?? nowIso(), ...rest }); audit('pr.draft_saved', 'pr', prNo); persist(); return prNo; }
      const total = input.lines.reduce((a, l) => a + l.qty * l.estUnitCost, 0);
      const tier = poApprovalTier(total, Number(S()['prc.po_tier_threshold'] ?? 250000));
      // Routing gates come from System settings (prc.pr_routing), then the amount-based final approval (BR-09).
      const GATE_LABELS: Record<string, string> = { DEPT_HEAD: 'Department Head', APS_MANAGER: 'Admin Department', APS_OFFICER: 'APS processing' };
      const gates = String(S()['prc.pr_routing'] ?? 'DEPT_HEAD>APS_MANAGER>APS_OFFICER').split('>').filter((g) => GATE_LABELS[g]);
      const wf = startWorkflow('PR_PO', `Purchase request ${prNo}`, 'pr', prNo, [
        ...gates.map((g) => ({ label: GATE_LABELS[g], roles: [g as RoleCode] })),
        { label: `Final approval — ${tier.tier}`, roles: [...tier.roles] as RoleCode[] },
      ], total);
      db.prs.unshift({ prNo, requestedBy: me().userId, status: 'For Approval', workflowId: wf.id, createdAt: old?.createdAt ?? nowIso(), ...rest });
      notify('prc.approval_needed', `PR ${prNo} for approval`, `₱${total.toLocaleString('en-PH')} · ${input.justification}`, { link: '/approvals' });
      persist(); return prNo;
    },
    async convertToPo(prNo: string, vendorId: string, terms: string, deliveryDate: string, prices: Record<string, number>) {
      requirePerm('prc.po', 'add');
      return tx(() => {
        const pr = db.prs.find((p) => p.prNo === prNo)!;
        if (pr.status !== 'Approved') throw new ApiError('INVALID_STATE', 'Only approved PRs can be converted to a PO.', 409);
        // BR-09: the PO may not exceed the gate of the approver who signed the PR.
        const threshold = Number(S()['prc.po_tier_threshold'] ?? 250000);
        const prTotal = pr.lines.reduce((a, l) => a + l.qty * l.estUnitCost, 0), poTotal = pr.lines.reduce((a, l) => a + l.qty * (prices[l.partCode] ?? l.estUnitCost), 0);
        if (prTotal <= threshold && poTotal > threshold) throw new ApiError('APPROVER_GATE_EXCEEDED', `Amount exceeds approver's gate: PO total ₱${poTotal.toLocaleString('en-PH')} is above the APS/MMG Manager gate of ₱${threshold.toLocaleString('en-PH')}. Re-route the PR to CEO + CHRO.`, 409);
        const poNo = nextNo('PO', 'PO-', 6);
        db.pos.unshift({ poNo, prNo, vendorId, terms, deliveryDate, entityCode: pr.entityCode, status: 'Issued', createdAt: nowIso(), lines: pr.lines.map((l) => ({ partCode: l.partCode, description: l.description, qty: l.qty, unitPrice: prices[l.partCode] ?? l.estUnitCost, qtyReceived: 0 })) });
        pr.status = 'Converted'; pr.poNo = poNo; audit('po.issued', 'po', poNo, { prNo, vendorId }); return poNo;
      });
    },
    async receive(poNo: string, lines: { partCode: string; qtyReceived: number; qtyRejected: number; condition: string }[], warehouseCode: string, notes?: string) {
      requirePerm('prc.rr', 'add');
      await delay();
      const po = db.pos.find((p) => p.poNo === poNo)!;
      const rrNo = nextNo('RR', 'RR-', 6);
      let discrepancy = false;
      for (const l of lines) {
        const pl = po.lines.find((x) => x.partCode === l.partCode)!;
        pl.qtyReceived += l.qtyReceived;
        if (l.qtyRejected > 0 || pl.qtyReceived !== pl.qty) discrepancy = true;
        if (l.qtyReceived > 0) {
          let b = db.stock.find((s) => s.partCode === l.partCode && s.warehouseCode === warehouseCode); if (!b) { b = { partCode: l.partCode, warehouseCode, qtyOnHand: 0 }; db.stock.push(b); }
          b.qtyOnHand += l.qtyReceived;
          db.stockTxns.unshift({ id: uid(), txnNo: nextNo('STK', 'STK-', 6), type: 'Receive', partCode: l.partCode, qty: l.qtyReceived, fromWarehouse: warehouseCode, referenceType: 'RR', referenceId: rrNo, balanceAfter: b.qtyOnHand, entityCode: po.entityCode, at: nowIso(), by: me().userId });
        }
      }
      const all = po.lines.every((l) => l.qtyReceived >= l.qty);
      po.status = discrepancy && !all ? 'On Hold' : all ? 'Received' : 'Partially Received';
      db.rrs.unshift({ rrNo, poNo, receivedDate: nowIso().slice(0, 10), receivedBy: me().userId, warehouseCode, lines, conditionNotes: notes, discrepancy });
      audit('rr.created', 'po', poNo, { rrNo, discrepancy }); persist();
      return { rrNo, discrepancy, poStatus: po.status };
    },
    tally(poNo: string) {
      const po = db.pos.find((p) => p.poNo === poNo)!;
      const inv = db.vendorInvoices.filter((i) => i.poNo === poNo && i.status !== 'Rejected').reduce((a, i) => a + i.amount, 0);
      const ordered = po.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0), received = po.lines.reduce((a, l) => a + l.qtyReceived * l.unitPrice, 0);
      return { lines: po.lines, ordered, received, invoiced: inv, matched: Math.abs(received - inv) < 1 && received > 0 && po.lines.every((l) => l.qtyReceived === l.qty) };
    },
    async createPayment(input: { referenceType: 'PO' | 'RR' | 'Justification'; referenceId: string; payee: string; amount: number; dueDate: string; entityCode: string; justification?: string; department?: string; attachments?: string[]; lines?: { description: string; category: string; amount: number; poNo?: string; partCode?: string }[] }) {
      requirePerm('prc.payment', 'add');
      await delay();
      if (!input.payee.trim()) throw new ApiError('VALIDATION_FAILED', 'Payee is required.', 422, { payee: 'Required' });
      if (input.lines?.length && input.lines.some((l) => !l.description.trim() || !l.category || !(l.amount > 0))) throw new ApiError('VALIDATION_FAILED', 'Each particular needs a description, an expense category and an amount above zero.', 422, { lines: 'Incomplete' });
      if (!(input.amount > 0)) throw new ApiError('VALIDATION_FAILED', 'Amount must be greater than zero.', 422, { amount: 'Must be > 0' });
      if (input.referenceType === 'Justification' && !input.justification?.trim()) throw new ApiError('VALIDATION_FAILED', 'Justification is required for a non-PO payment.', 422, { justification: 'Required' });
      const type = paymentRequestType(input.amount, Number(S()['fin.pcv_max'] ?? 4000));
      const pos = input.referenceType === 'PO' ? [...new Set([...(input.lines ?? []).map((l) => l.poNo).filter(Boolean) as string[], ...input.referenceId.split(',').map((x) => x.trim()).filter((x) => x && x !== '-')])] : [];
      if (input.referenceType === 'PO' && !pos.length) throw new ApiError('VALIDATION_FAILED', 'Select the PO(s) this payment is for.', 422, { referenceId: 'Required' });
      const unmatched = pos.filter((p) => !db.pos.some((x) => x.poNo === p) || !api.procurement.tally(p).matched);
      if (type === 'RFP' && unmatched.length) throw new ApiError('THREE_WAY_MISMATCH', `PO not matched: ${unmatched.join(', ')} — PO, receiving report and vendor invoice do not match yet (PO Tally). Resolve the variance first.`, 409);
      if (type === 'PCV') { const f = api.procurement.pettyCash(input.entityCode); if (input.amount > f.available) throw new ApiError('INSUFFICIENT_FUND', `Insufficient petty cash fund: ₱${f.available.toLocaleString('en-PH')} available of ₱${f.float.toLocaleString('en-PH')}. Replenish the fund or route as RFP.`, 409, { amount: 'Exceeds fund balance' }); }
      const docNo = nextNo(type, `${type}-`, 6);
      const wf = startWorkflow('PAYMENT_REQUEST', `${type} ${docNo} — ${input.payee}`, 'payment', docNo, type === 'RFP'
        ? [{ label: 'Department Head', roles: ['DEPT_HEAD'] }, { label: 'Accounting', roles: ['ACCOUNTING'] }]
        : [{ label: 'Department Head', roles: ['DEPT_HEAD'] }], input.amount);
      db.paymentRequests.unshift({ docNo, type, status: 'For Approval', workflowId: wf.id, createdAt: nowIso(), ...input, referenceId: pos.length ? pos.join(', ') : input.referenceId, requestedBy: me().userId, fundingSource: type === 'PCV' ? 'Petty Cash Fund' : 'Disbursement (check / bank transfer)' });
      audit('payment.submitted', 'payment', docNo, { type, amount: input.amount, pos }); persist(); return { docNo, type, workflowId: wf.id };
    },
    async markPaid(docNo: string) { return tx(() => { const p = db.paymentRequests.find((x) => x.docNo === docNo)!; if (p.status !== 'Approved') { const w = db.workflows.find((x) => x.id === p.workflowId); throw new ApiError('INVALID_STATE', w?.steps[w.currentStep]?.label === 'Department Head' ? 'Missing department-head approval — cannot release payment.' : 'Only approved requests can be marked paid.', 409); } p.status = 'Paid'; audit('payment.paid', 'payment', docNo); return p; }); },
    async setInvoiceStatus(id: string, status: 'Under Review' | 'Approved' | 'Rejected' | 'Paid') { requirePerm('prc.payment', 'edit'); return tx(() => { const v = db.vendorInvoices.find((x) => x.id === id)!; if ((status === 'Approved' || status === 'Paid') && !(db.pos.some((p) => p.poNo === v.poNo) && api.procurement.tally(v.poNo).matched)) throw new ApiError('THREE_WAY_MISMATCH', 'Payment held: the PO · receiving report · invoice three-way match has not passed yet (DBL-PRC-002).', 409); v.status = status; audit('vendor_invoice.status', 'vendor_invoice', id, { status }); return v; }); },
  },

  // ── Vendor portal (scoped to the signed-in vendor) ──────────────────────
  vendorPortal: {
    async data() {
      const u = me(); if (u.realm !== 'VENDOR_PORTAL') throw new ApiError('FORBIDDEN', 'Vendor access only.', 403);
      return tx(() => ({ vendor: db.vendors.find((v) => v.vendorId === u.vendorId), pos: db.pos.filter((p) => p.vendorId === u.vendorId).map((p) => ({ ...p, total: p.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) })), invoices: db.vendorInvoices.filter((i) => i.vendorId === u.vendorId) }));
    },
    async uploadInvoice(input: { poNo: string; invoiceNo: string; invoiceDate: string; amount: number; fileName: string }) {
      const u = me(); if (u.realm !== 'VENDOR_PORTAL') throw new ApiError('FORBIDDEN', 'Vendor access only.', 403);
      return tx(() => {
        const po = db.pos.find((p) => p.poNo === input.poNo && p.vendorId === u.vendorId);
        if (!po) { audit('security.vendor_scope_violation', 'po', input.poNo); throw new ApiError('NOT_FOUND', 'PO not found.', 404); }
        const inv = { id: uid(), vendorId: u.vendorId!, status: 'Submitted' as const, submittedVia: 'Portal' as const, submittedAt: nowIso(), ...input };
        db.vendorInvoices.unshift(inv); audit('vendor_invoice.submitted', 'vendor_invoice', inv.id, inv); return inv;
      });
    },
  },

  // ── Billing & finance (M10) ─────────────────────────────────────────────
  billing: {
    // SCR-35 filters (DBL-FIN-005): client, chassis (searches the lines), bill type, branch, invoice-date range, status (incl. Held / Credited / Cancelled).
    async invoices(f: { client?: string; status?: string; q?: string; chassis?: string; billType?: string; branch?: string; from?: string; to?: string } = {}) {
      const u = me();
      if (u.realm === 'INTERNAL') requirePerm('fin.invoice');
      const holdDays = Number(S()['cnc.hold_threshold_days'] ?? 30);
      return tx(() => db.invoices.filter((i) => (u.realm === 'CLIENT_PORTAL' ? i.clientCode === u.clientCode && i.status !== 'Draft' : true))
        .map((i) => {
          const payment = paymentStatus(i), dOver = daysOverdue(i);
          return { ...i, clientName: clientName(i.clientCode), payment, balance: balance(i), daysOverdue: dOver, invoiceDate: invoiceDateOf(i), creditTermDays: creditTermOf(i), branchName: db.branches.find((b) => b.code === i.branchCode)?.name ?? i.branchCode,
            daysToHold: payment === 'Overdue' ? holdDays - dOver : undefined, hasHeld: i.lines.some((l) => l.held), pendingClearance: pendingClearanceOf(i.invoiceNo) };
        })
        .filter((i) => (!f.client || i.clientCode === f.client)
          && (!f.status || (f.status === 'Held' ? i.hasHeld : i.payment === f.status || i.status === f.status))
          && (!f.chassis || i.lines.some((l) => (l.chassisNo ?? '').toLowerCase().includes(f.chassis!.toLowerCase())))
          && (!f.billType || i.billType === f.billType) && (!f.branch || i.branchCode === f.branch)
          && (!f.from || i.invoiceDate >= f.from) && (!f.to || i.invoiceDate <= f.to)
          && (!f.q || `${i.invoiceNo} ${i.clientName}`.toLowerCase().includes(f.q.toLowerCase()))));
    },
    async invoice(no: string) {
      return tx(() => { const i = db.invoices.find((x) => x.invoiceNo === no); if (!i) throw new ApiError('NOT_FOUND', 'Invoice not found', 404); const u = me(); if (u.realm === 'CLIENT_PORTAL' && i.clientCode !== u.clientCode) throw new ApiError('NOT_FOUND', 'Invoice not found', 404);
        return { ...i, client: clientOf(i.clientCode), contract: db.contracts.find((c) => c.contractNo === i.contractNo), payment: paymentStatus(i), balance: balance(i), invoiceDate: invoiceDateOf(i), creditTermDays: creditTermOf(i),
          branchName: db.branches.find((b) => b.code === i.branchCode)?.name ?? i.branchCode, pendingClearance: pendingClearanceOf(no), clientCredit: clientCreditOf(i.clientCode),
          receipts: db.receipts.filter((r) => r.applications.some((a) => a.invoiceNo === no)).map((r) => ({ ...r, status: receiptStatusOf(r) })),
          memos: db.memos.filter((m) => m.referenceInvoiceNo === no || m.appliedTo === no),
          history: [...(i.history ?? [])].map((h) => ({ ...h, byName: billingUser(h.by) })),
          audit: u.realm === 'INTERNAL' ? db.audit.filter((a) => a.entityType === 'invoice' && a.entityId === no).map((a) => ({ ...a, byName: billingUser(a.actor) })) : [] }; });
    },
    /** DBL-FIN-006: resend the invoice copy (Billing Completion email) and log who / when. */
    async resendInvoice(no: string, to?: string) {
      requirePerm('fin.invoice', 'edit');
      return tx(() => {
        const i = db.invoices.find((x) => x.invoiceNo === no); if (!i) throw new ApiError('NOT_FOUND', 'Invoice not found', 404);
        if (i.status === 'Cancelled') throw new ApiError('INVALID_STATE', 'A cancelled invoice cannot be sent.', 409);
        const c = clientOf(i.clientCode); const addr = (to ?? c?.ebillingEmail ?? '').trim();
        if (!addr) throw new ApiError('VALIDATION_FAILED', 'Client has no e-billing email on file.', 422, { to: 'Required' });
        i.sentTo = addr; i.sentAt = nowIso(); (i.history ??= []).push({ at: i.sentAt, by: me().userId, action: 'Resent', note: `Invoice copy emailed to ${addr}` });
        notify('billing.completed', `Invoice ${no} re-sent`, `${c?.clientName} · copy emailed to ${addr}`, { clientCode: i.clientCode, aeUserId: c?.aeAssigned, link: `/billing/invoices/${no}` });
        audit('invoice.resent', 'invoice', no, { sentTo: addr }); return i.sentAt;
      });
    },
    /** Print / reprint log (same pattern as the EIR): first print is the original; later prints are watermarked REPRINT #n. */
    async logInvoicePrint(no: string, copy: string) {
      return tx(() => {
        const i = db.invoices.find((x) => x.invoiceNo === no); if (!i) throw new ApiError('NOT_FOUND', 'Invoice not found', 404);
        const n = i.printCount ?? 0; i.printCount = n + 1;
        if (n > 0) { (i.history ??= []).push({ at: nowIso(), by: session()?.userId ?? 'system', action: `Reprinted #${n}`, note: copy }); audit('invoice.reprinted', 'invoice', no, { reprint: n, copy }); }
        return n;
      });
    },
    async preview(input: { cycle: 'Weekly' | 'Monthly'; periodStart: string; periodEnd: string; branch?: string }) {
      requirePerm('fin.billing', 'add');
      return tx(() => {
        // Period boundaries are Manila calendar days (the old local-time parse could add an 8th day to a 7-day period).
        const ps = `${input.periodStart}T00:00:00+08:00`, pe = `${input.periodEnd}T23:59:59+08:00`;
        const inPeriod = (iso?: string) => !!iso && new Date(iso) >= new Date(ps) && new Date(iso) <= new Date(pe);
        const vatPct = Number(S()['fin.vat_pct'] ?? 0.12);
        const exceptions: string[] = [];
        const drafts = db.clients.filter((c) => c.billingCycle === input.cycle && (!input.branch || c.branchCode === input.branch)).map((c) => {
          const lines: Invoice['lines'] = [];
          for (const out of db.gatePasses.filter((g) => g.direction === 'OUT' && g.clientCode === c.clientCode)) {
            const inn = out.pairedGatePassNo ? db.gatePasses.find((g) => g.gatePassNo === out.pairedGatePassNo) : undefined;
            const days = billableDays(out.actualEventAt, inn?.actualEventAt, input.periodStart, input.periodEnd);
            if (days <= 0) continue;
            const ch = db.chassis.find((x) => x.chassisNo === out.chassisNo);
            const ct = db.contracts.find((x) => x.contractNo === out.contractNo);
            const rate = ct?.rates.find((r) => r.equipmentType === ch?.chassisType)?.dailyRate;
            if (rate == null) { exceptions.push(`${c.clientName}: missing rate for ${ch?.chassisType} on contract ${out.contractNo}`); continue; }
            const les = db.lateEncodings.filter((l) => l.gatePassNo === out.gatePassNo || l.gatePassNo === inn?.gatePassNo);
            const pending = les.find((l) => l.status === 'Pending Approval'), auto = les.find((l) => l.path === 'AUTO' || l.status === 'Approved');
            const heldMemo = pending ? db.memos.find((m) => m.workflowId && m.workflowId === pending.workflowId)?.memoNo : undefined;
            lines.push({ id: `L-${out.gatePassNo}`, lineType: 'Lease', description: `Chassis lease — ${db.equipmentTypes.find((e) => e.code === ch?.chassisType)?.name}`, equipmentType: ch?.chassisType, chassisNo: out.chassisNo, from: out.actualEventAt, to: inn?.actualEventAt, days, rate, rateType: 'Daily — contract snapshot', amount: round2(days * rate),
              held: !!pending, heldMemoNo: heldMemo, lateDays: (pending ?? auto)?.daysLate, recalculated: !pending && !!auto });
            for (const l of inn?.inspection ?? []) if (l.chargeable > 0 && inn && inPeriod(inn.actualEventAt)) lines.push({ id: `D-${inn.gatePassNo}-${l.part}`, lineType: 'Damage', description: `Damage — ${l.part} (EIR ${inn.eirNo})`, chassisNo: out.chassisNo, rateType: 'Fixed — EIR chargeable', amount: l.chargeable });
          }
          for (const p of db.parkFix.filter((x) => x.clientCode === c.clientCode && x.status === 'Released' && inPeriod(x.parkOutAt))) {
            const d = Math.max(1, Math.ceil((new Date(p.parkOutAt!).getTime() - new Date(p.parkInAt).getTime()) / 86400000));
            lines.push({ id: `P-${p.id}`, lineType: 'Park & Fix', description: `Park & Fix ${p.chassisNo}`, chassisNo: p.chassisNo, from: p.parkInAt, to: p.parkOutAt, days: d, rate: p.dailyRate, rateType: 'Daily — Park & Fix rate', amount: round2(d * p.dailyRate) });
          }
          const billable = lines.filter((l) => !l.held).map((l) => l.amount);
          const ct = db.contracts.find((x) => x.clientCode === c.clientCode && x.status === 'Active');
          const term = ct?.creditTermDays ?? 30;
          const conflict = db.invoices.find((i) => i.clientCode === c.clientCode && i.billType === 'Lease' && i.status !== 'Cancelled' && i.periodStart <= input.periodEnd && i.periodEnd >= input.periodStart);
          return { clientCode: c.clientCode, clientName: c.clientName, clientStatus: c.status, branchCode: c.branchCode, contractNo: ct?.contractNo, creditTermDays: term, billingCycle: c.billingCycle, ebillingEmail: c.ebillingEmail,
            ...invoiceDates(input.periodEnd, term), conflictInvoiceNo: conflict?.invoiceNo, lines, ...invoiceTotals(billable, vatPct) };
        }).filter((d) => d.lines.length);
        const batchNo = `BB-${input.periodEnd.replace(/-/g, '')}-${input.cycle === 'Monthly' ? 'M' : 'W'}${input.branch || 'ALL'} (proposed)`;
        return { drafts, exceptions, batchNo, periodDays: periodDays(input.periodStart, input.periodEnd) };
      });
    },
    async finalize(input: { cycle: 'Weekly' | 'Monthly'; periodStart: string; periodEnd: string; branch?: string; clients?: string[];
      adjustments: Record<string, { type?: string; amount: number; reason: string; evidence?: string }[]>; corrections?: Record<string, { days: number; rate: number; reason: string }> }) {
      requirePerm('fin.billing', 'approve');
      const pv = await api.billing.preview(input);
      if (pv.exceptions.length) throw new ApiError('VALIDATION_FAILED', `Cannot finalize — ${pv.exceptions.length} line(s) have missing contract rates.`, 422);
      const picked = pv.drafts.filter((d) => !input.clients || input.clients.includes(d.clientCode));
      if (!picked.length) throw new ApiError('VALIDATION_FAILED', 'Select at least one draft invoice to finalize.', 422);
      const clash = picked.find((d) => d.conflictInvoiceNo);
      if (clash) throw new ApiError('BILLING_BATCH_CONFLICT', `Billing batch conflict: ${clash.clientName} is already billed for an overlapping period on ${clash.conflictInvoiceNo}. Discard that draft or cancel the earlier invoice first.`, 409);
      await delay(300);
      const thresh = Number(S()['fin.adjustment_approval_threshold'] ?? 5000);
      const batchNo = nextNo('BB', `BB-${input.periodEnd.replace(/-/g, '')}-`, 3);
      const created: string[] = []; const by = me().userId; const at = nowIso();
      for (const d of picked) {
        const adj = input.adjustments[d.clientCode] ?? [];
        if (adj.some((a) => !a.reason.trim())) throw new ApiError('VALIDATION_FAILED', 'Every adjustment needs a reason.', 422);
        if (adj.some((a) => !a.amount)) throw new ApiError('VALIDATION_FAILED', 'Every adjustment needs a non-zero amount.', 422);
        if (adj.some((a) => Math.abs(a.amount) > thresh)) requirePerm('fin.billing', 'approve');
        const lines: Invoice['lines'] = d.lines.map((l) => {
          const cx = input.corrections?.[l.id]; if (!cx) return l;
          if (!cx.reason.trim()) throw new ApiError('VALIDATION_FAILED', `Correction on ${l.chassisNo ?? l.description} needs a reason.`, 422);
          if (cx.days < 0 || cx.days > pv.periodDays) throw new ApiError('VALIDATION_FAILED', `Billed days for ${l.chassisNo} must be between 0 and ${pv.periodDays} (the period length).`, 422);
          if (cx.rate < 0) throw new ApiError('VALIDATION_FAILED', 'Rate cannot be negative.', 422);
          return { ...l, days: cx.days, rate: cx.rate, amount: round2(cx.days * cx.rate), originalDays: l.days, originalRate: l.rate, reason: cx.reason, by, at, rateType: cx.rate !== l.rate ? 'Daily — corrected' : l.rateType };
        });
        lines.push(...adj.map((a) => ({ id: uid(), lineType: (a.type === 'Special billing' ? 'Special' : a.type === 'Late fee' ? 'Penalty' : 'Adjustment') as InvoiceLine['lineType'], description: `${a.type ?? 'Adjustment'} — ${a.reason}`, rateType: 'Fixed — adjustment', amount: a.amount, adjType: a.type, reason: a.reason, evidence: a.evidence, by, at })));
        const totals = invoiceTotals(lines.filter((l) => !l.held).map((l) => l.amount), Number(S()['fin.vat_pct'] ?? 0.12));
        const c = mustClient(d.clientCode);
        const no = nextNo('INV', `INV-${c.branchCode}-`, 8);
        db.invoices.unshift({ invoiceNo: no, clientCode: c.clientCode, contractNo: d.contractNo, periodStart: input.periodStart, periodEnd: input.periodEnd, billType: 'Lease', lines, ...totals, amountPaid: 0,
          dueDate: d.dueDate, invoiceDate: d.invoiceDate, creditTermDays: d.creditTermDays, billingCycle: c.billingCycle, batchNo, status: 'Sent', issuedAt: at, branchCode: c.branchCode, printCount: 0,
          sentTo: c.ebillingEmail, sentAt: at, heldReason: lines.some((l) => l.held) ? `Some lines held pending late-encoding CM approval (BR-05)${lines.find((l) => l.heldMemoNo)?.heldMemoNo ? ` — ${lines.find((l) => l.heldMemoNo)?.heldMemoNo}` : ''}` : undefined,
          history: [{ at, by, action: 'Finalized', note: `Batch ${batchNo}` }, { at, by: 'system', action: 'Sent', note: `Billing Completion email with invoice copy to ${c.ebillingEmail ?? '(no e-billing email)'}` }] });
        lines.filter((l) => l.originalDays != null).forEach((l) => audit('invoice.line.corrected', 'invoice', no, { chassisNo: l.chassisNo, days: l.days, rate: l.rate }, l.reason, { days: l.originalDays, rate: l.originalRate }));
        adj.forEach((a) => audit('invoice.adjustment.added', 'invoice', no, a, a.reason));
        notify('billing.completed', `Invoice ${no} issued`, `${c.clientName} · ₱${totals.total.toLocaleString('en-PH')}`, { clientCode: c.clientCode, aeUserId: c.aeAssigned, link: `/billing/invoices/${no}` });
        audit('invoice.finalized', 'invoice', no, { ...totals, batchNo });
        created.push(no);
      }
      persist();
      return { batchNo, invoices: created };
    },
    // ── SCR-36 receipts: Provisional Receipt first; Treasury confirms clearance → Official Receipt (DBL-FIN-012/013) ──
    async receipt(input: { type: 'PR' | 'NVAR'; clientCode: string; amount: number; method: string; reference?: string; checkNo?: string; bank?: string; checkDate?: string; date: string; notes?: string; applications: { invoiceNo: string; amount: number }[] }) {
      requirePerm('fin.receipt', 'add');
      await delay();
      const f: Record<string, string> = {};
      if (!input.clientCode) f.clientCode = 'Required';
      if (!input.date) f.date = 'Required';
      if (!(input.amount > 0)) f.amount = 'Must be greater than zero';
      if (input.method === 'Check') { if (!input.checkNo?.trim()) f.checkNo = 'Required for checks'; if (!input.bank?.trim()) f.bank = 'Required for checks'; if (!input.checkDate) f.checkDate = 'Required for checks'; }
      if (['Bank Transfer', 'Online', 'E-Wallet'].includes(input.method) && !input.reference?.trim()) f.reference = 'Reference required';
      if (Object.keys(f).length) throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', 422, f);
      const apps = input.applications.filter((a) => a.amount > 0);
      const applied = round2(apps.reduce((a, x) => a + x.amount, 0));
      if (applied > input.amount + 0.001) throw new ApiError('OVER_APPLIED', `Over-applied: ₱${applied.toLocaleString('en-PH')} applied but only ₱${input.amount.toLocaleString('en-PH')} received.`, 422);
      for (const a of apps) {
        const i = db.invoices.find((x) => x.invoiceNo === a.invoiceNo);
        if (!i || i.clientCode !== input.clientCode) throw new ApiError('VALIDATION_FAILED', `${a.invoiceNo} is not an open invoice of this client.`, 422);
        const open = round2(balance(i) - pendingClearanceOf(i.invoiceNo));
        if (a.amount > open + 0.001) throw new ApiError('EXCEEDS_BALANCE', `Amount exceeds the open balance of ${a.invoiceNo} (₱${open.toLocaleString('en-PH')} after receipts awaiting clearance).`, 422);
      }
      const c = mustClient(input.clientCode);
      const no = nextNo('OR', `${input.type}-${c.branchCode}-`, 8);
      const pdc = input.method === 'Check' && !!input.checkDate && input.checkDate > input.date;
      const reference = input.reference || (input.method === 'Check' ? `${input.bank ?? ''} ${input.checkNo ?? ''}`.trim() : undefined);
      db.receipts.unshift({ receiptNo: no, ...input, reference, applications: apps, unapplied: round2(input.amount - applied), by: me().userId, status: 'Provisional', pdc, depositStatus: input.method === 'Check' ? 'Not deposited' : undefined, tin: c.tin, createdAt: nowIso(),
        history: [{ at: nowIso(), by: me().userId, action: `${input.type === 'NVAR' ? 'NVAR' : 'PR'} recorded`, note: 'Awaiting Treasury clearance' }] });
      const treasury = db.users.filter((x) => x.realm === 'INTERNAL' && x.roles.includes('TREASURY')).map((x) => x.userId);
      notify('workflow.task', `Clearance needed: ${no}`, `${c.clientName} · ₱${input.amount.toLocaleString('en-PH')} · ${input.method}${pdc ? ` (PDC dated ${input.checkDate})` : ''}`, { link: `/billing/receipts?receipt=${no}`, extraUsers: treasury });
      audit('receipt.provisional', 'receipt', no, input); persist();
      return no;
    },
    async confirmClearance(receiptNo: string, input: { clearedAt: string; clearedAmount: number; tin?: string }) {
      requirePerm('fin.receipt', 'approve');
      await delay();
      const r = db.receipts.find((x) => x.receiptNo === receiptNo); if (!r) throw new ApiError('NOT_FOUND', 'Receipt not found', 404);
      if (receiptStatusOf(r) !== 'Provisional') throw new ApiError('INVALID_STATE', `${receiptNo} is ${receiptStatusOf(r)} — only a Provisional Receipt can be cleared.`, 409);
      if (r.by === me().userId) throw new ApiError('APPROVAL_SOD_VIOLATION', 'Clearance must be confirmed by Treasury, not by the user who recorded the PR (segregation of duties).', 409);
      if (!input.clearedAt) throw new ApiError('VALIDATION_FAILED', 'Bank clearance date is required.', 422, { clearedAt: 'Required' });
      if (r.checkDate && input.clearedAt < r.checkDate) throw new ApiError('VALIDATION_FAILED', `Post-dated check cannot clear before its check date (${r.checkDate}).`, 422, { clearedAt: 'Before check date' });
      if (Math.abs(round2(input.clearedAmount) - r.amount) > 0.005) throw new ApiError('PR_OR_MISMATCH', `PR / OR mismatch: the bank cleared ₱${input.clearedAmount.toLocaleString('en-PH')} but ${receiptNo} is for ₱${r.amount.toLocaleString('en-PH')}. Cancel and re-issue the PR, or record the bank adjustment first.`, 409, { clearedAmount: 'Does not match the PR' });
      for (const a of r.applications) { const i = db.invoices.find((x) => x.invoiceNo === a.invoiceNo)!; if (a.amount > balance(i) + 0.001) throw new ApiError('EXCEEDS_BALANCE', `Application to ${a.invoiceNo} now exceeds its balance (₱${balance(i).toLocaleString('en-PH')}).`, 409); }
      const c = mustClient(r.clientCode);
      r.applications.forEach((a) => { const i = db.invoices.find((x) => x.invoiceNo === a.invoiceNo)!; i.amountPaid = round2(i.amountPaid + a.amount); (i.history ??= []).push({ at: nowIso(), by: me().userId, action: 'Payment posted', note: `${receiptNo} · ₱${a.amount.toLocaleString('en-PH')}` }); });
      r.orNo = nextNo('OR', `${r.type === 'NVAR' ? 'NVAR' : 'OR'}-${c.branchCode}-`, 8); r.prNo = receiptNo;
      if (r.type !== 'NVAR') r.type = 'OR';
      r.status = 'OR Issued'; r.clearedAt = input.clearedAt; r.clearedBy = me().userId; r.tin = input.tin || r.tin || c.tin; if (r.method === 'Check') r.depositStatus = 'Cleared';
      (r.history ??= []).push({ at: nowIso(), by: me().userId, action: `Clearance confirmed — ${r.orNo} issued`, note: `Cleared ${input.clearedAt}` });
      notify('payment.applied', `Payment posted: ${c.clientName}`, `${r.orNo} (from ${receiptNo}) · ₱${r.amount.toLocaleString('en-PH')}`, { clientCode: c.clientCode, aeUserId: c.aeAssigned });
      audit('receipt.cleared', 'receipt', receiptNo, { orNo: r.orNo, clearedAt: input.clearedAt }); persist();
      return r.orNo;
    },
    async markDeposited(receiptNo: string) {
      requirePerm('fin.receipt', 'edit');
      return tx(() => { const r = db.receipts.find((x) => x.receiptNo === receiptNo)!; if (receiptStatusOf(r) !== 'Provisional') throw new ApiError('INVALID_STATE', 'Only a Provisional Receipt can be marked deposited.', 409);
        r.depositStatus = 'Deposited'; (r.history ??= []).push({ at: nowIso(), by: me().userId, action: 'Check deposited' }); audit('receipt.deposited', 'receipt', receiptNo); return r.depositStatus; });
    },
    /** Bounced / dishonoured check: PR closed, invoices stay open, contract dishonoured-check penalty raised as a Debit Memo for approval. */
    async bounceReceipt(receiptNo: string, reason: string) {
      requirePerm('fin.receipt', 'approve');
      await delay();
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'Reason is required.', 422, { reason: 'Required' });
      const r = db.receipts.find((x) => x.receiptNo === receiptNo); if (!r) throw new ApiError('NOT_FOUND', 'Receipt not found', 404);
      if (r.method !== 'Check' || receiptStatusOf(r) !== 'Provisional') throw new ApiError('INVALID_STATE', 'Only a Provisional check receipt can be marked bounced.', 409);
      const c = mustClient(r.clientCode);
      const penalty = db.contracts.find((x) => x.clientCode === r.clientCode && x.status === 'Active')?.penalties.dishonoredCheck ?? 2500;
      const memoNo = nextNo('DM', 'DM-', 6);
      const chain = memoApprovalChain('Debit', 'Dishonoured check penalty');
      db.memos.unshift({ memoNo, type: 'Debit', clientCode: r.clientCode, referenceInvoiceNo: r.applications[0]?.invoiceNo, referenceType: 'Receipt', referenceId: receiptNo, amount: penalty, reason: `Dishonoured check ${r.bank ?? ''} ${r.checkNo ?? ''} — ${reason}`.trim(), category: 'Dishonoured check penalty',
        status: 'Pending Approval', createdAt: nowIso(), createdBy: me().userId, source: 'Auto', evidence: [], approvalChain: chain.map((s) => s.label) });
      const wf = startWorkflow('MEMO', `Debit memo ${memoNo} — ${c.clientName} (dishonoured check)`, 'memo', memoNo, chain.map((s) => ({ label: s.label, roles: [...s.roles] as RoleCode[] })), penalty);
      db.memos[0].workflowId = wf.id;
      r.status = 'Bounced'; r.depositStatus = 'Returned'; r.penaltyMemoNo = memoNo;
      (r.history ??= []).push({ at: nowIso(), by: me().userId, action: 'Bounced', note: `${reason} · penalty ${memoNo} ₱${penalty.toLocaleString('en-PH')}` });
      notify('invoice.overdue', `Bounced check: ${c.clientName}`, `${receiptNo} returned — invoices remain open; penalty ${memoNo} raised`, { clientCode: c.clientCode, aeUserId: c.aeAssigned, link: `/billing/receipts?receipt=${receiptNo}` });
      audit('receipt.bounced', 'receipt', receiptNo, { penaltyMemoNo: memoNo }, reason); persist();
      return memoNo;
    },
    /** Cancel / reverse a receipt with reason (who may do it pending Q-FIN-06). An issued OR is reversed off the invoices. */
    async cancelReceipt(receiptNo: string, reason: string) {
      requirePerm('fin.receipt', 'edit');
      return tx(() => {
        if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'Reason is required.', 422, { reason: 'Required' });
        const r = db.receipts.find((x) => x.receiptNo === receiptNo); if (!r) throw new ApiError('NOT_FOUND', 'Receipt not found', 404);
        const st = receiptStatusOf(r);
        if (st === 'Cancelled' || st === 'Bounced') throw new ApiError('INVALID_STATE', `${receiptNo} is already ${st}.`, 409);
        if (st === 'OR Issued') r.applications.forEach((a) => { const i = db.invoices.find((x) => x.invoiceNo === a.invoiceNo); if (i) { i.amountPaid = round2(Math.max(0, i.amountPaid - a.amount)); (i.history ??= []).push({ at: nowIso(), by: me().userId, action: 'Payment reversed', note: `${r.orNo ?? receiptNo} cancelled — ${reason}` }); } });
        r.status = 'Cancelled'; r.cancelReason = reason; r.cancelledBy = me().userId;
        (r.history ??= []).push({ at: nowIso(), by: me().userId, action: st === 'OR Issued' ? 'Reversed' : 'Cancelled', note: reason });
        audit('receipt.cancelled', 'receipt', receiptNo, { status: 'Cancelled', reversed: st === 'OR Issued' }, reason, { status: st });
        return r.status;
      });
    },
    async receipts() { requirePerm('fin.receipt'); return tx(() => db.receipts.map((r) => ({ ...r, status: receiptStatusOf(r), clientName: clientName(r.clientCode), byName: billingUser(r.by), clearedByName: billingUser(r.clearedBy) }))); },
    async receiptDetail(no: string) {
      requirePerm('fin.receipt');
      return tx(() => {
        const r = db.receipts.find((x) => x.receiptNo === no); if (!r) throw new ApiError('NOT_FOUND', 'Receipt not found', 404);
        return { ...r, status: receiptStatusOf(r), client: clientOf(r.clientCode), clientName: clientName(r.clientCode), byName: billingUser(r.by), clearedByName: billingUser(r.clearedBy), cancelledByName: billingUser(r.cancelledBy), clientCredit: clientCreditOf(r.clientCode),
          invoices: r.applications.map((a) => { const i = db.invoices.find((x) => x.invoiceNo === a.invoiceNo); return { ...a, total: i?.total ?? 0, balance: i ? balance(i) : 0, dueDate: i?.dueDate }; }),
          history: (r.history ?? []).map((h) => ({ ...h, byName: billingUser(h.by) })), audit: db.audit.filter((x) => x.entityType === 'receipt' && x.entityId === no).map((x) => ({ ...x, byName: billingUser(x.actor) })) };
      });
    },
    // ── SCR-37 credit / debit memos (DBL-FIN-011, DBL-FIN-003 / BR-05, DBL-RES-006) ──
    async memos() {
      requirePerm('fin.memo');
      return tx(() => db.memos.map((m) => {
        const wf = db.workflows.find((w) => w.id === m.workflowId);
        const decided = wf?.steps.filter((s) => s.decision !== 'Pending' && s.decidedBy).map((s) => `${s.label}: ${billingUser(s.decidedBy)} (${s.decision.toLowerCase()})`) ?? [];
        return { ...m, ...memoDefaults(m), clientName: clientName(m.clientCode), createdByName: billingUser(m.createdBy ?? memoDefaults(m).createdBy), approvedBy: decided.join(' · '), pendingWith: wf?.status === 'Pending' ? wf.steps[wf.currentStep]?.label : undefined };
      }));
    },
    async memo(no: string) {
      requirePerm('fin.memo');
      return tx(() => {
        const m = db.memos.find((x) => x.memoNo === no); if (!m) throw new ApiError('NOT_FOUND', 'Memo not found', 404);
        const inv = db.invoices.find((i) => i.invoiceNo === (m.appliedTo ?? m.referenceInvoiceNo));
        const rescue = db.rescues.find((r) => r.rescueNo === (m.rescueNo ?? (m.referenceType === 'Rescue' ? m.referenceId : undefined)));
        return { ...m, ...memoDefaults(m), clientName: clientName(m.clientCode), client: clientOf(m.clientCode), createdByName: billingUser(m.createdBy ?? memoDefaults(m).createdBy), workflow: db.workflows.find((w) => w.id === m.workflowId),
          invoice: inv ? { invoiceNo: inv.invoiceNo, total: inv.total, balance: balance(inv), payment: paymentStatus(inv) } : undefined,
          rescue: rescue ? { rescueNo: rescue.rescueNo, status: rescue.status, total: rescue.total, beforePhotos: rescue.beforePhotos ?? [], afterPhotos: rescue.afterPhotos ?? [], clientAckName: rescue.clientAckName, acknowledgedAt: rescue.acknowledgedAt } : undefined,
          jo: db.jobOrders.find((j) => j.joNo === (m.joNo ?? (m.referenceType === 'Job Order' ? m.referenceId : undefined))),
          audit: db.audit.filter((a) => a.entityType === 'memo' && a.entityId === no).map((a) => ({ ...a, byName: billingUser(a.actor) })) };
      });
    },
    /** Job orders and completed rescues a Debit Memo can be linked to (client's chassis, or chargeable). */
    async memoLinks(clientCode: string) {
      requirePerm('fin.memo');
      return tx(() => ({
        jos: db.jobOrders.filter((j) => j.chargeable || db.chassis.find((c) => c.chassisNo === j.chassisNo)?.currentClientCode === clientCode).map((j) => ({ joNo: j.joNo, chassisNo: j.chassisNo, status: j.status, chargeable: j.chargeable })),
        rescues: db.rescues.filter((r) => r.clientCode === clientCode && r.status === 'Completed').map((r) => ({ rescueNo: r.rescueNo, chassisNo: r.chassisNo, total: r.total, debitMemoNo: r.debitMemoNo })),
      }));
    },
    async createMemo(input: { type: 'Credit' | 'Debit'; clientCode: string; referenceInvoiceNo?: string; amount: number; reason: string; category?: string; evidence?: string[];
      breakdown?: { labor: number; parts: number; travel: number; service: number; inputTax: number }; joNo?: string; rescueNo?: string; draft?: boolean; memoNo?: string }) {
      requirePerm('fin.memo', 'add');
      await delay();
      const { draft, memoNo: existing, ...v } = input;
      const amount = v.type === 'Debit' && v.breakdown ? debitMemoTotal(v.breakdown) : round2(v.amount);
      if (!draft) validateMemo({ ...v, amount });
      else if (!v.clientCode) throw new ApiError('VALIDATION_FAILED', 'Client is required to save a draft.', 422, { clientCode: 'Required' });
      const old = existing ? db.memos.find((m) => m.memoNo === existing && m.status === 'Draft') : undefined;
      if (existing && !old) throw new ApiError('INVALID_STATE', `${existing} is no longer a draft.`, 409);
      const memoNo = old?.memoNo ?? nextNo(v.type === 'Credit' ? 'CM' : 'DM', v.type === 'Credit' ? 'CM-' : 'DM-', 6);
      if (old) db.memos.splice(db.memos.indexOf(old), 1);
      const chain = memoApprovalChain(v.type, v.category);
      const m: Memo = { memoNo, ...v, amount, referenceType: v.rescueNo ? 'Rescue' : v.joNo ? 'Job Order' : v.referenceInvoiceNo ? 'Invoice' : 'Other', referenceId: v.rescueNo ?? v.joNo, status: draft ? 'Draft' : 'Pending Approval',
        createdAt: old?.createdAt ?? nowIso(), createdBy: old?.createdBy ?? me().userId, source: 'Manual', approvalChain: chain.map((s) => s.label) };
      db.memos.unshift(m);
      if (!draft) {
        const wf = startWorkflow('MEMO', `${v.type} memo ${memoNo} — ${clientName(v.clientCode)}${v.category ? ` (${v.category})` : ''}`, 'memo', memoNo, chain.map((s) => ({ label: s.label, roles: [...s.roles] as RoleCode[] })), amount);
        m.workflowId = wf.id;
      }
      audit(draft ? 'memo.draft_saved' : 'memo.submitted', 'memo', memoNo, { ...m }, v.reason);
      persist();
      return memoNo;
    },
    async submitMemo(no: string) {
      const m = db.memos.find((x) => x.memoNo === no); if (!m) throw new ApiError('NOT_FOUND', 'Memo not found', 404);
      return api.billing.createMemo({ type: m.type, clientCode: m.clientCode, referenceInvoiceNo: m.referenceInvoiceNo, amount: m.amount, reason: m.reason, category: m.category, evidence: m.evidence, breakdown: m.breakdown, joNo: m.joNo, rescueNo: m.rescueNo, memoNo: no });
    },
    async discardMemo(no: string) {
      requirePerm('fin.memo', 'add');
      return tx(() => { const m = db.memos.find((x) => x.memoNo === no && x.status === 'Draft'); if (!m) throw new ApiError('INVALID_STATE', 'Only a draft memo can be discarded.', 409); db.memos.splice(db.memos.indexOf(m), 1); audit('memo.draft_discarded', 'memo', no); return no; });
    },
  },

  // ── Credit & collection (M11) ───────────────────────────────────────────
  credit: {
    async status(code: string) {
      const u = me(); if (u.realm === 'INTERNAL') requirePerm('cnc.status');
      runAutoHold();
      return tx(() => {
        const c = mustClient(code);
        const open = db.invoices.filter((i) => i.clientCode === code && balance(i) > 0 && i.status !== 'Draft');
        const outstanding = outstandingOf(code);
        const onHireEst = db.chassis.filter((x) => x.currentClientCode === code && x.status === 'On Hire').length * 1000 * 7;
        const actions: GateAction[] = ['GATE_OUT', 'EWA_CREATE', 'JO_CREATE_SPOT', 'RESCUE_DISPATCH', 'SERVICE_CREATE', 'GATE_IN'];
        const labels: Record<string, string> = { GATE_OUT: 'Chassis release / gate pass', EWA_CREATE: 'EWA creation', JO_CREATE_SPOT: 'Repair (spot)', RESCUE_DISPATCH: 'Rescue', SERVICE_CREATE: 'New services', GATE_IN: 'Gate In (returns)' };
        const exposure = outstanding + onHireEst;
        const standing = c.status === 'Hold' ? 'On Hold' : c.status === 'Blacklist' ? 'Blacklisted' : c.status === 'Inactive' ? 'Inactive' : c.creditLimit && exposure > c.creditLimit ? 'Over Limit' : c.status === 'Active' ? 'Good Standing' : c.status;
        const overrides = (db.gateOverrides ?? []).filter((o) => o.clientCode === code);
        const threshold = Number(S()['cnc.hold_threshold_days'] ?? 30);
        const holdEvents = db.holdEvents.filter((h) => h.clientCode === code);
        const lastHold = holdEvents.find((h) => h.type !== 'Reactivated');
        const cc = db.collections.find((x) => x.clientCode === code);
        const blockReason = c.status === 'Hold' ? (lastHold?.reason ?? (lastHold?.invoiceNo ? `Invoice ${lastHold.invoiceNo} ${lastHold.daysOverdue} days past due (auto-hold > ${threshold} days, BR-02)` : 'Manual hold')) : c.status === 'Blacklist' ? 'Blacklisted account — legal / collection referral' : c.status === 'Inactive' ? 'Inactive account — no active contract' : c.status === 'Draft' ? 'Not yet accredited' : undefined;
        return {
          client: c, standing, creditLimit: c.creditLimit, exposure, onHireEst, outstanding, openCount: open.length, oldestDays: Math.max(0, ...open.map(daysOverdue)),
          branchName: db.branches.find((b) => b.code === c.branchCode)?.name ?? c.branchCode, aeName: db.users.find((x) => x.userId === c.aeAssigned)?.name ?? c.aeAssigned,
          gates: actions.map((a) => ({ action: a, label: labels[a], ...creditGate(c, a, overrides), blockReason, override: overrides.find((o) => o.action === a && o.status !== 'Rejected') })),
          overrides, threshold, blockReason, holdSince: c.status === 'Hold' ? lastHold?.effectiveDate ?? lastHold?.at : undefined,
          ewallet: db.ewallets.find((e) => e.clientCode === code), cashBond: db.cashBonds.filter((b) => b.clientCode === code && b.status === 'Held').reduce((a, b) => a + b.amount, 0),
          holdEvents, aging: agingFor(code),
          collection: { stage: cc?.stage ?? 'None', nextActionDue: cc?.nextActionDue, acknowledgedAt: cc?.acknowledgedAt, lastSoaSentAt: cc?.soaSends?.[0]?.at },
          openInvoices: open.map((i) => ({ invoiceNo: i.invoiceNo, dueDate: i.dueDate, balance: balance(i), daysOverdue: daysOverdue(i), daysToHold: threshold - daysOverdue(i) })),
          liftRequests: db.workflows.filter((w) => w.matrixCode === 'HOLD_LIFT' && w.subjectId === code),
        };
      });
    },
    // SCR-38 search by client name, code or branch
    async search(q: string) {
      requirePerm('cnc.status');
      const s = q.trim().toLowerCase();
      return tx(() => db.clients.filter((c) => !s || c.clientName.toLowerCase().includes(s) || c.clientCode.toLowerCase().includes(s) || c.branchCode.toLowerCase().includes(s) || (db.branches.find((b) => b.code === c.branchCode)?.name ?? '').toLowerCase().includes(s))
        .map((c) => ({ clientCode: c.clientCode, clientName: c.clientName, status: c.status, branchCode: c.branchCode, aeName: db.users.find((u) => u.userId === c.aeAssigned)?.name ?? c.aeAssigned })), 20);
    },
    async gateCheck(code: string, action: GateAction) { await delay(30); return creditGate(clientOf(code), action, (db.gateOverrides ?? []).filter((o) => o.clientCode === code)); },
    // DBL-CNC-001 authorised override of one blocked gate (approver = C&C Manager, proposed default Q-CNC-07)
    async requestOverride(code: string, action: GateAction, reason: string, validUntil: string) {
      requirePerm('cnc.status');
      await delay();
      const c = mustClient(code);
      if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
      if (!validUntil || validUntil < nowIso().slice(0, 10)) throw new ApiError('VALIDATION_FAILED', 'Valid-until must be today or later.', 422, { validUntil: 'Today or later' });
      if (creditGate(c, action).allowed) throw new ApiError('INVALID_STATE', 'This gate is not blocked.', 409);
      db.gateOverrides ??= [];
      if (db.gateOverrides.some((o) => o.clientCode === code && o.action === action && o.status === 'Pending')) throw new ApiError('INVALID_STATE', 'An override request for this gate is already pending.', 409);
      const wf = startWorkflow('GATE_OVERRIDE', `Credit-gate override (${action}) — ${c.clientName}`, 'client', code, [{ label: 'C&C Manager', roles: ['CNC_MANAGER'] }], outstandingOf(code), c.branchCode);
      const o = { id: uid(), clientCode: code, action, reason, validUntil: `${validUntil}T23:59:59.000Z`, requestedBy: me().userId, requestedAt: nowIso(), workflowId: wf.id, status: 'Pending' as const };
      db.gateOverrides.unshift(o);
      audit('gate_override.requested', 'client', code, o, reason); persist();
      return structuredClone(o);
    },
    // SCR-38 manual hold with reason, effective date and authorising officer (DBL-CNC-003)
    async manualHold(code: string, input: { reason: string; effectiveDate: string; approvedBy: string }) {
      requirePerm('cnc.aging', 'edit');
      return tx(() => {
        const c = mustClient(code);
        if (c.status !== 'Active') throw new ApiError('INVALID_STATE', `Only Active clients can be placed on hold (current: ${c.status}).`, 409);
        if (!input.reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required.', 422, { reason: 'Required' });
        if (!input.approvedBy) throw new ApiError('VALIDATION_FAILED', 'Select the authorising officer.', 422, { approvedBy: 'Required' });
        if (input.effectiveDate > nowIso().slice(0, 10)) throw new ApiError('VALIDATION_FAILED', 'Effective date cannot be in the future.', 422, { effectiveDate: 'Today or earlier' });
        c.status = 'Hold';
        db.holdEvents.unshift({ id: uid(), clientCode: code, type: 'Manual Hold', at: nowIso(), by: me().userId, outstanding: outstandingOf(code), reason: input.reason, effectiveDate: input.effectiveDate, approvedBy: input.approvedBy });
        notify('client.hold.applied', `Credit hold: ${c.clientName}`, input.reason, { clientCode: code, aeUserId: c.aeAssigned, link: `/credit/status?client=${code}` });
        audit('client.hold.manual', 'client', code, { status: 'Hold', effectiveDate: input.effectiveDate, approvedBy: input.approvedBy }, input.reason); return c;
      });
    },
    async aging(f: { asOf?: string; includeZero?: boolean } = {}) {
      requirePerm('cnc.aging'); runAutoHold();
      return tx(() => {
        const asOf = f.asOf && f.asOf < nowIso().slice(0, 10) ? f.asOf : undefined;
        // As-of view re-buckets open invoices issued on/before the date (balances are current — payment dating needs the live API).
        const agingAt = (code?: string): AgingBuckets => {
          if (!asOf) return agingFor(code);
          const b = emptyAging(); const ref = `${asOf}T23:59:59.000Z`;
          for (const i of db.invoices) {
            if (i.status === 'Draft' || (code && i.clientCode !== code) || balance(i) <= 0 || i.issuedAt.slice(0, 10) > asOf) continue;
            const k = agingBucket(Math.max(0, daysBetween(new Date(i.dueDate).toISOString(), ref)));
            b[k] = round2(b[k] + balance(i)); b.total = round2(b.total + balance(i));
          }
          return b;
        };
        const total = agingAt();
        const t1 = Number(S()['cnc.tier1_max'] ?? 100000), t2 = Number(S()['cnc.tier2_max'] ?? 500000);
        const today = nowIso().slice(0, 10);
        const all = db.clients.map((c) => {
          const cc = db.collections.find((x) => x.clientCode === c.clientCode);
          const a = agingAt(c.clientCode);
          const ew = db.ewalletTxns.filter((t) => t.clientCode === c.clientCode && t.type === 'Deduction');
          const memos = db.memos.filter((m) => m.clientCode === c.clientCode && ['Posted', 'Approved', 'Applied'].includes(m.status));
          return {
            clientCode: c.clientCode, clientName: c.clientName, status: c.status, branchCode: c.branchCode, ae: c.aeAssigned, ...a,
            classification: c.isLegal ? 'Legal' : c.isCollectionAgency ? 'Collection agency' : 'Regular',
            stage: cc?.stage ?? 'None', nextActionDue: cc?.nextActionDue, actionOverdueDays: cc?.nextActionDue && cc.nextActionDue < today ? daysBetween(`${cc.nextActionDue}T00:00:00.000Z`, nowIso()) : 0,
            lastSoaSentAt: cc?.soaSends?.[0]?.at, acknowledgedAt: cc?.acknowledgedAt, history: cc?.actions ?? [], sends: cc?.soaSends ?? [], pendingDemand: !!cc?.pendingWorkflowId,
            liftTier: c.status === 'Hold' ? holdLiftTier(a.total, t1, t2).label : undefined,
            ewalletApplied: round2(ew.reduce((s, t) => s - t.amount, 0)), creditMemos: round2(memos.filter((m) => m.type === 'Credit').reduce((s, m) => s + m.amount, 0)), debitMemos: round2(memos.filter((m) => m.type === 'Debit').reduce((s, m) => s + m.amount, 0)),
          };
        });
        const clients = f.includeZero ? all : all.filter((c) => c.total > 0);
        const byBranch = db.branches.filter((b) => !b.isHeadOffice).map((b) => { const cs = clients.filter((c) => c.branchCode === b.code); const row: Record<string, number | string> = { branch: b.code }; let sum = 0; for (const k of AGING_BUCKETS) { const v = round2(cs.reduce((a, c) => a + c[k.key], 0)); row[k.key] = v; sum += v; } return { row, sum }; }).filter((x) => x.sum > 0).map((x) => x.row as { branch: string } & Omit<AgingBuckets, 'total'>);
        const overdue = round2(total.total - total.current);
        const liftQueue = db.workflows.filter((w) => w.matrixCode === 'HOLD_LIFT' && w.status === 'Pending').map((w) => ({ id: w.id, clientCode: w.subjectId, clientName: clientName(w.subjectId), amount: w.amount ?? 0, tier: w.steps[w.currentStep]?.label ?? '', dueAt: w.steps[w.currentStep]?.dueAt, escalated: !!w.steps[w.currentStep]?.dueAt && w.steps[w.currentStep].dueAt! < nowIso() }));
        return { asOf: asOf ?? today, total, overdue, onHold: db.clients.filter((c) => c.status === 'Hold').length, pendingLifts: liftQueue.length, liftQueue, clients, byBranch, clientCount: db.clients.length, withBalance: all.filter((c) => c.total > 0).length, actionsOverdue: all.filter((c) => c.actionOverdueDays > 0).length };
      });
    },
    // DBL-CNC-006: Next stage. Demand letter goes through approval first (proposed default, Q-CNC-06).
    async advanceCollection(code: string, notes?: string, letter?: string) {
      requirePerm('cnc.aging', 'edit');
      await delay();
      const cc = db.collections.find((x) => x.clientCode === code);
      if (cc?.pendingWorkflowId) throw new ApiError('INVALID_STATE', 'A demand letter is already awaiting approval.', 409);
      if (nextCollectionStage(cc?.stage ?? 'None') === 'Demand Letter') {
        const c = mustClient(code);
        const wf = startWorkflow('DEMAND_LETTER', `Demand letter — ${c.clientName}`, 'client', code, [{ label: 'C&C Manager approval', roles: ['CNC_MANAGER'] }], outstandingOf(code), c.branchCode);
        const x = cc ?? { clientCode: code, stage: 'None' as const, actions: [] }; if (!cc) db.collections.push(x);
        x.pendingWorkflowId = wf.id; x.actions.unshift({ at: nowIso(), action: 'Demand letter submitted for approval', by: me().userId, notes, letter });
        audit('collection.demand_requested', 'client', code, { workflow: wf.id }, notes); persist();
        return { ...structuredClone(x), pendingApproval: true };
      }
      const r = collectionAdvance(code, notes, letter); persist();
      return { ...structuredClone(r), pendingApproval: false };
    },
    // DBL-CNC-005 send SOA by email / courier with a send log
    async sendSoa(code: string, input: { channel: 'Email' | 'Courier'; to: string; trackingNo?: string }) {
      requirePerm('cnc.aging', 'edit');
      return tx(() => {
        mustClient(code);
        if (!input.to.trim()) throw new ApiError('VALIDATION_FAILED', input.channel === 'Email' ? 'Recipient email is required.' : 'Courier address is required.', 422, { to: 'Required' });
        let cc = db.collections.find((x) => x.clientCode === code);
        if (!cc) { cc = { clientCode: code, stage: 'None', actions: [] }; db.collections.push(cc); }
        const send = { id: uid(), soaNo: nextNo('SOA', `SOA-${new Date().getFullYear()}-`, 5), at: nowIso(), by: me().userId, channel: input.channel, to: input.to.trim(), trackingNo: input.trackingNo?.trim() || undefined };
        (cc.soaSends ??= []).unshift(send); cc.acknowledgedAt = undefined;
        if (cc.stage === 'None') collectionAdvance(code, `SOA ${send.soaNo} sent by ${send.channel.toLowerCase()} to ${send.to}`);
        else cc.actions.unshift({ at: nowIso(), action: `SOA re-sent (${send.channel})`, by: me().userId, notes: send.to });
        audit('soa.sent', 'client', code, send); return send;
      });
    },
    async acknowledgeSoa(code: string, date: string) {
      requirePerm('cnc.aging', 'edit');
      return tx(() => {
        const cc = db.collections.find((x) => x.clientCode === code);
        if (!cc?.soaSends?.length) throw new ApiError('INVALID_STATE', 'Send the SOA before recording the acknowledgment.', 409);
        if (!date || date > nowIso().slice(0, 10)) throw new ApiError('VALIDATION_FAILED', 'Acknowledgment date cannot be in the future.', 422, { date: 'Today or earlier' });
        cc.acknowledgedAt = `${date}T00:00:00.000Z`; cc.actions.unshift({ at: nowIso(), action: 'SOA acknowledged by client', by: me().userId, notes: date });
        audit('soa.acknowledged', 'client', code, { date }); return cc;
      });
    },
    async soa(code: string) {
      const u = me(); if (u.realm === 'CLIENT_PORTAL' && u.clientCode !== code) throw new ApiError('NOT_FOUND', 'Not found', 404);
      return tx(() => {
        const c = mustClient(code);
        const rows: { date: string; docType: string; docNo: string; due?: string; debit: number; credit: number; ref?: string }[] = [];
        // The statement reconciles to Balance due: only memos applied to an invoice change what the client owes (client-level memos stay off the SOA until applied).
        const memos = db.memos.filter((m) => m.clientCode === code && m.status === 'Applied' && m.amount > 0 && m.category !== 'Late-encoding correction' && db.invoices.some((i) => i.invoiceNo === m.referenceInvoiceNo && i.status !== 'Cancelled'));
        // DBL-CNC-010: Debit memos on an invoice are already inside inv.total (applyMemo) → split them out as their own rows.
        db.invoices.filter((i) => i.clientCode === code && i.status !== 'Draft').forEach((i) => {
          const debit = round2(i.total - memos.filter((m) => m.type === 'Debit' && m.referenceInvoiceNo === i.invoiceNo).reduce((a, m) => a + m.amount, 0));
          rows.push({ date: i.issuedAt, docType: 'Invoice', docNo: i.invoiceNo, due: i.dueDate, debit, credit: 0 });
          // A cancelled invoice is shown with its reversal so it nets to zero.
          if (i.status === 'Cancelled') rows.push({ date: [...(i.history ?? [])].reverse().find((h) => /cancel/i.test(h.action))?.at ?? i.issuedAt, docType: 'Invoice cancelled', docNo: i.invoiceNo, debit: 0, credit: round2(debit - i.amountPaid), ref: i.cancelReason });
        });
        // Only cleared money reduces the balance: provisional (uncleared), bounced and cancelled receipts are excluded (DBL-FIN-013).
        db.receipts.filter((r) => r.clientCode === code && !['Provisional', 'Bounced', 'Cancelled'].includes(r.status ?? 'OR Issued'))// Review 1.1: label the receipt series (Official / Provisional) and show which invoice(s) it paid.
          // A cleared PR replaced by an OR (DBL-FIN-012) is shown under its OR number, with the PR it came from.
          .forEach((r) => { const official = r.status === 'OR Issued' || r.type === 'OR';
            rows.push({ date: new Date(r.date).toISOString(), docType: official ? 'Official receipt' : r.type === 'PR' ? 'Provisional receipt' : 'Receipt', docNo: (official && r.orNo) || r.receiptNo, debit: 0, credit: r.amount - r.unapplied,
              ref: [r.orNo && r.orNo !== r.receiptNo ? `From ${r.receiptNo}` : '', r.applications.length ? `applied to ${r.applications.map((a) => a.invoiceNo).join(', ')}` : ''].filter(Boolean).join(' · ') || undefined }); });
        const cmLeft: Record<string, number> = {}; // a credit memo is applied only up to the invoice balance (applyMemo)
        memos.forEach((m) => {
          const inv = m.referenceInvoiceNo!; cmLeft[inv] ??= db.invoices.find((i) => i.invoiceNo === inv)?.credited ?? 0;
          const cr = m.type === 'Credit' ? Math.min(m.amount, cmLeft[inv]) : 0; if (m.type === 'Credit') cmLeft[inv] = round2(cmLeft[inv] - cr);
          rows.push({ date: m.appliedAt ?? m.createdAt, docType: m.type === 'Debit' ? 'Debit Memo' : 'Credit Memo', docNo: m.memoNo, debit: m.type === 'Debit' ? m.amount : 0, credit: cr, ref: inv });
        });
        // DBL-EWL-007: Debit memos settled from the e-wallet show as an e-wallet credit.
        db.ewalletTxns.filter((t) => t.clientCode === code && t.type === 'Deduction' && memos.some((m) => m.memoNo === t.referenceId || (m.referenceType === t.referenceType && m.referenceId === t.referenceId))).forEach((t) => rows.push({ date: t.at, docType: 'E-wallet applied', docNo: t.id, debit: 0, credit: -t.amount, ref: t.referenceId }));
        rows.sort((a, b) => a.date.localeCompare(b.date));
        let run = 0;
        const lines = rows.map((r) => { run = round2(run + r.debit - r.credit); return { ...r, balance: run }; });
        const cc = db.collections.find((x) => x.clientCode === code);
        return {
          soaNo: cc?.soaSends?.[0]?.soaNo ?? `SOA-${new Date().getFullYear()}-${String((db.seq.SOA ?? 0) + 1).padStart(5, '0')}`, client: c, asOf: nowIso(), aging: agingFor(code), lines,
          ewallet: db.ewallets.find((e) => e.clientCode === code), cashBond: db.cashBonds.filter((b) => b.clientCode === code && b.status === 'Held').reduce((a, b) => a + b.amount, 0), stage: cc?.stage ?? 'None',
          contracts: db.contracts.filter((k) => k.clientCode === code && ['Active', 'Signed', 'Notarized'].includes(k.status)).map((k) => k.contractNo),
          sends: cc?.soaSends ?? [], acknowledgedAt: cc?.acknowledgedAt, nextActionDue: cc?.nextActionDue, preparedBy: u.realm === 'INTERNAL' ? u.name : undefined,
          // Company details for the printed statement (Admin → System settings → Company); empty until Finance enters them.
          company: { address: String(settings()['co.registered_address'] ?? '').trim(), tin: String(settings()['co.tin'] ?? '').trim(), permit: String(settings()['co.bir_permit'] ?? '').trim(), payeeBank: String(settings()['co.payee_bank'] ?? '').trim() },
          contactEmail: c.ebillingEmail ?? c.email ?? c.contacts.find((x) => x.isPrimary)?.email ?? c.contacts[0]?.email ?? '',
        };
      });
    },
    async requestHoldLift(code: string, basis: string, arrangement?: string) {
      requirePerm('cnc.hold_lift', 'add');
      await delay();
      const c = mustClient(code);
      if (c.status !== 'Hold') throw new ApiError('INVALID_STATE', 'Client is not on hold.', 409);
      if (db.workflows.some((w) => w.matrixCode === 'HOLD_LIFT' && w.subjectId === code && w.status === 'Pending')) throw new ApiError('INVALID_STATE', 'A hold-lift request is already pending.', 409);
      const outstanding = outstandingOf(code);
      const tier = holdLiftTier(outstanding, Number(S()['cnc.tier1_max'] ?? 100000), Number(S()['cnc.tier2_max'] ?? 500000));
      const wf = startWorkflow('HOLD_LIFT', `Hold lift — ${c.clientName}`, 'client', code, [{ label: tier.label, roles: tier.roles }], outstanding, c.branchCode);
      audit('hold_lift.requested', 'client', code, { basis, arrangement, tier: tier.tier });
      persist();
      return structuredClone(wf);
    },
  },

  // ── E-wallet (M12) ───────────────────────────────────────────────────────
  ewallet: {
    async list() {
      requirePerm('ewl.ledger');
      return tx(() => db.ewallets.map((w) => {
        const c = clientOf(w.clientCode); const ts = db.ewalletTxns.filter((t) => t.clientCode === w.clientCode);
        const state = w.balance < 0 ? 'Negative' : w.balance < w.minimumBalance ? 'Below minimum' : 'OK';
        return { ...w, clientName: clientName(w.clientCode), clientStatus: c?.status, allowRescue: !!c?.allowRescue, state: state as 'Negative' | 'Below minimum' | 'OK', lastTopupAt: ts.filter((t) => t.type === 'Replenishment').map((t) => t.at).sort().pop(), lastTxnAt: ts.map((t) => t.at).sort().pop() };
      }));
    },
    // DBL-EWL-001: clients eligible for a wallet (accredited Active, no wallet yet) + their Treasury-cleared receipts
    async eligibleClients() {
      requirePerm('ewl.ledger');
      return tx(() => db.clients.filter((c) => !db.ewallets.some((w) => w.clientCode === c.clientCode)).map((c) => ({
        clientCode: c.clientCode, clientName: c.clientName, status: c.status, eligible: c.status === 'Active', allowRescue: c.allowRescue,
        receipts: db.receipts.filter((r) => r.clientCode === c.clientCode).map((r) => ({ receiptNo: r.receiptNo, type: r.type, date: r.date, amount: r.amount, method: r.method, reference: r.reference, by: r.by })),
      })));
    },
    async ledger(code: string) {
      const u = me(); if (u.realm === 'CLIENT_PORTAL' && u.clientCode !== code) throw new ApiError('NOT_FOUND', 'Not found', 404);
      if (u.realm === 'INTERNAL') requirePerm('ewl.ledger');
      return tx(() => {
        const wallet = db.ewallets.find((w) => w.clientCode === code) ?? null;
        // DBL-EWL-007: deductions that settle a debit memo / invoice are pushed to aging at posting time.
        const txns = db.ewalletTxns.filter((t) => t.clientCode === code).map((t) => ({
          ...t, category: t.category ?? ewalletCategory(t.type, t.referenceType),
          debitMemoNo: t.referenceType === 'Rescue' ? db.rescues.find((r) => r.rescueNo === t.referenceId)?.debitMemoNo : t.referenceType === 'Debit Memo' ? t.referenceId : undefined,
          agingSyncedAt: t.type === 'Replenishment' ? undefined : t.at,
        }));
        // Screen Inventory: Cash Bond is the second fund type in the same ledger, kept as a separate balance.
        const bonds = db.cashBonds.filter((b) => b.clientCode === code);
        const bondEntries = bonds.flatMap((b) => [
          { id: `${b.id}-R`, at: new Date(b.dateReceived).toISOString(), entry: 'Bond received' as const, amount: b.amount, reference: b.receiptRef, contractNo: b.contractNo, status: b.status },
          ...b.withdrawals.map((w) => ({ id: w.id, at: w.requestedAt, entry: (w.status.startsWith('Approved') ? 'Bond refunded' : 'Withdrawal requested') as 'Bond refunded' | 'Withdrawal requested', amount: w.status.startsWith('Approved') ? -w.refundable : 0, reference: w.workflowId, contractNo: b.contractNo, status: w.status, reason: w.reason })),
          ...(b.status === 'Applied' ? [{ id: `${b.id}-A`, at: nowIso(), entry: 'Bond applied' as const, amount: -b.amount, reference: b.receiptRef, contractNo: b.contractNo, status: b.status }] : []),
        ]).sort((a, b) => a.at.localeCompare(b.at));
        let run = 0; const bondLedger = bondEntries.map((e) => { run = round2(run + e.amount); return { ...e, balanceAfter: run }; });
        const notifications = Object.values(db.notifications.filter((n) => n.link === `/ewallet/${code}` || (n.link === `/credit/status?client=${code}`)).reduce((acc, n) => { const k = `${n.at.slice(0, 16)}|${n.title}`; (acc[k] ??= { at: n.at, title: n.title, body: n.body, recipients: [] as string[] }).recipients.push(db.users.find((x) => x.userId === n.userId)?.name ?? n.userId); return acc; }, {} as Record<string, { at: string; title: string; body: string; recipients: string[] }>));
        return {
          wallet, clientName: clientName(code), clientStatus: clientOf(code)?.status, allowRescue: !!clientOf(code)?.allowRescue, txns, topups: db.topups.filter((t) => t.clientCode === code), payeeBank: String(settings()['co.payee_bank'] ?? '').trim(),
          bond: { held: bonds.filter((b) => b.status === 'Held' || b.status === 'Withdrawal Pending').reduce((a, b) => a + b.amount, 0), entries: bondLedger },
          lastAgingSync: txns.find((t) => t.agingSyncedAt)?.agingSyncedAt, notifications: u.realm === 'INTERNAL' ? notifications : [],
        };
      });
    },
    async create(code: string, treasuryRef: string, initial: number, x: { receiptNo?: string; clearedDate?: string; treasuryConfirmedBy?: string; allowRescue?: boolean } = {}) {
      requirePerm('ewl.txn', 'add');
      await delay();
      const c = mustClient(code);
      if (db.ewallets.some((w) => w.clientCode === code)) throw new ApiError('DUPLICATE_KEY', `${c.clientName} already has an e-wallet — one wallet per client (DBL-EWL-001).`, 409);
      if (c.status !== 'Active') throw new ApiError('INVALID_STATE', `Only accredited, Active clients can get an e-wallet (current: ${c.status}).`, 409);
      const min = Number(S()['ewl.min_balance'] ?? 10000);
      if (!(initial > 0)) throw new ApiError('VALIDATION_FAILED', 'Initial amount must be greater than zero.', 422, { amount: '> 0' });
      if (initial < min) throw new ApiError('VALIDATION_FAILED', `Initial amount must be at least the minimum balance ₱${min.toLocaleString('en-PH')} (DBL-EWL-002).`, 422, { amount: `≥ ${min}` });
      if (!treasuryRef.trim()) throw new ApiError('VALIDATION_FAILED', 'Treasury confirmation reference is required.', 422, { treasuryRef: 'Required' });
      const r = db.receipts.find((y) => y.receiptNo === x.receiptNo);
      if (!r || r.clientCode !== code) throw new ApiError('VALIDATION_FAILED', 'Select the Treasury-cleared PR/OR that recorded the initial payment.', 422, { receiptNo: 'Required' });
      if (r.amount < initial) throw new ApiError('VALIDATION_FAILED', `Initial amount exceeds receipt ${r.receiptNo} (₱${r.amount.toLocaleString('en-PH')}).`, 422, { amount: 'Exceeds receipt' });
      const tr = db.users.find((y) => y.userId === x.treasuryConfirmedBy);
      if (!tr || !tr.roles.includes('TREASURY')) throw new ApiError('VALIDATION_FAILED', 'Select the Treasury officer who confirmed the funds.', 422, { treasuryConfirmedBy: 'Required' });
      db.ewallets.push({ clientCode: code, balance: 0, minimumBalance: min, createdAt: nowIso(), createdBy: me().userId, receiptNo: r.receiptNo, clearedDate: x.clearedDate ?? r.date, paymentMethod: r.method, bankRef: r.reference, treasuryRef, treasuryConfirmedBy: tr.userId, treasuryConfirmedAt: nowIso() });
      ewalletPost(code, 'Replenishment', initial, 'Top-up', r.receiptNo, 'Initial funding (Treasury confirmed)', { receiptNo: r.receiptNo, treasuryRef });
      if (x.allowRescue && !c.allowRescue) { c.allowRescue = true; audit('client.flags', 'client', code, { allowRescue: true }, 'Enabled on e-wallet creation (DBL-CLT-005)'); }
      persist(); return true;
    },
    async post(input: { clientCode: string; type: 'Replenishment' | 'Deduction' | 'Adjustment' | 'Reversal'; amount: number; referenceType: string; referenceId?: string; reason?: string; treasuryRef?: string; reversesId?: string; receiptNo?: string; category?: EwalletCategory }) {
      requirePerm('ewl.txn', 'add');
      await delay();
      if (input.type !== 'Reversal' && !(input.amount > 0)) throw new ApiError('VALIDATION_FAILED', 'Amount must be greater than zero.', 422, { amount: '> 0' });
      if (input.type === 'Replenishment') {
        if (!input.treasuryRef?.trim()) throw new ApiError('VALIDATION_FAILED', 'Treasury confirmation reference is required for replenishments.', 422, { treasuryRef: 'Required' });
        const t = ewalletPost(input.clientCode, 'Replenishment', input.amount, input.referenceType, input.receiptNo || input.treasuryRef, input.reason, { receiptNo: input.receiptNo || undefined, treasuryRef: input.treasuryRef });
        persist(); return { posted: true, txn: t };
      }
      if (!input.reason?.trim()) throw new ApiError('VALIDATION_FAILED', 'A reason is required for deductions, adjustments and reversals (UC-10.AC.1).', 422, { reason: 'Required' });
      // DBL-EWL-003: deductions only for rescue, repair, debit memo (leasing charges only on contract termination).
      if (input.type === 'Deduction' && !['Rescue', 'Repair', 'Debit Memo', 'Contract-termination lease'].includes(input.category ?? '')) throw new ApiError('VALIDATION_FAILED', 'Deductions are limited to Rescue, Repair, Debit Memo or a contract-termination lease charge (DBL-EWL-003).', 422, { category: 'Out of scope' });
      if (input.type === 'Deduction' && !input.referenceId?.trim()) throw new ApiError('VALIDATION_FAILED', 'Enter the source document number (rescue, JO, DM or invoice).', 422, { referenceId: 'Required' });
      let signed = input.type === 'Deduction' ? -input.amount : input.amount;
      if (input.type === 'Reversal') {
        const orig = db.ewalletTxns.find((t) => t.id === input.reversesId);
        if (!orig) throw new ApiError('VALIDATION_FAILED', 'Select the transaction to reverse.', 422, { reversesId: 'Required' });
        if (orig.reversedById || orig.type === 'Reversal') throw new ApiError('INVALID_STATE', `${orig.id} is already reversed or is itself a reversal.`, 409);
        signed = -orig.amount;
      }
      const wf = startWorkflow('EWALLET_SPECIAL', `E-wallet ${input.type.toLowerCase()} — ${clientName(input.clientCode)}`, 'ewallet', input.clientCode, [{ label: 'Accounting supervisor', roles: ['FINANCE_MANAGER'] }], Math.abs(signed));
      (wf as unknown as { payload: unknown }).payload = { clientCode: input.clientCode, type: input.type, amount: signed, referenceType: input.type === 'Reversal' ? 'Reversal' : input.referenceType, referenceId: input.reversesId ?? input.referenceId, reason: input.reason, category: input.type === 'Deduction' ? input.category : undefined, reversesId: input.reversesId };
      persist(); return { posted: false, workflowId: wf.id };
    },
    async topups() { requirePerm('ewl.ledger'); return tx(() => db.topups.map((t) => ({ ...t, clientName: clientName(t.clientCode) }))); },
    async requestTopup(amount: number, proofFileName: string, paymentRef?: string) {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Portal only', 403);
      return tx(() => { if (!(amount > 0)) throw new ApiError('VALIDATION_FAILED', 'Enter an amount.', 422); const t = { id: uid(), clientCode: u.clientCode!, amount, proofFileName, paymentRef: paymentRef?.trim() || undefined, status: 'Submitted' as const, submittedAt: nowIso() }; db.topups.unshift(t); return t; });
    },
    // DBL-CLT-018: Submitted → Treasury confirmed (who/when, bank ref, PR/OR) → Posted by Accounting; Reject needs a reason.
    async processTopup(id: string, action: 'confirm' | 'post' | 'reject', bankRef?: string, x: { receiptNo?: string; reason?: string } = {}) {
      if (action === 'reject') { try { requirePerm('ewl.txn', 'check'); } catch { requirePerm('ewl.txn', 'add'); } } else requirePerm('ewl.txn', action === 'confirm' ? 'check' : 'add');
      await delay();
      const t = db.topups.find((y) => y.id === id);
      if (!t) throw new ApiError('NOT_FOUND', 'Top-up request not found.', 404);
      if (t.status === 'Posted' || t.status === 'Rejected') throw new ApiError('INVALID_STATE', `Top-up is already ${t.status.toLowerCase()}.`, 409);
      if (action === 'confirm') { if (t.status !== 'Submitted') throw new ApiError('INVALID_STATE', 'Already confirmed.', 409); if (!bankRef?.trim()) throw new ApiError('VALIDATION_FAILED', 'Bank reference required.', 422, { bankRef: 'Required' }); t.status = 'Confirmed by Treasury'; t.bankRef = bankRef; t.receiptNo = x.receiptNo?.trim() || undefined; t.confirmedBy = me().userId; t.confirmedAt = nowIso(); }
      if (action === 'post') { if (t.status !== 'Confirmed by Treasury') throw new ApiError('INVALID_STATE', 'Treasury must confirm the funds first.', 409); const p = ewalletPost(t.clientCode, 'Replenishment', t.amount, 'Top-up', t.receiptNo ?? t.bankRef, 'Portal top-up', { receiptNo: t.receiptNo, treasuryRef: t.bankRef }); t.status = 'Posted'; t.postedBy = me().userId; t.postedAt = nowIso(); t.txnId = p.id; }
      if (action === 'reject') { if (!x.reason?.trim()) throw new ApiError('VALIDATION_FAILED', 'A rejection reason is required.', 422, { reason: 'Required' }); t.status = 'Rejected'; t.rejectedBy = me().userId; t.rejectedAt = nowIso(); t.rejectReason = x.reason.trim(); }
      audit(`topup.${action}`, 'ewallet', t.clientCode, t); persist();
      return structuredClone(t);
    },
  },

  // ── Regulatory (M13) ─────────────────────────────────────────────────────
  regulatory: {
    async list(f: { window?: string; branch?: string; region?: string; unitType?: string; plateEnding?: string; onHire?: string; status?: string; from?: string; to?: string } = {}) {
      requirePerm('reg.registration');
      const defCost = Number(S()['reg.renewal_cost_default'] ?? 1800);
      // DBL-REG-002 renewal schedule by last plate digit (LTO convention: 1 → Jan … 9 → Sep, 0 → Oct). Proposed — confirm with Regulatory.
      const MONTHS = ['Oct', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
      return tx(() => db.registrations.map((r) => {
        const pending = !!r.pending || !r.expiryDate;
        const days = pending ? 99999 : daysBetween(nowIso(), new Date(r.expiryDate).toISOString());
        const ch = db.chassis.find((c) => c.chassisNo === r.subjectId);
        const status = pending ? 'Pending' : days < 0 ? 'Expired' : r.renewalInProgress ? 'Renewal In Progress' : days <= 90 ? 'Expiring' : 'Registered';
        const windowKey = pending ? 'pending' : days < 0 ? 'expired' : days <= 14 ? '14' : days <= 30 ? '30' : days <= 90 ? '90' : 'ok';
        const plateEnding = r.plateNo.replace(/\D/g, '').slice(-1);
        const onHire = ch?.status === 'On Hire';
        return {
          ...r, daysLeft: days, status, window: windowKey, branchCode: r.branchCode ?? ch?.branchCode, chassisType: ch?.chassisType, plateEnding, renewalMonth: plateEnding ? MONTHS[Number(plateEnding)] : undefined,
          category: (['Chassis', 'Trailer'].includes(r.subjectType) ? 'Regional' : 'Nationwide') as 'Regional' | 'Nationwide', onHire, clientCode: onHire ? ch?.currentClientCode : undefined, clientName: onHire ? clientName(ch?.currentClientCode) : undefined,
          renewalCostEff: r.renewalCost ?? defCost, responsibleName: db.users.find((u) => u.userId === r.responsible)?.name, lastNotice: r.notices?.[r.notices.length - 1],
        };
      }).filter((r) => (!f.branch || r.branchCode === f.branch) && (!f.window || r.window === f.window) && (!f.region || r.region === f.region) && (!f.unitType || r.subjectType === f.unitType) && (!f.plateEnding || r.plateEnding === f.plateEnding)
        && (!f.onHire || (f.onHire === 'yes') === r.onHire) && (!f.status || r.status === f.status) && (!f.from || (!!r.expiryDate && r.expiryDate >= f.from)) && (!f.to || (!!r.expiryDate && r.expiryDate <= f.to))).sort((a, b) => a.daysLeft - b.daysLeft));
    },
    async save(r: import('../shared').Registration, isNew: boolean) {
      requirePerm('reg.registration', isNew ? 'add' : 'edit');
      return tx(() => {
        if (!r.subjectId.trim()) throw new ApiError('VALIDATION_FAILED', 'Unit is required.', 422, { subjectId: 'Required' });
        if (isNew && db.registrations.some((x) => x.subjectId === r.subjectId)) throw new ApiError('DUPLICATE', `${r.subjectId} already has a registration record.`, 409, { subjectId: 'Duplicate' });
        if (!r.pending) {
          const miss = (['orNo', 'crNo', 'plateNo', 'issueDate', 'expiryDate'] as const).filter((k) => !String(r[k] ?? '').trim());
          if (miss.length) throw new ApiError('MISSING_ORCR', 'Missing OR/CR data: OR no., CR no., plate, issue and expiry dates are required (or mark the record Pending registration).', 422, Object.fromEntries(miss.map((k) => [k, 'Required'])));
          if (r.expiryDate <= r.issueDate) throw new ApiError('VALIDATION_FAILED', 'Expiry date must be after the issue date.', 422, { expiryDate: 'Must be after issue date' });
        }
        const ex = db.registrations.find((x) => x.id === r.id); const before = ex ? structuredClone(ex) : undefined;
        if (ex) Object.assign(ex, r); else db.registrations.unshift({ ...r, id: uid(), notices: [], responsible: r.responsible ?? me().userId });
        audit(isNew ? 'registration.created' : 'registration.updated', 'registration', r.subjectId, r, undefined, before); return true;
      });
    },
    async history(id: string) {
      requirePerm('reg.registration');
      return tx(() => { const r = db.registrations.find((x) => x.id === id); return { notices: [...(r?.notices ?? [])].reverse(), audit: db.audit.filter((a) => a.entityType === 'registration' && a.entityId === r?.subjectId).slice(0, 50) }; });
    },
    async attach(id: string, fileNames: string[]) {
      requirePerm('reg.registration', 'edit');
      return tx(() => { const r = db.registrations.find((x) => x.id === id)!; r.documents = [...r.documents, ...fileNames]; audit('registration.document_uploaded', 'registration', r.subjectId, { fileNames }); return r; });
    },
    async setFollowUp(id: string, input: { responsible?: string; followUp?: string; followUpDate?: string; renewalCost?: number }) {
      requirePerm('reg.registration', 'edit');
      return tx(() => { const r = db.registrations.find((x) => x.id === id)!; const before = { responsible: r.responsible, followUp: r.followUp, followUpDate: r.followUpDate, renewalCost: r.renewalCost }; Object.assign(r, input); audit('registration.follow_up', 'registration', r.subjectId, input, undefined, before); return r; });
    },
    async restartCycle(id: string) {
      requirePerm('reg.registration', 'edit');
      return tx(() => { const r = db.registrations.find((x) => x.id === id)!; r.lastNotifiedStage = undefined; r.escalatedAt = undefined; r.escalatedTo = undefined; r.notices = [...(r.notices ?? []), { at: nowIso(), stage: 'manual', recipients: 'Monitoring cycle restarted (90/30/14-day)' }]; audit('registration.cycle_restarted', 'registration', r.subjectId); return r; });
    },
    async resendNotice(id: string) {
      requirePerm('reg.registration', 'edit');
      return tx(() => {
        const r = db.registrations.find((x) => x.id === id)!; const d = daysBetween(nowIso(), new Date(r.expiryDate).toISOString());
        const recipients = d < 0 ? 'Regulatory + Operations Manager + Accounting (escalation)' : d <= 14 ? 'Operations + Sales' : 'Regulatory + Accounting';
        r.notices = [...(r.notices ?? []), { at: nowIso(), stage: 'manual', recipients: `Resent → ${recipients}` }];
        notify(d <= 14 && d >= 0 ? 'registration.expiring_14' : 'registration.expiring_90_30', `Registration ${d < 0 ? `expired ${-d} days ago` : `expiring in ${d} days`} (resent)`, `${r.subjectId} · plate ${r.plateNo}`, { link: '/regulatory' });
        audit('registration.notice_resent', 'registration', r.subjectId, { recipients }); return r;
      });
    },
    async renew(id: string, input: { orNo: string; newExpiry: string; cost: number }) {
      requirePerm('reg.registration', 'edit');
      return tx(() => { const r = db.registrations.find((x) => x.id === id)!; const before = { expiry: r.expiryDate, orNo: r.orNo }; if (input.newExpiry <= r.expiryDate) throw new ApiError('VALIDATION_FAILED', 'New expiry must be after the current expiry.', 422, { newExpiry: 'Invalid' }); r.orNo = input.orNo; r.issueDate = nowIso().slice(0, 10); r.expiryDate = input.newExpiry; r.renewalInProgress = false; r.lastNotifiedStage = undefined; r.escalatedAt = undefined; r.escalatedTo = undefined; if (input.cost) r.renewalCost = input.cost; r.notices = [...(r.notices ?? []), { at: nowIso(), stage: 'manual', recipients: 'Renewed — 90/30/14-day cycle restarted' }]; audit('registration.renewed', 'registration', r.subjectId, { ...input }, undefined, before); return r; });
    },
    async markInProgress(id: string) { return tx(() => { const r = db.registrations.find((x) => x.id === id)!; r.renewalInProgress = true; audit('registration.renewal_started', 'registration', r.subjectId); return r; }); },
    async runNotices() {
      requirePerm('reg.registration', 'edit');
      return tx(() => {
        let sent = 0;
        for (const r of db.registrations) {
          if (r.pending || !r.expiryDate) continue;
          const d = daysBetween(nowIso(), new Date(r.expiryDate).toISOString());
          if (d < 0 && !r.escalatedAt) {
            // Expired: escalate (proposed recipients — Q-REG-ESC) and record who/when so both compliance screens show the same thing.
            const to = 'Regulatory + Operations Manager + Accounting';
            r.escalatedAt = nowIso(); r.escalatedTo = to; r.lastNotifiedStage = '14'; r.notices = [...(r.notices ?? []), { at: nowIso(), stage: 'expired', recipients: `${to} (escalation)` }]; sent++;
            notify('registration.expired', `Registration EXPIRED ${-d} days — Gate Out blocked`, `${r.subjectId} · plate ${r.plateNo} · expired ${r.expiryDate}`, { link: '/regulatory/compliance', extraUsers: db.users.filter((u) => u.realm === 'INTERNAL' && u.roles.some((x) => ['REGULATORY', 'OPS_MANAGER', 'ACCOUNTING'].includes(x))).map((u) => u.userId) });
            audit('registration.escalated', 'registration', r.subjectId, { to }); continue;
          }
          const stage = d <= 14 && d >= 0 ? '14' : d <= 30 && d >= 0 ? '30' : d <= 90 && d >= 0 ? '90' : undefined;
          if (!stage || r.lastNotifiedStage === stage) continue;
          r.lastNotifiedStage = stage as '90' | '30' | '14'; sent++;
          r.notices = [...(r.notices ?? []), { at: nowIso(), stage, recipients: stage === '14' ? 'Operations + Sales' : 'Regulatory + Accounting' }];
          notify(stage === '14' ? 'registration.expiring_14' : 'registration.expiring_90_30', `Registration expiring in ${d} days`, `${r.subjectId} · plate ${r.plateNo} · expires ${r.expiryDate}`, { link: '/regulatory' });
        }
        return sent;
      });
    },
  },

  // ── Notification rules (M14) ─────────────────────────────────────────────
  notifications: {
    async rules() { requirePerm('not.rules'); applyAdminSeed(db); return tx(() => db.notificationRules); },
    async saveRule(r: NotificationRule) {
      requirePerm('not.rules', 'edit');
      return tx(() => {
        if (r.mode === 'Repeat until ack' && !(Number(r.repeatMinutes) > 0)) throw new ApiError('VALIDATION_FAILED', 'Set the repeat interval (minutes) for repeat-until-acknowledged rules.', 422, { repeatMinutes: 'Required' });
        if (r.escalationHours && !r.escalateTo?.length) throw new ApiError('VALIDATION_FAILED', 'Choose who receives the escalation when the timer lapses.', 422, { escalateTo: 'Required' });
        const badEsc = (r.escalateTo ?? []).filter((x) => !(x in ROLE_TEMPLATES)); if (badEsc.length) throw new ApiError('VALIDATION_FAILED', `Undefined escalation role(s): ${badEsc.join(', ')}`, 422);
        if (r.template && (!r.template.subject.trim() || !r.template.body.trim())) throw new ApiError('VALIDATION_FAILED', 'The message template needs a subject and a body.', 422, { template: 'Subject and body required' });
        const bad = r.recipientRoles.filter((x) => !(x in ROLE_TEMPLATES)); if (bad.length) throw new ApiError('VALIDATION_FAILED', `Undefined recipient role(s): ${bad.join(', ')}`, 422);
        if (!r.channels.length) throw new ApiError('VALIDATION_FAILED', 'Select at least one channel.', 422);
        const i = db.notificationRules.findIndex((x) => x.id === r.id); const before = db.notificationRules[i];
        if (i >= 0) db.notificationRules[i] = r; else db.notificationRules.push(r);
        audit('notification_rule.saved', 'notification_rule', r.id, r, undefined, before); return r;
      });
    },
    async test(id: string) { return tx(() => { const r = db.notificationRules.find((x) => x.id === id)!; db.notifications.unshift({ id: uid(), at: nowIso(), title: `[TEST] ${r.description}`, body: `Channels: ${r.channels.join(' + ')} · ${r.mode}`, read: false, requiresAck: r.mode === 'Repeat until ack', userId: me().userId }); return true; }); },
  },

  // ── Reports & dashboards (M15) ──────────────────────────────────────────
  reports: {
    /** SCR-45. Scope: branch or region (chassis, invoices, rescues, job orders); period: from–to (default month to date) with the previous period of equal length for comparison. */
    async executive(f: { branch?: string; region?: string; from?: string; to?: string } = {}) {
      requirePerm('rpt.executive'); runAutoHold();
      return tx(() => {
        const today = nowIso().slice(0, 10);
        const from = f.from || `${today.slice(0, 8)}01`, to = f.to || today;
        const len = Math.max(1, daysBetween(new Date(from).toISOString(), new Date(to).toISOString()) + 1);
        const back = (n: number) => new Date(new Date(from).getTime() - n * 86_400_000).toISOString().slice(0, 10);
        const pTo = back(1), pFrom = back(len);
        const inP = (d: string | undefined, a: string, b: string) => !!d && d.slice(0, 10) >= a && d.slice(0, 10) <= b;
        const brOk = (b?: string) => (!f.branch || b === f.branch) && (!f.region || db.branches.find((x) => x.code === b)?.region === f.region);
        const chassis = db.chassis.filter((c) => brOk(c.branchCode));
        const fleet = chassis.length;
        const by = (s: string) => chassis.filter((c) => c.status === s).length;
        const aging = agingFor();
        const regRows = db.registrations.filter((r) => brOk(r.branchCode ?? db.chassis.find((c) => c.chassisNo === r.subjectId)?.branchCode));
        const regs = regRows.filter((r) => !r.pending && r.expiryDate).map((r) => daysBetween(nowIso(), new Date(r.expiryDate).toISOString()));
        const invs = db.invoices.filter((i) => i.status !== 'Draft' && brOk(i.branchCode));
        const billed = (a: string, b: string) => round2(invs.filter((i) => inP(i.issuedAt, a, b)).reduce((s, i) => s + i.total, 0));
        const collected = (a: string, b: string) => round2(db.receipts.filter((r) => inP(r.date, a, b) && (!f.branch && !f.region || r.applications.some((x) => invs.some((i) => i.invoiceNo === x.invoiceNo)))).reduce((s, r) => s + r.amount, 0));
        const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : undefined);
        const partner = chassis.filter((c) => c.owner !== 'DELWATER').length;
        const low = db.stock.filter((s) => s.qtyOnHand <= (db.parts.find((p) => p.partCode === s.partCode)?.lowStockThreshold ?? 0)).length;
        const onHireUnits = chassis.filter((c) => c.status === 'On Hire');
        const rescues = db.rescues.filter((r) => brOk(r.branchCode));
        const responded = rescues.filter((r) => r.dispatchedAt);
        const rescueCost = (a: string, b: string) => round2(rescues.filter((r) => r.status === 'Completed' && inP(r.completedAt, a, b)).reduce((s, r) => s + (r.total ?? 0), 0));
        const signed = (a: string, b: string) => db.contracts.filter((c) => inP(c.createdAt, a, b)).length;
        const newCl = (a: string, b: string) => db.clients.filter((c) => inP(c.createdAt, a, b)).length;
        const cur = { billed: billed(from, to), collected: collected(from, to), rescueCost: rescueCost(from, to), signed: signed(from, to), newClients: newCl(from, to) };
        const prev = { billed: billed(pFrom, pTo), collected: collected(pFrom, pTo), rescueCost: rescueCost(pFrom, pTo), signed: signed(pFrom, pTo), newClients: newCl(pFrom, pTo) };
        return {
          period: { from, to, prevFrom: pFrom, prevTo: pTo },
          fleet, available: by('Available'), onHire: by('On Hire'), breakdown: by('Breakdown') + by('In Repair'), utilisation: fleet ? Math.round((by('On Hire') / fleet) * 1000) / 10 : 0,
          statusMix: ['Available', 'Allocated', 'On Hire', 'Breakdown', 'In Repair', 'Rescue', 'Parked'].map((s) => ({ status: s, count: by(s) })),
          utilByContractType: (Object.keys(CONTRACT_TYPES) as ContractType[]).map((t) => { const n = onHireUnits.filter((c) => db.contracts.find((k) => k.contractNo === c.currentContractNo)?.contractType === t).length; return { type: t, units: n, pct: fleet ? Math.round((n / fleet) * 1000) / 10 : 0 }; }),
          utilByClient: [...new Set(onHireUnits.map((c) => c.currentClientCode ?? '—'))].map((cc) => { const n = onHireUnits.filter((c) => (c.currentClientCode ?? '—') === cc).length; return { clientCode: cc, clientName: clientName(cc), units: n, pct: fleet ? Math.round((n / fleet) * 1000) / 10 : 0 }; }).sort((a, b) => b.units - a.units),
          openJos: db.jobOrders.filter((j) => !j.status.startsWith('Closed') && brOk(j.branchCode)).length,
          billedMtd: cur.billed, collectedMtd: cur.collected, billedDelta: pct(cur.billed, prev.billed), collectedDelta: pct(cur.collected, prev.collected), prev,
          ar: aging.total, overduePct: aging.total ? Math.round(((aging.total - aging.current) / aging.total) * 1000) / 10 : 0, aging,
          onHold: db.clients.filter((c) => c.status === 'Hold').length, negativeWallets: db.ewallets.filter((w) => w.balance < 0).length, walletTotal: round2(db.ewallets.reduce((a, w) => a + w.balance, 0)),
          liftPending: db.workflows.filter((w) => w.matrixCode === 'HOLD_LIFT' && w.status === 'Pending').length,
          collectionStages: (['SOA Sent', '1st Reminder', '2nd Reminder', 'Demand Letter'] as const).map((s) => ({ stage: s, count: db.collections.filter((c) => c.stage === s).length })),
          rescueOpen: rescues.filter(rescueIsOpen).length, rescueCompleted: rescues.filter((r) => r.status === 'Completed').length,
          rescueResponseHrs: responded.length ? Math.round((responded.reduce((a, r) => a + (new Date(r.dispatchedAt!).getTime() - new Date(r.requestedAt).getTime()), 0) / responded.length / 3_600_000) * 10) / 10 : undefined,
          rescueCost: cur.rescueCost, rescueCostDelta: pct(cur.rescueCost, prev.rescueCost),
          regExpired: regs.filter((d) => d < 0).length, reg14: regs.filter((d) => d >= 0 && d <= 14).length, reg30: regs.filter((d) => d > 14 && d <= 30).length, reg90: regs.filter((d) => d > 30 && d <= 90).length,
          regCurrent: regs.filter((d) => d > 90).length, regPending: regRows.filter((r) => r.pending || !r.expiryDate).length,
          ownership: { company: fleet - partner, partner }, lowStock: low, pendingPos: db.pos.filter((p) => ['Issued', 'Partially Received'].includes(p.status)).length,
          pmDue: db.assets.filter((a) => a.nextPmDate && new Date(a.nextPmDate) < new Date(Date.now() + 7 * 86400000)).length,
          newClients: cur.newClients, newClientsDelta: pct(cur.newClients, prev.newClients),
          activeContracts: db.contracts.filter((c) => c.status === 'Active').length, contractsSigned: cur.signed, contractsSignedDelta: pct(cur.signed, prev.signed),
          pipeline: db.clients.filter((c) => c.status === 'Draft').length + db.accreditations.filter((a) => !['Approved', 'Rejected'].includes(a.status)).length,
          salesActivities: db.salesActivities.filter((s) => inP(s.date, from, to)).length,
        };
      });
    },
    /** DBL-RPT-010…016 Standard Report Viewer datasets. Rows carry _date/_branch/_client for the shared filter panel. */
    async run(code: string, f: { from?: string; to?: string; branch?: string; client?: string } = {}) {
      const item = api.reports.catalog().find((r) => r.code === code);
      if (!item) throw new ApiError('NOT_FOUND', `Report ${code} not found.`, 404);
      requirePerm(item.perm);
      if (item.status !== 'Available' || !item.dataset) throw new ApiError('INVALID_STATE', 'This report is pending scope confirmation (Phase 2).', 409);
      type Col = { key: string; label: string; money?: boolean; num?: boolean };
      const c = (key: string, label: string, kind?: 'money' | 'num'): Col => ({ key, label, money: kind === 'money', num: kind === 'num' });
      const cn = (code?: string) => clientName(code);
      const un = (id?: string) => db.users.find((u) => u.userId === id)?.name ?? id ?? '—';
      const regRows = () => db.registrations.map((r) => { const ch = db.chassis.find((x) => x.chassisNo === r.subjectId); const d = r.pending || !r.expiryDate ? undefined : daysBetween(nowIso(), new Date(r.expiryDate).toISOString()); return { r, ch, d, br: r.branchCode ?? ch?.branchCode }; });
      const MONTHS = ['Oct', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
      const defCost = Number(S()['reg.renewal_cost_default'] ?? 1800);
      const D: Record<string, () => { cols: Col[]; rows: Record<string, unknown>[] }> = {
        alloc: () => ({ cols: [c('chassisNo', 'Chassis'), c('branch', 'Branch'), c('type', 'Equipment type'), c('client', 'Client'), c('contract', 'Contract'), c('date', 'Allocated'), c('expectedReturn', 'Expected return')],
          rows: db.chassis.filter((x) => x.allocation).map((x) => ({ chassisNo: x.chassisNo, branch: x.branchCode, type: db.equipmentTypes.find((e) => e.code === x.chassisType)?.name, client: cn(x.allocation!.clientCode), contract: x.allocation!.contractNo, date: x.allocation!.date.slice(0, 10), expectedReturn: x.allocation!.expectedReturn?.slice(0, 10), _date: x.allocation!.date, _branch: x.branchCode, _client: x.allocation!.clientCode })) }),
        rescue: () => ({ cols: [c('rescueNo', 'Rescue no.'), c('requested', 'Requested'), c('client', 'Client'), c('chassisNo', 'Chassis'), c('location', 'Location'), c('status', 'Status'), c('urgent', 'Urgent'), c('responseHrs', 'Response (h)', 'num'), c('total', 'Charge', 'money')],
          rows: db.rescues.map((r) => ({ rescueNo: r.rescueNo, requested: r.requestedAt.slice(0, 16).replace('T', ' '), client: cn(r.clientCode), chassisNo: r.chassisNo, location: r.locationText, status: r.status, urgent: r.urgent ? 'Yes' : 'No', responseHrs: r.dispatchedAt ? Math.round((new Date(r.dispatchedAt).getTime() - new Date(r.requestedAt).getTime()) / 360000) / 10 : undefined, total: r.total, _date: r.requestedAt, _branch: r.branchCode, _client: r.clientCode })) }),
        repair: () => ({ cols: [c('joNo', 'JO no.'), c('chassisNo', 'Chassis'), c('branch', 'Branch'), c('source', 'Source'), c('categories', 'Categories'), c('status', 'Status'), c('created', 'Created'), c('chargeable', 'Chargeable')],
          rows: db.jobOrders.map((j) => ({ joNo: j.joNo, chassisNo: j.chassisNo, branch: j.branchCode, source: j.source, categories: j.categories.join(', '), status: j.status, created: j.createdAt.slice(0, 10), chargeable: j.chargeable ? 'Yes' : 'No', _date: j.createdAt, _branch: j.branchCode })) }),
        joaudit: () => ({ cols: [c('joNo', 'JO no.'), c('chassisNo', 'Chassis'), c('status', 'Status'), c('parts', 'Parts cost', 'money'), c('labor', 'Labor cost', 'money'), c('total', 'Total', 'money'), c('createdBy', 'Created by'), c('approvedBy', 'Approved by'), c('confirmedBy', 'Confirmed by'), c('closed', 'Closed')],
          rows: db.jobOrders.map((j) => { const parts = j.bom.reduce((a, b) => a + b.qty * b.unitCost, 0), labor = j.labor.reduce((a, l) => a + l.hours * l.rate, 0); return { joNo: j.joNo, chassisNo: j.chassisNo, status: j.status, parts, labor, total: parts + labor, createdBy: un(j.createdBy), approvedBy: un(j.approvedBy), confirmedBy: un(j.confirmedBy), closed: j.closedAt?.slice(0, 10), _date: j.createdAt, _branch: j.branchCode }; }) }),
        equip: () => ({ cols: [c('chassisNo', 'Chassis'), c('type', 'Equipment type'), c('branch', 'Branch'), c('status', 'Status'), c('assessment', 'Assessment'), c('owner', 'Owner'), c('since', 'Status since'), c('days', 'Days in status', 'num')],
          rows: db.chassis.map((x) => ({ chassisNo: x.chassisNo, type: db.equipmentTypes.find((e) => e.code === x.chassisType)?.name, branch: x.branchCode, status: x.status, assessment: x.generalAssessment, owner: x.owner, since: x.statusSince.slice(0, 10), days: Math.max(0, daysBetween(x.statusSince, nowIso())), _branch: x.branchCode, _client: x.currentClientCode })) }),
        partner: () => ({ cols: [c('chassisNo', 'Chassis'), c('owner', 'Partner'), c('ownerEq', "Owner's equipment #"), c('branch', 'Branch'), c('status', 'Status'), c('client', 'Current client')],
          rows: db.chassis.filter((x) => x.owner !== 'DELWATER').map((x) => ({ chassisNo: x.chassisNo, owner: x.owner, ownerEq: x.ownerEquipmentNo, branch: x.branchCode, status: x.status, client: x.currentClientCode ? cn(x.currentClientCode) : '—', _branch: x.branchCode, _client: x.currentClientCode })) }),
        lead: () => ({ cols: [c('clientCode', 'Code'), c('name', 'Prospect / client'), c('status', 'Status'), c('source', 'Source'), c('ae', 'Account executive'), c('created', 'Created')],
          rows: db.clients.filter((x) => ['Draft', 'Prospect', 'Lead'].includes(x.status)).map((x) => ({ clientCode: x.clientCode, name: x.clientName, status: x.status, source: x.registrationSource, ae: un(x.aeAssigned), created: x.createdAt.slice(0, 10), _date: x.createdAt, _branch: x.branchCode, _client: x.clientCode })) }),
        accred: () => ({ cols: [c('id', 'Ref'), c('client', 'Client'), c('status', 'Status'), c('submitted', 'Submitted'), c('grade', 'Grade'), c('result', 'C&C result')],
          rows: db.accreditations.map((a) => ({ id: a.id, client: cn(a.clientCode), status: a.status, submitted: a.submittedAt.slice(0, 10), grade: a.bici.grade, result: a.bici.result, _date: a.submittedAt, _client: a.clientCode })) }),
        contract: () => ({ cols: [c('contractNo', 'Contract'), c('client', 'Client'), c('type', 'Type'), c('cls', 'Class'), c('effective', 'Effective'), c('expiry', 'Expiry'), c('units', 'Units', 'num'), c('status', 'Status')],
          rows: db.contracts.map((k) => ({ contractNo: k.contractNo, client: cn(k.clientCode), type: k.contractType, cls: k.class, effective: k.effectiveDate, expiry: k.expiryDate ?? 'Open-ended', units: k.unitQty, status: k.status, _date: k.effectiveDate, _client: k.clientCode })) }),
        ledger: () => ({ cols: [c('txnNo', 'Txn no.'), c('at', 'Date'), c('type', 'Type'), c('partCode', 'Part'), c('qty', 'Qty', 'num'), c('wh', 'Warehouse'), c('ref', 'Reference'), c('balance', 'Balance after', 'num'), c('entity', 'Entity')],
          rows: db.stockTxns.map((t) => ({ txnNo: t.txnNo, at: t.at.slice(0, 10), type: t.type, partCode: t.partCode, qty: t.qty, wh: t.fromWarehouse, ref: t.referenceId ? `${t.referenceType ?? ''} ${t.referenceId}` : '', balance: t.balanceAfter, entity: t.entityCode, _date: t.at })) }),
        invaudit: () => ({ cols: [c('partCode', 'Part'), c('description', 'Description'), c('wh', 'Warehouse'), c('system', 'System qty', 'num'), c('counted', 'Counted', 'num'), c('variance', 'Variance', 'num'), c('countDate', 'Last count')],
          rows: db.stock.filter((s) => s.lastPhysicalCount != null).map((s) => ({ partCode: s.partCode, description: db.parts.find((p) => p.partCode === s.partCode)?.description, wh: s.warehouseCode, system: s.qtyOnHand, counted: s.lastPhysicalCount, variance: (s.lastPhysicalCount ?? 0) - s.qtyOnHand, countDate: s.lastCountDate, _date: s.lastCountDate })) }),
        po: () => ({ cols: [c('poNo', 'PO no.'), c('prNo', 'PR no.'), c('vendor', 'Vendor'), c('created', 'Issued'), c('delivery', 'Delivery'), c('lines', 'Lines', 'num'), c('ordered', 'Qty ordered', 'num'), c('delivered', 'Qty delivered', 'num'), c('total', 'PO value', 'money'), c('status', 'Status')],
          rows: db.pos.map((p) => ({ poNo: p.poNo, prNo: p.prNo, vendor: db.vendors.find((v) => v.vendorId === p.vendorId)?.name, created: p.createdAt.slice(0, 10), delivery: p.deliveryDate, lines: p.lines.length, ordered: p.lines.reduce((a, l) => a + l.qty, 0), delivered: p.lines.reduce((a, l) => a + l.qtyReceived, 0), total: p.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0), status: p.status, _date: p.createdAt })) }),
        rr: () => ({ cols: [c('rrNo', 'RR no.'), c('poNo', 'PO no.'), c('date', 'Received'), c('wh', 'Warehouse'), c('received', 'Qty received', 'num'), c('rejected', 'Qty rejected', 'num'), c('discrepancy', 'Discrepancy')],
          rows: db.rrs.map((r) => ({ rrNo: r.rrNo, poNo: r.poNo, date: r.receivedDate, wh: r.warehouseCode, received: r.lines.reduce((a, l) => a + l.qtyReceived, 0), rejected: r.lines.reduce((a, l) => a + l.qtyRejected, 0), discrepancy: r.discrepancy ? 'Variance' : 'Matched', _date: r.receivedDate })) }),
        regbudget: () => { const rows = regRows().filter((x) => x.r.plateNo); return { cols: [c('digit', 'Plate ending'), c('month', 'Renewal month'), c('units', 'Units', 'num'), c('cost', 'Forecast cost', 'money')],
          rows: '1234567890'.split('').map((dg) => { const u = rows.filter((x) => x.r.plateNo.replace(/\D/g, '').slice(-1) === dg); return { digit: dg, month: MONTHS[Number(dg)], units: u.length, cost: u.reduce((a, x) => a + (x.r.renewalCost ?? defCost), 0) }; }) }; },
        regd: () => ({ cols: [c('unit', 'Unit'), c('type', 'Unit type'), c('plate', 'Plate'), c('orNo', 'OR no.'), c('crNo', 'CR no.'), c('expiry', 'Expiry'), c('days', 'Days left', 'num'), c('branch', 'Branch'), c('region', 'Region')],
          rows: regRows().filter((x) => x.d != null && x.d >= 0).map((x) => ({ unit: x.r.subjectId, type: x.r.subjectType, plate: x.r.plateNo, orNo: x.r.orNo, crNo: x.r.crNo, expiry: x.r.expiryDate, days: x.d, branch: x.br, region: x.r.region, _date: x.r.expiryDate, _branch: x.br })) }),
        unreg: () => ({ cols: [c('unit', 'Unit'), c('type', 'Unit type'), c('plate', 'Plate'), c('state', 'Status'), c('expiry', 'Expired on'), c('days', 'Days overdue', 'num'), c('branch', 'Branch'), c('followUp', 'Follow-up')],
          rows: regRows().filter((x) => x.d == null || x.d < 0).map((x) => ({ unit: x.r.subjectId, type: x.r.subjectType, plate: x.r.plateNo || '—', state: x.d == null ? 'Pending registration' : 'Expired', expiry: x.r.expiryDate || '—', days: x.d == null ? undefined : -x.d, branch: x.br, followUp: x.r.followUp, _branch: x.br })) }),
        sinv: () => ({ cols: [c('invoiceNo', 'Invoice no.'), c('client', 'Client'), c('issued', 'Issued'), c('period', 'Period'), c('subtotal', 'Subtotal', 'money'), c('vat', 'VAT', 'money'), c('total', 'Total', 'money'), c('status', 'Status')],
          rows: db.invoices.map((i) => ({ invoiceNo: i.invoiceNo, client: cn(i.clientCode), issued: i.issuedAt.slice(0, 10), period: `${i.periodStart} – ${i.periodEnd}`, subtotal: i.subtotal, vat: i.vat, total: i.total, status: i.status === 'Draft' ? 'Draft' : paymentStatus(i), _date: i.issuedAt, _branch: i.branchCode, _client: i.clientCode })) }),
        revenue: () => ({ cols: [c('invoiceNo', 'Invoice no.'), c('client', 'Client'), c('contractType', 'Contract type'), c('billType', 'Bill type'), c('issued', 'Issued'), c('revenue', 'Revenue (net of VAT)', 'money')],
          rows: db.invoices.filter((i) => i.status !== 'Draft').map((i) => ({ invoiceNo: i.invoiceNo, client: cn(i.clientCode), contractType: db.contracts.find((k) => k.contractNo === i.contractNo)?.contractType ?? '—', billType: i.billType, issued: i.issuedAt.slice(0, 10), revenue: i.subtotal, _date: i.issuedAt, _branch: i.branchCode, _client: i.clientCode })) }),
        orsum: () => ({ cols: [c('receiptNo', 'Receipt no.'), c('type', 'Type'), c('date', 'Date'), c('client', 'Client'), c('amount', 'Amount', 'money'), c('method', 'Method'), c('reference', 'Reference'), c('by', 'Issued by')],
          rows: db.receipts.map((r) => ({ receiptNo: r.receiptNo, type: r.type, date: r.date, client: cn(r.clientCode), amount: r.amount, method: r.method, reference: r.reference, by: un(r.by), _date: r.date, _client: r.clientCode })) }),
        cm: () => ({ cols: [c('memoNo', 'Memo no.'), c('client', 'Client'), c('invoice', 'Invoice'), c('ref', 'Reference'), c('amount', 'Amount', 'money'), c('reason', 'Reason'), c('status', 'Status'), c('created', 'Created')],
          rows: db.memos.filter((m) => m.type === 'Credit').map((m) => ({ memoNo: m.memoNo, client: cn(m.clientCode), invoice: m.referenceInvoiceNo, ref: `${m.referenceType} ${m.referenceId ?? ''}`, amount: m.amount, reason: m.reason, status: m.status, created: m.createdAt.slice(0, 10), _date: m.createdAt, _client: m.clientCode })) }),
        dm: () => ({ cols: [c('memoNo', 'Memo no.'), c('client', 'Client'), c('invoice', 'Invoice'), c('ref', 'Reference'), c('amount', 'Amount', 'money'), c('reason', 'Reason'), c('status', 'Status'), c('created', 'Created')],
          rows: db.memos.filter((m) => m.type === 'Debit').map((m) => ({ memoNo: m.memoNo, client: cn(m.clientCode), invoice: m.referenceInvoiceNo, ref: `${m.referenceType} ${m.referenceId ?? ''}`, amount: m.amount, reason: m.reason, status: m.status, created: m.createdAt.slice(0, 10), _date: m.createdAt, _client: m.clientCode })) }),
        ewl: () => ({ cols: [c('id', 'Txn'), c('at', 'Date'), c('client', 'Client'), c('type', 'Type'), c('amount', 'Amount', 'money'), c('balance', 'Balance after', 'money'), c('ref', 'Reference')],
          rows: db.ewalletTxns.map((t) => ({ id: t.id, at: t.at.slice(0, 10), client: cn(t.clientCode), type: t.type, amount: t.amount, balance: t.balanceAfter, ref: `${t.referenceType} ${t.referenceId ?? ''}`, _date: t.at, _client: t.clientCode })) }),
        cashbond: () => ({ cols: [c('id', 'Ref'), c('client', 'Client'), c('contract', 'Contract'), c('amount', 'Amount', 'money'), c('received', 'Received'), c('receipt', 'Receipt'), c('status', 'Status')],
          rows: db.cashBonds.map((b) => ({ id: b.id, client: cn(b.clientCode), contract: b.contractNo, amount: b.amount, received: b.dateReceived, receipt: b.receiptRef, status: b.status, _date: b.dateReceived, _client: b.clientCode })) }),
        ap: () => ({ cols: [c('doc', 'Document'), c('kind', 'Kind'), c('payee', 'Payee / vendor'), c('ref', 'Reference'), c('amount', 'Amount', 'money'), c('due', 'Due / invoice date'), c('status', 'Status')],
          rows: [...db.paymentRequests.map((p) => ({ doc: p.docNo, kind: p.type, payee: p.payee, ref: `${p.referenceType} ${p.referenceId}`, amount: p.amount, due: p.dueDate || '—', status: p.status, _date: p.createdAt })),
            ...db.vendorInvoices.map((v) => ({ doc: v.invoiceNo, kind: 'Vendor invoice', payee: db.vendors.find((x) => x.vendorId === v.vendorId)?.name, ref: `PO ${v.poNo}`, amount: v.amount, due: v.invoiceDate, status: v.status, _date: v.invoiceDate }))] }),
        soa: () => ({ cols: [c('client', 'Client'), c('invoiceNo', 'Invoice no.'), c('issued', 'Issued'), c('due', 'Due'), c('total', 'Total', 'money'), c('paid', 'Paid', 'money'), c('balance', 'Balance', 'money'), c('overdue', 'Days overdue', 'num')],
          rows: db.invoices.filter((i) => i.status !== 'Draft' && balance(i) > 0).map((i) => ({ client: cn(i.clientCode), invoiceNo: i.invoiceNo, issued: i.issuedAt.slice(0, 10), due: i.dueDate, total: i.total, paid: i.amountPaid, balance: balance(i), overdue: daysOverdue(i), _date: i.issuedAt, _branch: i.branchCode, _client: i.clientCode })) }),
        monthcoll: () => ({ cols: [c('month', 'Month'), c('receiptNo', 'Receipt no.'), c('date', 'Date'), c('client', 'Client'), c('method', 'Method'), c('amount', 'Amount', 'money')],
          rows: db.receipts.map((r) => ({ month: r.date.slice(0, 7), receiptNo: r.receiptNo, date: r.date, client: cn(r.clientCode), method: r.method, amount: r.amount, _date: r.date, _client: r.clientCode })) }),
        aop: () => ({ cols: [c('receiptNo', 'Receipt no.'), c('date', 'Date'), c('client', 'Client'), c('invoiceNo', 'Applied to invoice'), c('applied', 'Applied', 'money')],
          rows: db.receipts.flatMap((r) => r.applications.map((a) => ({ receiptNo: r.receiptNo, date: r.date, client: cn(r.clientCode), invoiceNo: a.invoiceNo, applied: a.amount, _date: r.date, _client: r.clientCode }))) }),
        unapplied: () => ({ cols: [c('receiptNo', 'Receipt no.'), c('date', 'Date'), c('client', 'Client'), c('amount', 'Receipt amount', 'money'), c('unapplied', 'Unapplied', 'money')],
          rows: db.receipts.filter((r) => r.unapplied > 0).map((r) => ({ receiptNo: r.receiptNo, date: r.date, client: cn(r.clientCode), amount: r.amount, unapplied: r.unapplied, _date: r.date, _client: r.clientCode })) }),
        billdetail: () => ({ cols: [c('invoiceNo', 'Invoice no.'), c('client', 'Client'), c('lineType', 'Line type'), c('description', 'Description'), c('chassisNo', 'Chassis'), c('days', 'Days', 'num'), c('rate', 'Rate', 'money'), c('amount', 'Amount', 'money')],
          rows: db.invoices.flatMap((i) => i.lines.map((l) => ({ invoiceNo: i.invoiceNo, client: cn(i.clientCode), lineType: l.lineType, description: l.description, chassisNo: l.chassisNo, days: l.days, rate: l.rate, amount: l.amount, _date: i.issuedAt, _branch: i.branchCode, _client: i.clientCode }))) }),
        forecast: () => ({ cols: [c('week', 'Expected week (due)'), c('client', 'Client'), c('invoiceNo', 'Invoice no.'), c('due', 'Due date'), c('balance', 'Expected collection', 'money'), c('state', 'Status')],
          rows: db.invoices.filter((i) => i.status !== 'Draft' && balance(i) > 0).map((i) => ({ week: `${i.dueDate.slice(0, 4)}-W${String(Math.ceil((daysBetween(new Date(`${i.dueDate.slice(0, 4)}-01-01`).toISOString(), new Date(i.dueDate).toISOString()) + 1) / 7)).padStart(2, '0')}`, client: cn(i.clientCode), invoiceNo: i.invoiceNo, due: i.dueDate, balance: balance(i), state: paymentStatus(i), _date: i.dueDate, _branch: i.branchCode, _client: i.clientCode })).sort((a, b) => a.due.localeCompare(b.due)) }),
      };
      await delay();
      const out = D[item.dataset]();
      const rows = out.rows.filter((r) => (!f.branch || !r._branch || r._branch === f.branch) && (!f.client || !r._client || r._client === f.client) && (!f.from || !r._date || String(r._date).slice(0, 10) >= f.from) && (!f.to || !r._date || String(r._date).slice(0, 10) <= f.to));
      audit('report.run', 'report', code, f); persist();
      return structuredClone({ report: item, columns: out.cols, rows });
    },
    /** One code scheme mapped to the FRS: DBL-RPT-<FRS group>-<nn>. `dataset` opens the Standard Report Viewer; `link` opens the module view. */
    catalog() {
      type Item = { code: string; frs: string; name: string; module: string; description: string; perm: string; link?: string; dataset?: string; restricted?: boolean; status: 'Available' | 'Phase 2 / pending scope' };
      const A = (code: string, frs: string, name: string, module: string, perm: string, description: string, o: Partial<Item> = {}): Item => ({ code, frs, name, module, perm, description, status: 'Available', ...o });
      const P2 = (code: string, frs: string, name: string, module: string, perm: string, description: string): Item => ({ code, frs, name, module, perm, description, status: 'Phase 2 / pending scope' });
      return [
        A('DBL-RPT-001', 'DBL-RPT-001', 'Executive dashboard', 'Executive', 'rpt.executive', 'Consolidated KPIs across operations, sales, inventory, finance, C&C and regulatory.', { link: '/reports/executive', restricted: true }),
        A('DBL-RPT-005', 'DBL-RPT-005', 'Rescue & repair KPIs', 'Operations', 'rescue.request', 'Open and completed rescues, response time and repair throughput.', { link: '/rescue/dashboard' }),
        A('DBL-RPT-008', 'DBL-RPT-008 / DBL-REG-006', 'Regulatory compliance dashboard', 'Regulatory', 'reg.compliance', 'Registered, near-expiry, expired and pending by region with nationwide rollup.', { link: '/regulatory/compliance' }),
        A('DBL-RPT-010-01', 'DBL-RPT-010', 'Daily Chassis Inventory Report (DCIR)', 'Operations', 'alloc.dcir', 'Daily chassis count by yard / repair category and branch.', { link: '/allocation/dcir' }),
        A('DBL-RPT-010-02', 'DBL-RPT-010', 'Chassis allocation report', 'Operations', 'alloc.board', 'Allocated chassis with client, contract and expected return.', { dataset: 'alloc' }),
        A('DBL-RPT-010-03', 'DBL-RPT-010', 'Rescue tracker', 'Operations', 'rescue.request', 'Every rescue request with status, response time and charge.', { dataset: 'rescue' }),
        A('DBL-RPT-010-04', 'DBL-RPT-010', 'Repair tracker', 'Operations', 'repair.jo', 'Job orders by chassis, source, category and status.', { dataset: 'repair' }),
        A('DBL-RPT-010-05', 'DBL-RPT-010', 'EIR / gate movements register', 'Operations', 'gate.eir', 'Equipment Interchange Receipts and gate in/out movements.', { link: '/gate/eir' }),
        A('DBL-RPT-010-06', 'DBL-RPT-010', 'Equipment status report', 'Operations', 'chassis.chassis', 'Fleet by status, assessment and days in status.', { dataset: 'equip' }),
        A('DBL-RPT-010-07', 'DBL-RPT-010', 'Chassis partner report', 'Operations', 'chassis.chassis', 'Partner-owned chassis (BR-13) with current deployment.', { dataset: 'partner' }),
        A('DBL-RPT-010-08', 'DBL-RPT-010', 'Laborer / capacity / efficiency', 'Operations', 'repair.labor_reports', 'Labour hours, capacity and efficiency by worker.', { link: '/repair/reports' }),
        A('DBL-RPT-010-09', 'DBL-RM-009', 'Job order export for auditors', 'Operations', 'repair.jo', 'Job orders with parts and labour cost, approver and confirmer (audit export).', { dataset: 'joaudit', restricted: true }),
        A('DBL-RPT-011-01', 'DBL-RPT-011', 'Lead report', 'Sales', 'clients.client', 'Prospects and draft clients in the pipeline by account executive.', { dataset: 'lead' }),
        A('DBL-RPT-011-02', 'DBL-RPT-011', 'Accreditation report', 'Sales', 'clients.accreditation', 'Accreditation applications with C&C grade and result.', { dataset: 'accred' }),
        A('DBL-RPT-011-03', 'DBL-RPT-011', 'Contract report', 'Sales', 'clients.contract', 'Contracts by type (QLP / SPL / LTL), class, term and status.', { dataset: 'contract' }),
        A('DBL-RPT-011-04', 'DBL-RPT-011', 'Sales performance', 'Sales', 'clients.sales', 'AE activity, new clients and contracts.', { link: '/clients/sales' }),
        A('DBL-RPT-012-01', 'DBL-RPT-012', 'Inventory summary (stock levels, low stock)', 'Inventory', 'inv.balance', 'On-hand balances by warehouse with low-stock flags.', { link: '/inventory' }),
        A('DBL-RPT-012-02', 'DBL-RPT-012', 'Stock ledger', 'Inventory', 'inv.txn', 'Every stock movement with running balance and reference.', { dataset: 'ledger' }),
        A('DBL-RPT-012-03', 'DBL-RPT-012', 'Inventory audit (count variance)', 'Inventory', 'inv.balance', 'Physical count versus system quantity.', { dataset: 'invaudit' }),
        A('DBL-RPT-012-04', 'DBL-RPT-012', 'Purchase order report', 'Inventory', 'prc.po', 'POs with ordered vs delivered quantities and value.', { dataset: 'po' }),
        A('DBL-RPT-012-05', 'DBL-RPT-012', 'Receiving report register', 'Inventory', 'prc.rr', 'Receiving reports with received / rejected quantities and variance.', { dataset: 'rr' }),
        A('DBL-RPT-013-01', 'DBL-RPT-013 / DBL-REG-005', 'Budget-per-ending-plate forecast', 'Regulatory', 'reg.compliance', 'Renewal units and forecast cost by plate-ending digit and month.', { dataset: 'regbudget' }),
        A('DBL-RPT-013-02', 'DBL-RPT-013', 'Registered detailed report', 'Regulatory', 'reg.compliance', 'All units with a current registration.', { dataset: 'regd' }),
        A('DBL-RPT-013-03', 'DBL-RPT-013', 'Unregistered detailed report', 'Regulatory', 'reg.compliance', 'Expired and pending-registration units with follow-up.', { dataset: 'unreg' }),
        A('DBL-RPT-014-01', 'DBL-RPT-014', 'Billing register', 'Finance', 'fin.invoice', 'Invoices issued by period and client.', { link: '/billing/invoices' }),
        A('DBL-RPT-014-02', 'DBL-RPT-014', 'Sales invoice report', 'Finance', 'fin.invoice', 'Sales invoices with VAT breakdown and payment status.', { dataset: 'sinv' }),
        A('DBL-RPT-014-03', 'DBL-RPT-014', 'Revenue report', 'Finance', 'fin.invoice', 'Revenue (net of VAT) by client and contract type.', { dataset: 'revenue' }),
        A('DBL-RPT-014-04', 'DBL-RPT-014', 'Official receipt summary', 'Finance', 'fin.receipt', 'OR / PR issued with method and reference (role-restricted).', { dataset: 'orsum', restricted: true }),
        A('DBL-RPT-014-05', 'DBL-RPT-014', 'Collections register (OR/PR)', 'Finance', 'fin.receipt', 'Receipts and their application to invoices.', { link: '/billing/receipts' }),
        A('DBL-RPT-014-06', 'DBL-RPT-014', 'Credit memo report', 'Finance', 'fin.memo', 'Credit memos with reference and approval status.', { dataset: 'cm' }),
        A('DBL-RPT-014-07', 'DBL-RPT-014', 'Debit memo report', 'Finance', 'fin.memo', 'Debit memos (rescue, penalties) with reference.', { dataset: 'dm' }),
        A('DBL-RPT-014-08', 'DBL-RPT-014', 'E-wallet ledger', 'Finance', 'ewl.ledger', 'Every e-wallet movement with running balance.', { dataset: 'ewl' }),
        A('DBL-RPT-014-09', 'DBL-RPT-014', 'E-wallet balances & below minimum', 'Finance', 'ewl.ledger', 'Current balances against the minimum.', { link: '/ewallet' }),
        A('DBL-RPT-014-10', 'DBL-RPT-014', 'Cash bond monitoring', 'Finance', 'clients.cashbond', 'Cash bonds held, refunded and withdrawals.', { dataset: 'cashbond' }),
        A('DBL-RPT-014-11', 'DBL-RPT-014', 'Accounts payable (RFP / PCV / vendor invoices)', 'Finance', 'prc.payment', 'Payables with status and due date.', { dataset: 'ap' }),
        P2('DBL-RPT-014-12', 'DBL-RPT-014', 'Advance payment report', 'Finance', 'fin.receipt', 'Advance payments and their application. Scope to confirm.'),
        P2('DBL-RPT-014-13', 'DBL-RPT-014', 'PDC ledger', 'Finance', 'fin.receipt', 'Post-dated cheques on hand and deposited. Finance Phase 2 — confirm.'),
        P2('DBL-RPT-014-14', 'DBL-RPT-014', 'Financial statements', 'Finance', 'fin.invoice', 'Balance sheet / income statement. Finance Phase 2 — confirm.'),
        P2('DBL-RPT-014-15', 'DBL-RPT-014', 'Bank reconciliation', 'Finance', 'fin.receipt', 'Bank vs book reconciliation. Finance Phase 2 — confirm.'),
        P2('DBL-RPT-014-16', 'DBL-RPT-014', 'Subsidiary ledger', 'Finance', 'fin.invoice', 'AR / AP subsidiary ledgers. Finance Phase 2 — confirm.'),
        A('DBL-RPT-015-01', 'DBL-RPT-015', 'Statement of account', 'Credit & Collection', 'cnc.aging', 'Open invoices per client with balance and days overdue.', { dataset: 'soa' }),
        A('DBL-RPT-015-02', 'DBL-RPT-015', 'Monthly collection report', 'Credit & Collection', 'cnc.aging', 'Collections by month and client.', { dataset: 'monthcoll' }),
        A('DBL-RPT-015-03', 'DBL-RPT-015', 'Application-of-payment report', 'Credit & Collection', 'cnc.aging', 'How each receipt was applied to invoices.', { dataset: 'aop' }),
        A('DBL-RPT-015-04', 'DBL-RPT-015', 'Credit memo summary', 'Credit & Collection', 'cnc.aging', 'Credit memos issued to clients.', { dataset: 'cm' }),
        A('DBL-RPT-015-05', 'DBL-RPT-015 / DBL-RPT-007', 'Nationwide AR ageing', 'Credit & Collection', 'cnc.aging', 'Six-bucket receivables ageing by client.', { link: '/credit/aging' }),
        A('DBL-RPT-015-06', 'DBL-RPT-015', 'Unapplied payment summary', 'Credit & Collection', 'cnc.aging', 'Receipts with unapplied amounts.', { dataset: 'unapplied' }),
        A('DBL-RPT-015-07', 'DBL-RPT-015', 'Monthly billing detail', 'Credit & Collection', 'cnc.aging', 'Invoice lines by client, chassis and charge type.', { dataset: 'billdetail' }),
        A('DBL-RPT-015-08', 'DBL-RPT-015', 'Collection forecast', 'Credit & Collection', 'cnc.aging', 'Expected collections by due week.', { dataset: 'forecast' }),
        A('DBL-RPT-AUD-01', 'NFR-AUD-001', 'Audit log / user access review', 'Administration', 'admin.audit', 'Filter by user, entity, action and date; exports are themselves logged.', { link: '/admin/audit', restricted: true }),
      ];
    },
  },

  // ── Client portal (scoped to the signed-in client) ──────────────────────
  portal: {
    async dashboard() {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      runAutoHold();
      return tx(() => {
        const code = u.clientCode!; const c = mustClient(code);
        const invs = db.invoices.filter((i) => i.clientCode === code && i.status !== 'Draft');
        const unpaid = invs.filter((i) => balance(i) > 0);
        // Review 1.1: oldest due also shows its amount (all invoices sharing that due date) and whether it is overdue.
        const oldestDue = unpaid.map((i) => i.dueDate).sort()[0];
        const oldest = unpaid.filter((i) => i.dueDate === oldestDue);
        const contracts = db.contracts.filter((x) => x.clientCode === code);
        const active = contracts.filter((x) => x.status === 'Active');
        const ae = db.users.find((x) => x.userId === c.aeAssigned);
        const newest = <T extends { at?: string; createdAt?: string; requestedAt?: string }>(a: T, b: T) => (b.at ?? b.createdAt ?? b.requestedAt ?? '').localeCompare(a.at ?? a.createdAt ?? a.requestedAt ?? '');
        // ── Portal dashboard review (2026-11-11) ──
        const rateOf = (contractNo?: string, eq?: string) => db.contracts.find((x) => x.contractNo === contractNo)?.rates.find((r) => r.equipmentType === eq)?.dailyRate;
        const typeOf = (chassisNo: string) => db.chassis.find((x) => x.chassisNo === chassisNo)?.chassisType;
        const openReturn = (chassisNo: string) => (db.returnRequests ?? []).find((r) => r.clientCode === code && r.chassisNo === chassisNo && (r.status === 'Requested' || r.status === 'Scheduled'));
        // Overdue amount and the six aging buckets (same calculation as Aging / SOA).
        const overdueInvs = unpaid.filter((i) => paymentStatus(i) === 'Overdue');
        // Cash bond: what could be withdrawn today (BR-14), so the dashboard link is only offered when something is refundable.
        const heldBonds = db.cashBonds.filter((b) => b.clientCode === code && (b.status === 'Held' || b.status === 'Withdrawal Pending'));
        const bondPreviews = heldBonds.map((b) => ({ status: b.status, ...api.contracts.refundPreview(b.id) }));
        // Repair and debit-memo charges, with the source document and how each one was settled.
        const charges = [
          ...db.memos.filter((m) => m.clientCode === code && m.type === 'Debit' && !['Draft', 'Rejected'].includes(m.status)).map((m) => {
            const src = m.rescueNo ?? m.joNo ?? m.referenceId;
            const txn = db.ewalletTxns.find((t) => t.clientCode === code && t.type === 'Deduction' && !t.reversedById && (t.referenceId === m.memoNo || (!!src && t.referenceId === src)));
            const kind = m.referenceType === 'Rescue' ? 'Rescue' : m.referenceType === 'Job Order' || m.referenceType === 'Repair' ? 'Repair' : m.referenceType === 'Park & Fix' ? 'Park & Fix' : m.category ?? m.referenceType;
            return {
              ref: m.memoNo, docType: 'Debit memo' as const, kind, reason: m.reason, amount: m.amount, at: m.createdAt, status: m.status,
              source: src ? `${m.referenceType} ${src}` : m.referenceType, invoiceNo: m.referenceInvoiceNo,
              settlement: txn ? { how: 'ewallet' as const, txnId: txn.id, at: txn.at, balanceAfter: txn.balanceAfter }
                : m.status === 'Pending Approval' ? { how: 'pending' as const }
                  : m.status === 'Applied' && m.appliedTo ? { how: 'invoice' as const, invoiceNo: m.appliedTo }
                    : { how: 'open' as const },
            };
          }),
          // One-off repair / damage bills (e.g. chargeable damage found at Gate In) are invoiced rather than memoed.
          ...invs.filter((i) => i.billType === 'Repair' && i.status !== 'Cancelled').map((i) => ({
            ref: i.invoiceNo, docType: 'Repair invoice' as const, kind: 'Repair', reason: i.lines.map((l) => l.description).join('; '), amount: i.total, at: i.issuedAt, status: paymentStatus(i),
            source: i.lines.find((l) => l.chassisNo)?.chassisNo ? `Chassis ${i.lines.find((l) => l.chassisNo)!.chassisNo}` : 'Gate In inspection', invoiceNo: i.invoiceNo,
            settlement: balance(i) > 0 ? { how: 'invoice_due' as const, invoiceNo: i.invoiceNo, balance: balance(i), dueDate: i.dueDate } : { how: 'paid' as const, invoiceNo: i.invoiceNo },
          })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        const notes = db.notifications.filter((n) => n.userId === u.userId);
        return {
          aging: agingFor(code), overdueCount: overdueInvs.length,
          oldestOverdueDays: overdueInvs.length ? Math.max(...overdueInvs.map(daysOverdue)) : 0,
          cashBond: {
            held: round2(bondPreviews.reduce((a, b) => a + b.bond, 0)),
            refundable: round2(bondPreviews.filter((b) => b.status === 'Held').reduce((a, b) => a + b.refundable, 0)),
            unpaid: bondPreviews[0]?.unpaid ?? 0, negativeWallet: bondPreviews[0]?.negativeWallet ?? 0, openDm: bondPreviews[0]?.openDm ?? 0,
            withdrawalPending: bondPreviews.some((b) => b.status === 'Withdrawal Pending'),
          },
          charges, unreadNotifications: notes.filter((n) => !n.read).length,
          client: c, unpaidCount: unpaid.length, unpaidTotal: round2(unpaid.reduce((a, i) => a + balance(i), 0)), oldestDue,
          oldestDueAmount: round2(oldest.reduce((a, i) => a + balance(i), 0)), oldestDueInvoices: oldest.map((i) => i.invoiceNo), oldestDueOverdue: oldest.some((i) => paymentStatus(i) === 'Overdue'),
          overdue: round2(unpaid.filter((i) => paymentStatus(i) === 'Overdue').reduce((a, i) => a + balance(i), 0)),
          // Newest first, with reference and running balance (review 1.1, DBL-EWL-005).
          ewallet: db.ewallets.find((e) => e.clientCode === code) ?? null, walletTxns: db.ewalletTxns.filter((t) => t.clientCode === code).sort(newest).slice(0, 5),
          cashBondHeld: db.cashBonds.filter((b) => b.clientCode === code && (b.status === 'Held' || b.status === 'Withdrawal Pending')).reduce((a, b) => a + b.amount, 0),
          // Dashboard review: contract, daily rate (contract snapshot), hire days (pickup day counts, Q-FIN-02) and the hire charge accrued so far (ex VAT).
          onHire: db.chassis.filter((x) => x.currentClientCode === code && ['On Hire', 'Rescue'].includes(x.status)).map((x) => {
            const gateOut = db.gatePasses.find((g) => g.gatePassNo === x.currentGatePassNo)?.actualEventAt;
            const dailyRate = rateOf(x.currentContractNo, x.chassisType);
            const days = gateOut ? hireDays(gateOut).billable : undefined;
            const rr = openReturn(x.chassisNo);
            return {
              chassisNo: x.chassisNo, chassisType: x.chassisType, branchCode: x.branchCode, status: x.status, contractNo: x.currentContractNo, gateOut, gatePassNo: x.currentGatePassNo,
              dailyRate, hireDays: days, accrued: dailyRate != null && days != null ? round2(dailyRate * days) : undefined,
              returnRequest: rr ? { requestNo: rr.requestNo, preferredDate: rr.preferredDate, returnBranchCode: rr.returnBranchCode, status: rr.status } : undefined,
              // Proposed (Q-PTL-03): a return can be requested for a unit on hire (not while it is under rescue) with no open request.
              canRequestReturn: x.status === 'On Hire' && !rr,
            };
          }),
          // DBL-CLT-017 equipment return history: Gate In passes for this client, paired with their Gate Out.
          // Dashboard review: return branch, Gate In date and time, condition, final charges, hire duration and the BR-16 code for a cross-branch return.
          returns: db.gatePasses.filter((g) => g.clientCode === code && g.direction === 'IN').sort((a, b) => b.actualEventAt.localeCompare(a.actualEventAt)).slice(0, 5)
            .map((g) => {
              const out = db.gatePasses.find((o) => o.gatePassNo === g.pairedGatePassNo);
              const chassisType = typeOf(g.chassisNo);
              const dailyRate = rateOf(g.contractNo, chassisType);
              const d = out ? hireDays(out.actualEventAt, g.actualEventAt) : undefined;
              const damage = g.inspection.filter((l) => l.chargeable > 0).map((l) => ({ part: l.part, amount: l.chargeable }));
              const damageCharge = round2(damage.reduce((a, l) => a + l.amount, 0));
              const leaseCharge = dailyRate != null && d ? round2(dailyRate * d.billable) : undefined;
              const originBranchCode = out?.branchCode ?? g.originBranchCode ?? g.branchCode;
              return {
                chassisNo: g.chassisNo, chassisType, gatePassNo: g.gatePassNo, outGatePassNo: out?.gatePassNo, eirNo: g.eirNo, returnedAt: g.actualEventAt, branchCode: g.branchCode,
                hiredAt: out?.actualEventAt, originBranchCode, crossBranch: originBranchCode !== g.branchCode, approvalCode: g.crossBranchCode,
                condition: g.generalAssessment, remarks: g.remarks, damage, durationDays: d?.calendar, billableDays: d?.billable, dailyRate, leaseCharge, damageCharge,
                finalCharges: leaseCharge != null ? round2(leaseCharge + damageCharge) : undefined, isForceInbound: !!g.isForceInbound,
              };
            }),
          returnBranches: Array.from(new Set([c.branchCode, ...c.cwsBranchAccess])).map((b) => ({ code: b, name: db.branches.find((x) => x.code === b)?.name ?? b })),
          // DBL-RPT-009 service ticket status: open rescue requests.
          openRescues: db.rescues.filter((r) => r.clientCode === code && rescueIsOpen(r)).sort(newest).map((r) => ({ rescueNo: r.rescueNo, chassisNo: r.chassisNo, status: r.status, requestedAt: r.requestedAt, urgent: r.urgent, eta: r.eta })),
          ewas: db.ewas.filter((e) => e.clientCode === code).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.euNo.localeCompare(a.euNo)).slice(0, 6), contracts,
          activeContracts: { count: active.length, nearestExpiry: active.map((x) => x.expiryDate).filter(Boolean).sort()[0] as string | undefined },
          accountExecutive: ae ? { name: ae.name, email: ae.email, mobile: ae.mobile } : null,
          // Portal sign-in review (BR-01): who to call about a hold, shown with the restriction message.
          creditContact: creditContact(),
          gates: { ewa: creditGate(c, 'PORTAL_EWA'), rescue: creditGate(c, 'RESCUE_REQUEST') },
        };
      });
    },
    /** US-EWL-005/007 — the client's own Cash Bond entries (separate fund from the E-Wallet), shown in the portal ledger. */
    async cashBonds() {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      return tx(() => db.cashBonds.filter((b) => b.clientCode === u.clientCode).map((b) => ({ ...b, preview: api.contracts.refundPreview(b.id), workflows: b.withdrawals.map((w) => db.workflows.find((x) => x.id === w.workflowId)).filter(Boolean) })));
    },
    /** Review 1.1 (DBL-CLT-017): feedback and contract requests from the client; the Account Executive is notified. */
    async submitFeedback(f: { category: string; subject: string; message: string; reference?: string; rating?: number; topic?: string }) {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      await delay();
      // Dashboard review: a star rating needs no subject or message (the comment is optional).
      const rated = f.rating != null;
      if (rated && !(Number.isInteger(f.rating) && f.rating! >= 1 && f.rating! <= 5)) throw new ApiError('VALIDATION_FAILED', 'Choose a rating from 1 to 5 stars.', 422, { rating: 'Choose 1 to 5 stars' });
      const subject = f.subject?.trim() || (rated ? `${f.rating}-star rating${f.topic ? ` — ${f.topic}` : ''}` : '');
      const message = f.message?.trim() || (rated ? '(no comment)' : '');
      const missing = { category: f.category?.trim() ? '' : 'Required', subject: subject ? '' : 'Required', message: message ? '' : 'Required' };
      if (Object.values(missing).some(Boolean)) throw new ApiError('VALIDATION_FAILED', 'Category, subject and message are required.', 422, missing);
      const c = mustClient(u.clientCode!);
      const fb = { id: `FB-${String((db.feedback?.length ?? 0) + 1).padStart(5, '0')}`, clientCode: c.clientCode, category: f.category.trim(), subject, message, reference: f.reference?.trim() || undefined, submittedAt: nowIso(), submittedBy: u.userId, status: 'Submitted' as const,
        rating: rated ? f.rating : undefined, topic: f.topic?.trim() || undefined };
      (db.feedback ??= []).unshift(fb);
      notify('client.feedback', `${rated ? `${'★'.repeat(f.rating!)} rating` : fb.category} — ${c.clientName}`, `${fb.subject}${fb.reference ? ` (${fb.reference})` : ''}`, { clientCode: c.clientCode, aeUserId: c.aeAssigned, extraUsers: [c.aeAssigned] });
      audit('client.feedback', 'client', c.clientCode, fb); persist();
      return structuredClone(fb);
    },
    async myFeedback() {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      return tx(() => (db.feedback ?? []).filter((x) => x.clientCode === u.clientCode));
    },
    /**
     * Dashboard review (proposed — Q-PTL-03): ask Delbros to collect an on-hire unit. The branch and the Account Executive are
     * notified and arrange the Gate In. Returning at a branch other than the release branch needs the IT-issued approval code (BR-16).
     */
    async requestReturn(f: { chassisNo: string; returnBranchCode: string; preferredDate: string; notes?: string }) {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      await delay();
      return tx(() => {
        const c = mustClient(u.clientCode!);
        const ch = db.chassis.find((x) => x.chassisNo === f.chassisNo && x.currentClientCode === c.clientCode);
        if (!ch) throw new ApiError('NOT_FOUND', 'That unit is not on hire to your account.', 404);
        if (ch.status !== 'On Hire') throw new ApiError('INVALID_STATE', `${ch.chassisNo} is under ${ch.status.toLowerCase()} — the return is arranged once it is back on hire.`, 409);
        if ((db.returnRequests ?? []).some((r) => r.chassisNo === ch.chassisNo && (r.status === 'Requested' || r.status === 'Scheduled'))) throw new ApiError('DUPLICATE', `A return is already requested for ${ch.chassisNo}.`, 409);
        const allowed = new Set([c.branchCode, ...c.cwsBranchAccess, ch.branchCode]);
        const fields: Record<string, string> = {};
        if (!allowed.has(f.returnBranchCode)) fields.returnBranchCode = 'Choose one of your branches';
        const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f.preferredDate ?? '')) fields.preferredDate = 'Required';
        else if (f.preferredDate < today) fields.preferredDate = 'Cannot be in the past';
        else if (f.preferredDate > addDays(today, 60).slice(0, 10)) fields.preferredDate = 'Within the next 60 days';
        if (Object.keys(fields).length) throw new ApiError('VALIDATION_FAILED', 'Check the highlighted fields.', 422, fields);
        const origin = db.gatePasses.find((g) => g.gatePassNo === ch.currentGatePassNo)?.branchCode ?? ch.branchCode;
        const r = { requestNo: nextNo('RTN', 'RTN-', 6), clientCode: c.clientCode, chassisNo: ch.chassisNo, contractNo: ch.currentContractNo, originBranchCode: origin, returnBranchCode: f.returnBranchCode,
          preferredDate: f.preferredDate, notes: f.notes?.trim() || undefined, status: 'Requested' as const, requestedAt: nowIso(), requestedBy: u.userId };
        (db.returnRequests ??= []).unshift(r);
        const cross = origin !== f.returnBranchCode;
        notify('client.return_request', `Return requested: ${ch.chassisNo}`, `${c.clientName} · ${r.requestNo} · return at ${f.returnBranchCode} on ${f.preferredDate}${cross ? ` — cross-branch from ${origin}, IT approval code needed (BR-16)` : ''}`,
          { branchCode: f.returnBranchCode, clientCode: c.clientCode, aeUserId: c.aeAssigned, extraUsers: [c.aeAssigned, ...db.users.filter((x) => x.realm === 'INTERNAL' && x.roles.includes('BRANCH_GENERALIST') && x.branchCode === f.returnBranchCode).map((x) => x.userId)] });
        audit('portal.return_requested', 'chassis', ch.chassisNo, r);
        return { ...r, crossBranch: cross };
      });
    },
    /**
     * Portal New EWA review: everything the New EWA dialog needs in one call — whether the client may create an EWA (and why not),
     * active contracts with what is left to request, eligible pickup branches with free units per type, and drivers / trucks used before.
     */
    async ewaOptions() {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      expireEwas();
      return tx(() => {
        const c = mustClient(u.clientCode!);
        const gate = creditGate(c, 'PORTAL_EWA', (db.gateOverrides ?? []).filter((o) => o.clientCode === c.clientCode));
        const branches = c.cwsBranchAccess.map((code) => db.branches.find((b) => b.code === code)).filter((b): b is NonNullable<typeof b> => !!b && !b.isHeadOffice && b.active !== false);
        const contracts = db.contracts.filter((x) => x.clientCode === c.clientCode && x.status === 'Active');
        type Blocked = { code: 'HOLD' | 'NOT_ACCREDITED' | 'ONLINE_OFF' | 'ACCOUNT' | 'NO_BRANCH' | 'NO_CONTRACT'; title: string; reason: string };
        const blocked: Blocked | null = !gate.allowed
          ? c.status === 'Hold' ? { code: 'HOLD', title: 'Your account is on hold', reason: 'New EWAs and chassis release are blocked until the overdue balance is settled and the hold is lifted (BR-01).' }
            : c.status === 'Draft' ? { code: 'NOT_ACCREDITED', title: 'Your company is not yet accredited', reason: 'EWAs can be created once Delbros completes your accreditation.' }
              : gate.code === 'ELIGIBILITY' ? { code: 'ONLINE_OFF', title: 'Online EWA is not enabled for your account', reason: 'Allow Online is off for your account, so EWAs cannot be created in the portal. Your Account Executive can book the pickup or enable online EWAs.' }
                : { code: 'ACCOUNT', title: 'EWA creation unavailable', reason: gate.reason ?? 'Your account cannot create EWAs at the moment.' }
          : !branches.length ? { code: 'NO_BRANCH', title: 'No pickup branch is enabled for your account', reason: 'Your account has no branch set up for chassis pickup (CWS branch access). Ask your Account Executive to add one.' }
            : !contracts.length ? { code: 'NO_CONTRACT', title: 'No active contract', reason: 'An EWA is issued against an active lease contract. Your Account Executive can help with a new or renewed contract.' }
              : null;
        const past = db.ewas.filter((e) => e.clientCode === c.clientCode).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const drivers: { name: string; licence: string; lastUsed: string }[] = [];
        const trucks: { plate: string; trucker: string; truckOrcr?: string; lastUsed: string }[] = [];
        for (const e of past) {
          if (!drivers.some((d) => d.licence === e.driverLicenseNo)) drivers.push({ name: e.driverName, licence: e.driverLicenseNo, lastUsed: e.createdAt });
          if (!trucks.some((t) => t.plate === e.truckPlateNo)) {
            const orcr = e.truckOrcr ?? db.gatePasses.find((g) => g.euNo === e.euNo && g.truckOrcr)?.truckOrcr;
            trucks.push({ plate: e.truckPlateNo, trucker: e.trucker, truckOrcr: orcr, lastUsed: e.createdAt });
          }
        }
        const ae = db.users.find((x) => x.userId === c.aeAssigned);
        return {
          blocked, clientName: c.clientName, validityHours: Number(S()['gat.ewa_validity_hours'] ?? 24),
          contracts: contracts.map((ct) => ({ contractNo: ct.contractNo, contractType: ct.contractType, class: ct.class, expiryDate: ct.expiryDate, entitlement: ewaEntitlement(ct) })),
          branches: branches.map((b) => ({ code: b.code, name: b.name })),
          availability: Object.fromEntries(branches.map((b) => [b.code, Object.fromEntries(db.equipmentTypes.map((t) => [t.code, availableUnits(b.code, t.code)]))])) as Record<string, Record<string, number>>,
          drivers: drivers.slice(0, 20), trucks: trucks.slice(0, 20),
          accountExecutive: ae ? { role: 'Your Account Executive', name: ae.name, phone: ae.mobile, email: ae.email } : null,
          creditContact: creditContact(),
        };
      });
    },
    /** Dashboard review: the client's notifications, each with a link to the record in the portal. */
    async notifications() {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      return tx(() => db.notifications.filter((n) => n.userId === u.userId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50).map((n) => ({ ...n, link: portalLink(n.link) })), 50);
    },
    async markNotificationsRead(id?: string) {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      return tx(() => { db.notifications.forEach((n) => { if (n.userId === u.userId && (!id || n.id === id)) n.read = true; }); return true; }, 50);
    },
    /** Review 1.1: the client may cancel its own rescue request while it is still Requested (before C&C verification). */
    async cancelRescue(no: string, reason: string) {
      const u = me(); if (u.realm !== 'CLIENT_PORTAL') throw new ApiError('FORBIDDEN', 'Client access only.', 403);
      await delay();
      return tx(() => {
        const r = db.rescues.find((x) => x.rescueNo === no && x.clientCode === u.clientCode); if (!r) throw new ApiError('NOT_FOUND', 'Rescue not found.', 404);
        if (r.status !== 'Requested') throw new ApiError('INVALID_STATE', `${no} is already ${r.status.toLowerCase()} — call the dispatcher to cancel.`, 409);
        if (!reason.trim()) throw new ApiError('VALIDATION_FAILED', 'A cancellation reason is required.', 422, { reason: 'Required' });
        Object.assign(r, { status: 'Cancelled', cancelReason: reason.trim(), cancelledBy: u.userId, cancelledAt: nowIso() });
        notify('rescue.cancelled', `Rescue ${no} cancelled by the client`, `${clientName(r.clientCode)} · ${r.chassisNo} · ${reason.trim()}`, { branchCode: r.branchCode, clientCode: r.clientCode, link: `/rescue/${no}` });
        audit('rescue.cancel', 'rescue', no, { status: 'Cancelled' }, reason, { status: 'Requested' }); persist();
        return structuredClone(r);
      });
    },
  },
};

export type Api = typeof api;
