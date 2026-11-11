// Portal sign-in for client and vendor users (portal sign-in review, 2026-11-11).
// Covers: account access states, lockout, email one-time code, password reset links, portal access requests
// with the one-email-one-company rule. The real REST API replaces this module; pages only call it through ./api.ts.
import {
  formatDateTime, maskEmail, normalizeEmail, passwordChecks, portalAccessSchema, tinDigits,
  type ClientPortalForm, type ReleaseContacts, type User,
} from '../shared';
import { ApiError, audit, db, delay, nextNo, notify, persist, session, setSession, settings } from './core';

export type PortalRealm = Exclude<User['realm'], 'INTERNAL'>;
type DbUser = (typeof db.users)[number];

/** Someone the portal user can contact. */
export interface PortalContact { role: string; name?: string; phone?: string; email?: string }

const nowIso = () => new Date().toISOString();
const num = (key: string, fallback: number) => { const v = Number(settings()[key]); return Number.isFinite(v) && v > 0 ? v : fallback; };
const text = (key: string, fallback = '') => String(settings()[key] ?? '').trim() || fallback;
/** Approved release contacts from app-config.json (production contact details); they win over the System-settings defaults. */
let release: ReleaseContacts = {};
export function applyReleaseContacts(c?: ReleaseContacts) { release = c ?? {}; }
const pick = (override: string | undefined, key: string) => override?.trim() || text(key);

/** Fixed one-time-code rules (proposed — confirm with Q-SEC-03). */
export const OTP_RULES = { digits: 6, ttlMinutes: 5, maxAttempts: 5, resendSeconds: 30 } as const;

/** Public sign-in policy: safe to read before sign-in (no personal data). */
export function portalPolicy() {
  return {
    maxFailed: num('auth.max_failed_logins', 5),
    lockoutMinutes: num('auth.lockout_minutes', 30),
    passwordMinLength: num('auth.password_min_length', 10),
    sessionTimeoutMinutes: num('auth.portal_session_timeout_minutes', 15),
    secondFactor: (text('auth.portal_second_factor', 'email_otp') === 'off' ? 'off' : 'email_otp') as 'off' | 'email_otp',
    otpMinutes: OTP_RULES.ttlMinutes,
    resetLinkMinutes: num('auth.reset_link_minutes', 30),
    support: {
      client: { role: 'Delbros Client Support', phone: pick(release.client?.phone, 'portal.client_support_phone'), email: pick(release.client?.email, 'portal.client_support_email') } as PortalContact,
      vendor: { role: 'Delbros Procurement', phone: pick(release.vendor?.phone, 'portal.vendor_support_phone'), email: pick(release.vendor?.email, 'portal.vendor_support_email') } as PortalContact,
    },
    dpoEmail: pick(release.dpoEmail, 'portal.dpo_email'),
  };
}

// ── Contacts ────────────────────────────────────────────────────────────────
function accountExecutiveOf(clientCode?: string): PortalContact {
  const c = db.clients.find((x) => x.clientCode === clientCode);
  const ae = c && db.users.find((u) => u.userId === c.aeAssigned);
  return ae ? { role: 'Your Account Executive', name: ae.name, phone: ae.mobile, email: ae.email } : portalPolicy().support.client;
}
/** Account Executive for clients, Procurement for vendors. */
export const contactFor = (u: Pick<DbUser, 'realm' | 'clientCode'>): PortalContact => (u.realm === 'VENDOR_PORTAL' ? portalPolicy().support.vendor : accountExecutiveOf(u.clientCode));
/** Credit & Collection officer shown with the hold message (BR-01). */
export function creditContact(): PortalContact {
  const cc = db.users.find((u) => u.realm === 'INTERNAL' && u.status === 'Active' && u.roles.includes('CNC_OFFICER'));
  return { role: 'Credit & Collection', name: cc?.name, phone: cc?.mobile, email: cc?.email };
}

// ── Account access states ───────────────────────────────────────────────────
const findPortalUser = (email: string, realm?: PortalRealm) => {
  const id = normalizeEmail(email);
  return db.users.find((u) => u.realm !== 'INTERNAL' && (!realm || u.realm === realm) && normalizeEmail(u.userId) === id);
};

const lockedError = (u: DbUser, justNow: boolean) => new ApiError(
  'ACCOUNT_LOCKED',
  justNow
    ? `Too many failed sign-in attempts. For your security, this account is locked until ${formatDateTime(u.lockedUntil)}.`
    : `This account is locked after too many failed sign-in attempts. You can try again after ${formatDateTime(u.lockedUntil)}.`,
  423, undefined,
  // Generic support contact only — the password has not been verified, so no account details are revealed.
  { lockedUntil: u.lockedUntil, contact: u.realm === 'VENDOR_PORTAL' ? portalPolicy().support.vendor : portalPolicy().support.client },
);

/** Checked only after the password is correct, so the state is never revealed to someone guessing. Hold is NOT refused: it is shown after sign-in (BR-01). */
function accessRefusal(u: DbUser): ApiError | null {
  const details = { contact: contactFor(u) };
  if (u.realm === 'CLIENT_PORTAL') {
    const c = db.clients.find((x) => x.clientCode === u.clientCode);
    if (u.status !== 'Active' && c?.status === 'Draft' && c.registrationSource === 'Portal')
      return new ApiError('ACCOUNT_PENDING', `Your request for portal access for ${c.clientName} is still being reviewed by your Account Executive. We will email you as soon as access is approved.`, 403, undefined, details);
    if (u.status !== 'Active') return new ApiError('ACCOUNT_INACTIVE', 'This portal user has been deactivated. Ask your Account Executive to reactivate it or to add a new user for your company.', 403, undefined, details);
    if (!c) return new ApiError('ACCOUNT_INACTIVE', 'No active company account is linked to this user. Please contact Delbros Client Support.', 403, undefined, { contact: portalPolicy().support.client });
    if (c.status === 'Draft') {
      const acc = db.accreditations.find((a) => a.clientCode === c.clientCode && a.status.startsWith('Pending'));
      return new ApiError('NOT_ACCREDITED', `${c.clientName} is not yet accredited${acc ? ` — the application is at ${acc.status.replace('Pending ', '').replace('C&C', 'Credit & Collection')} review` : ''}. Portal sign-in opens once accreditation is approved (Credit & Collection → Finance → Vice President).`, 403, undefined, { ...details, stage: acc?.status });
    }
    if (c.status === 'Inactive') return new ApiError('ACCOUNT_INACTIVE', `The ${c.clientName} account is inactive (no active contract). Your Account Executive can reactivate it.`, 403, undefined, details);
    if (c.status === 'Blacklist') return new ApiError('ACCOUNT_INACTIVE', `Portal access for ${c.clientName} is suspended. Please contact your Account Executive.`, 403, undefined, details);
    return null;
  }
  const v = db.vendors.find((x) => x.vendorId === u.vendorId);
  if (u.status !== 'Active' && v?.status === 'Pending')
    return new ApiError('ACCOUNT_PENDING', `Your request for vendor portal access for ${v.name} is still being reviewed by Delbros Procurement. We will email you as soon as access is approved.`, 403, undefined, details);
  if (u.status !== 'Active') return new ApiError('ACCOUNT_INACTIVE', 'This vendor portal user has been deactivated. Please contact Delbros Procurement.', 403, undefined, details);
  if (!v) return new ApiError('ACCOUNT_INACTIVE', 'No active supplier account is linked to this user. Please contact Delbros Procurement.', 403, undefined, details);
  if (v.status === 'Pending') return new ApiError('NOT_ACCREDITED', `${v.name} is not yet an accredited Delbros supplier. Portal sign-in opens once Procurement completes vendor accreditation.`, 403, undefined, details);
  if (v.status !== 'Active') return new ApiError('ACCOUNT_INACTIVE', `The ${v.name} supplier account is ${v.status.toLowerCase()}. Please contact Delbros Procurement.`, 403, undefined, details);
  return null;
}

function completeSignIn(u: DbUser, secondFactor: 'None' | 'Email OTP') {
  u.failed = 0; u.lockedUntil = undefined; u.lastLogin = nowIso();
  setSession(u);
  audit('auth.login', 'user', u.userId, { realm: u.realm, secondFactor });
  persist();
  const s = session();
  return s ? structuredClone(s) : null;
}

// ── Sign-in with optional email one-time code ───────────────────────────────
interface Challenge { userId: string; code: string; expiresAt: number; resendAt: number; attempts: number }
const challenges = new Map<string, Challenge>(); // in memory: a reload simply asks the user to sign in again
const randomDigits = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => String(b % 10)).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

export type PortalSignInResult =
  | { status: 'signed_in'; user: ReturnType<typeof completeSignIn> }
  | { status: 'otp_required'; challengeId: string; maskedEmail: string; expiresAt: string; resendAfterSeconds: number };

export async function portalSignIn(email: string, password: string, realm: PortalRealm): Promise<PortalSignInResult> {
  await delay(250);
  const p = portalPolicy();
  const u = findPortalUser(email, realm);
  if (u?.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()) throw lockedError(u, false);
  if (!u || u.password !== password) {
    // Right email and password, wrong tab: say which portal (safe — the password was correct).
    const other = !u ? findPortalUser(email) : undefined;
    if (other && other.password === password) throw new ApiError('WRONG_PORTAL', `This email is registered for the ${other.realm === 'VENDOR_PORTAL' ? 'Vendor / supplier' : 'Client'} portal. Switch to that tab and sign in again.`, 409, undefined, { realm: other.realm });
    if (u) {
      u.failed++;
      audit('auth.login_failed', 'user', u.userId, { realm, failedAttempts: u.failed });
      if (u.failed >= p.maxFailed) {
        u.lockedUntil = new Date(Date.now() + p.lockoutMinutes * 60_000).toISOString();
        audit('auth.account_locked', 'user', u.userId, { failedAttempts: u.failed, lockedUntil: u.lockedUntil }, `Locked after ${u.failed} failed sign-in attempts`);
        persist();
        throw lockedError(u, true);
      }
      persist();
    }
    // Same message whether the email or the password is wrong (no account enumeration).
    throw new ApiError('INVALID_CREDENTIALS', 'The email or password is incorrect.', 401, undefined, { maxFailed: p.maxFailed, lockoutMinutes: p.lockoutMinutes });
  }
  const refusal = accessRefusal(u);
  if (refusal) { audit('auth.login_refused', 'user', u.userId, { realm, reason: refusal.code }); persist(); throw refusal; }
  if (p.secondFactor === 'off') return { status: 'signed_in', user: completeSignIn(u, 'None') };

  for (const [id, c] of challenges) if (c.userId === u.userId) challenges.delete(id);
  const challengeId = randomToken();
  const ch: Challenge = { userId: u.userId, code: randomDigits(OTP_RULES.digits), expiresAt: Date.now() + OTP_RULES.ttlMinutes * 60_000, resendAt: Date.now() + OTP_RULES.resendSeconds * 1000, attempts: 0 };
  challenges.set(challengeId, ch);
  audit('auth.otp_sent', 'user', u.userId, { channel: 'Email', to: maskEmail(u.userId) });
  persist();
  return { status: 'otp_required', challengeId, maskedEmail: maskEmail(u.userId), expiresAt: new Date(ch.expiresAt).toISOString(), resendAfterSeconds: OTP_RULES.resendSeconds };
}

function liveChallenge(challengeId: string) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new ApiError('OTP_EXPIRED', 'This sign-in code is no longer valid. Sign in again to get a new code.', 410);
  if (ch.expiresAt < Date.now()) { challenges.delete(challengeId); throw new ApiError('OTP_EXPIRED', `The code expired (codes are valid for ${OTP_RULES.ttlMinutes} minutes). Sign in again to get a new code.`, 410); }
  return ch;
}

export async function verifySignInCode(challengeId: string, code: string) {
  await delay(200);
  const ch = liveChallenge(challengeId);
  const u = db.users.find((x) => x.userId === ch.userId)!;
  if (code.trim() !== ch.code) {
    ch.attempts++;
    audit('auth.otp_failed', 'user', u.userId, { attempts: ch.attempts });
    if (ch.attempts >= OTP_RULES.maxAttempts) { challenges.delete(challengeId); persist(); throw new ApiError('OTP_LOCKED', 'Too many incorrect codes. Sign in again to get a new code.', 429); }
    persist();
    const left = OTP_RULES.maxAttempts - ch.attempts;
    throw new ApiError('OTP_INVALID', `That code is incorrect. ${left} attempt${left === 1 ? '' : 's'} left.`, 401, { code: 'Incorrect code' });
  }
  challenges.delete(challengeId);
  return completeSignIn(u, 'Email OTP');
}

export async function resendSignInCode(challengeId: string) {
  await delay(200);
  const ch = liveChallenge(challengeId);
  const wait = Math.ceil((ch.resendAt - Date.now()) / 1000);
  if (wait > 0) throw new ApiError('OTP_WAIT', `You can request a new code in ${wait} seconds.`, 429);
  Object.assign(ch, { code: randomDigits(OTP_RULES.digits), expiresAt: Date.now() + OTP_RULES.ttlMinutes * 60_000, resendAt: Date.now() + OTP_RULES.resendSeconds * 1000, attempts: 0 });
  audit('auth.otp_sent', 'user', ch.userId, { channel: 'Email', resend: true });
  persist();
  return { expiresAt: new Date(ch.expiresAt).toISOString(), resendAfterSeconds: OTP_RULES.resendSeconds };
}

/** DEMO ONLY (showDemoLogins): the mock cannot send email, so the review page reads the code here. The real API never returns it. */
export const demoSignInCode = (challengeId: string) => challenges.get(challengeId)?.code ?? null;

/** Session timeout: called by the portal when the inactivity limit is reached. */
export function expireSession(minutes: number) {
  const s = session();
  if (s) audit('auth.session_expired', 'user', s.userId, { idleMinutes: minutes });
  setSession(null);
  persist();
}

// ── Forgot password → email → reset form ────────────────────────────────────
export async function requestPasswordReset(email: string) {
  await delay(300);
  const p = portalPolicy();
  const u = findPortalUser(email);
  if (u && u.status === 'Active') {
    db.passwordResets = (db.passwordResets ?? []).filter((r) => r.userId !== u.userId || r.usedAt); // a new link replaces older unused ones
    const created = nowIso();
    db.passwordResets.push({ token: randomToken(), userId: u.userId, createdAt: created, expiresAt: new Date(Date.now() + p.resetLinkMinutes * 60_000).toISOString() });
    audit('auth.password_reset_requested', 'user', u.userId, { channel: 'Email', to: maskEmail(u.userId) });
    persist();
  }
  // Same answer whether or not the email has an account.
  return { expiresInMinutes: p.resetLinkMinutes };
}

/** DEMO ONLY (showDemoLogins): the reset link that would have been emailed. */
export function demoResetToken(email: string) {
  const u = findPortalUser(email);
  const r = u && (db.passwordResets ?? []).find((x) => x.userId === u.userId && !x.usedAt && new Date(x.expiresAt).getTime() > Date.now());
  return r ? r.token : null;
}

function liveReset(token: string) {
  const r = (db.passwordResets ?? []).find((x) => x.token === token);
  if (!r) throw new ApiError('RESET_INVALID', 'This reset link is not valid. It may be incomplete, or a newer link has replaced it.', 404);
  if (r.usedAt) throw new ApiError('RESET_USED', 'This reset link has already been used. If you did not change your password, request a new link.', 410);
  if (new Date(r.expiresAt).getTime() < Date.now()) throw new ApiError('RESET_EXPIRED', `This reset link has expired (links are valid for ${portalPolicy().resetLinkMinutes} minutes). Request a new one.`, 410);
  const u = db.users.find((x) => x.userId === r.userId);
  if (!u) throw new ApiError('RESET_INVALID', 'This reset link is not valid.', 404);
  return { r, u };
}

export async function checkResetToken(token: string) {
  await delay(150);
  const { r, u } = liveReset(token);
  return { email: u.userId, realm: u.realm as PortalRealm, expiresAt: r.expiresAt, minLength: portalPolicy().passwordMinLength };
}

export async function resetPassword(token: string, password: string) {
  await delay(300);
  const { r, u } = liveReset(token);
  const failed = passwordChecks(password, portalPolicy().passwordMinLength, u.userId).find((c) => !c.ok);
  if (failed) throw new ApiError('VALIDATION_FAILED', `The new password needs: ${failed.label.toLowerCase()}.`, 422, { password: failed.label });
  if (password === u.password) throw new ApiError('VALIDATION_FAILED', 'Choose a password different from your current one.', 422, { password: 'Same as the current password' });
  u.password = password; u.failed = 0; u.lockedUntil = undefined; // a successful reset also unlocks the account
  r.usedAt = nowIso();
  db.passwordResets = (db.passwordResets ?? []).filter((x) => x === r || x.userId !== u.userId);
  for (const [id, c] of challenges) if (c.userId === u.userId) challenges.delete(id);
  audit('auth.password_reset', 'user', u.userId, { via: 'Email link', unlocked: true });
  persist();
  return { email: u.userId, realm: u.realm as PortalRealm };
}

// ── Request portal access (client or vendor) ────────────────────────────────
const first9 = (t?: string) => tinDigits(t).slice(0, 9);

export async function requestPortalAccess(f: ClientPortalForm) {
  await delay(400);
  const p = portalPolicy();
  const parsed = portalAccessSchema(p.passwordMinLength).safeParse(f);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    throw new ApiError('VALIDATION_FAILED', 'Check the highlighted fields.', 422, fields);
  }
  const email = normalizeEmail(f.email);
  const vendor = f.accountType === 'vendor';

  // One email = one company: the email must not already sign in anywhere, or be on file for another client or supplier.
  if (db.users.some((u) => normalizeEmail(u.userId) === email || normalizeEmail(u.email) === email))
    throw new ApiError('EMAIL_IN_USE', 'This email already has an account. One email can belong to only one company — sign in, or use Forgot password.', 409, { email: 'Already registered — one email can belong to only one company' });
  if (db.clients.some((c) => c.contacts.some((x) => x.email && normalizeEmail(x.email) === email)))
    throw new ApiError('EMAIL_OTHER_COMPANY', 'This email is already on file for an existing Delbros client. One email can belong to only one company — ask that company’s Account Executive to add you as a portal user, or use a different email.', 409, { email: 'Already on file for an existing client company' });
  if (db.vendors.some((v) => v.email && normalizeEmail(v.email) === email))
    throw new ApiError('EMAIL_OTHER_COMPANY', 'This email is already on file for an existing Delbros supplier. One email can belong to only one company — contact Delbros Procurement, or use a different email.', 409, { email: 'Already on file for an existing supplier' });

  // One TIN = one company (first 9 digits; the last digits are the BIR branch code).
  const tin = first9(f.tin);
  if (!vendor && (db.clients.some((c) => first9(c.tin) === tin) || db.accreditations.some((a) => first9(a.bici.tin) === tin)))
    throw new ApiError('TIN_IN_USE', 'A client with this TIN is already registered. Ask your Account Executive to add you as a portal user instead of submitting a new request.', 409, { tin: 'A client with this TIN is already registered' });
  if (vendor && db.vendors.some((v) => first9(v.tin) === tin))
    throw new ApiError('TIN_IN_USE', 'A supplier with this TIN is already registered. Please contact Delbros Procurement.', 409, { tin: 'A supplier with this TIN is already registered' });

  const name = `${f.firstName.trim()} ${f.lastName.trim()}`;
  const submittedAt = nowIso();
  let subjectId: string; let reviewer: PortalContact;
  if (vendor) {
    subjectId = `V-${String(Math.max(0, ...db.vendors.map((v) => Number(v.vendorId.replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;
    db.vendors.push({ vendorId: subjectId, name: f.clientName.trim(), tin: f.tin.trim(), address: f.address1.trim(), email, paymentTerms: 'To be agreed', status: 'Pending', contactPerson: name, phone: f.phone.trim(), portalAccess: false, portalUserId: email, statusReason: 'Portal access request — Procurement review' });
    db.users.push({ userId: email, name: f.clientName.trim(), designation: 'Vendor', status: 'Inactive', realm: 'VENDOR_PORTAL', vendorId: subjectId, branchCode: f.branchCode, branchAccess: [], email, roles: ['VENDOR'], password: f.password, failed: 0 });
    reviewer = p.support.vendor;
    const aps = db.users.filter((u) => u.realm === 'INTERNAL' && u.roles.some((r) => r === 'APS_OFFICER' || r === 'APS_MANAGER')).map((u) => u.userId);
    notify('vendor.portal_registered', `New vendor portal request: ${f.clientName.trim()}`, `TIN ${f.tin.trim()} · ${f.documents.length} document(s) — review and accredit the supplier.`, { extraUsers: aps, link: '/procurement/vendors' });
  } else {
    subjectId = nextNo('CL', 'C-', 5);
    const ae = 'AE.JREYES';
    db.clients.unshift({
      clientCode: subjectId, clientName: f.clientName.trim(), billingName: f.clientName.trim(), address1: f.address1.trim(), country: 'PHILIPPINES', billingCycle: 'Weekly', aeAssigned: ae, branchCode: f.branchCode,
      status: 'Draft', allowLt: false, allowSt: false, allowOnline: false, allowSpecial: false, allowRescue: false, cwsBranchAccess: [f.branchCode], isLegal: false, isCollectionAgency: false,
      registrationSource: 'Portal', createdAt: submittedAt, tin: f.tin.trim(), contacts: [{ id: `${subjectId}-1`, firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.trim(), email, isPrimary: true }],
    });
    db.users.push({ userId: email, name, designation: `Client — ${f.clientName.trim()}`, status: 'Inactive', realm: 'CLIENT_PORTAL', clientCode: subjectId, branchCode: f.branchCode, branchAccess: [], email, roles: ['CLIENT'], password: f.password, failed: 0 });
    reviewer = accountExecutiveOf(subjectId);
    notify('client.portal_registered', `New portal registration: ${f.clientName.trim()}`, `TIN ${f.tin.trim()} · ${f.documents.length} document(s). Review and approve, then submit for accreditation.`, { aeUserId: ae, link: `/clients/${subjectId}` });
  }
  const reference = nextNo('PAR', 'PAR-', 6);
  (db.accessRequests ??= []).unshift({
    reference, accountType: f.accountType, subjectId, companyName: f.clientName.trim(), tin: f.tin.trim(), branchCode: f.branchCode, address: f.address1.trim(),
    contactName: name, email, phone: f.phone.trim(), documents: [...f.documents], submittedAt, status: 'Submitted', reviewer: reviewer.name ?? reviewer.role,
  });
  audit(vendor ? 'vendor.portal_registered' : 'client.portal_registered', vendor ? 'vendor' : 'client', subjectId, { reference, companyName: f.clientName.trim(), tin: f.tin.trim(), documents: f.documents });
  persist();
  return { reference, accountType: f.accountType, subjectId, email, submittedAt, reviewer, companyName: f.clientName.trim(), tin: f.tin.trim(), branchCode: f.branchCode, contactName: name, phone: f.phone.trim(), documents: [...f.documents] };
}
