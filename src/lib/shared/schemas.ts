import { z } from 'zod';

// Zod schemas shared by forms (and the API later). Messages are user-facing.
const req = (label: string) => z.string().trim().min(1, `${label} is required`);
const phone = z.string().trim().regex(/^[+\d][\d\s()-]{6,}$/, 'Enter a valid phone number');

export const loginSchema = z.object({ userId: req('User ID').max(20), password: req('Password') });

export const changePasswordSchema = (minLen = 10) =>
  z.object({
    current: req('Current password'),
    next: z.string().min(minLen, `At least ${minLen} characters`).regex(/[A-Z]/, 'Include an uppercase letter').regex(/[a-z]/, 'Include a lowercase letter').regex(/\d/, 'Include a digit'),
    confirm: z.string(),
  }).refine((v) => v.next === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

export const clientInternalSchema = z.object({
  clientCode: req('Company code').max(14).regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, digits and dashes'),
  clientName: req('Company name').max(150),
  billingName: req('Billing name').max(150),
  branchCode: req('Branch'),
  address1: req('Registered address').max(150),
  address2: z.string().max(150).optional(),
  firstName: req('Contact first name').max(100),
  lastName: req('Contact last name').max(100),
  phone,
  email: z.string().email('Enter a valid email'),
  aeAssigned: req('AE assigned'),
});
export type ClientInternalForm = z.infer<typeof clientInternalSchema>;

// ── Portal identity & password rules (portal sign-in review 2026-11-11) ─────
/** Email is the sign-in ID for client and vendor portal users: compared trimmed and case-insensitive. */
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
/** "client@abclogistics.ph" → "cl****@abclogistics.ph" (shown on the one-time-code step). */
export function maskEmail(e: string) {
  const [name, domain] = e.split('@');
  if (!domain) return e;
  return `${name.slice(0, Math.min(2, name.length))}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}
/** BIR TIN: 000-000-000 plus an optional 3–5 digit branch code. */
export const TIN_PATTERN = /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/;
export const tinDigits = (t?: string) => (t ?? '').replace(/\D/g, '');

/** Password rules from System settings (auth.password_min_length) — the same list drives the live checklist and the server check. */
export function passwordChecks(pw: string, minLen = 10, email?: string) {
  const local = email ? normalizeEmail(email).split('@')[0] : '';
  return [
    { key: 'length', label: `At least ${minLen} characters`, ok: pw.length >= minLen },
    { key: 'upper', label: 'An uppercase letter (A–Z)', ok: /[A-Z]/.test(pw) },
    { key: 'lower', label: 'A lowercase letter (a–z)', ok: /[a-z]/.test(pw) },
    { key: 'digit', label: 'A number (0–9)', ok: /\d/.test(pw) },
    ...(local.length >= 3 ? [{ key: 'email', label: 'Does not contain your email name', ok: !!pw && !pw.toLowerCase().includes(local) }] : []),
  ];
}
export const passwordOk = (pw: string, minLen = 10, email?: string) => passwordChecks(pw, minLen, email).every((c) => c.ok);

/** Supporting documents accepted with a portal access request. */
export const ACCESS_DOC_MAX_MB = 5;
export const ACCESS_DOC_ACCEPT = 'application/pdf,image/jpeg,image/png';

/** Portal access request (client or vendor). Password minimum length follows System settings. */
export const portalAccessSchema = (minLen = 10) => z.object({
  accountType: z.enum(['client', 'vendor']),
  clientName: req('Company name').max(150),
  tin: z.string().trim().min(1, 'TIN is required').regex(TIN_PATTERN, 'Use the BIR format 000-000-000-000'),
  branchCode: req('Branch'),
  address1: req('Business address').max(150),
  firstName: req('First name').max(100),
  lastName: req('Last name').max(100),
  phone,
  email: z.string().trim().email('Enter a valid email'),
  documents: z.array(z.string()).min(1, 'Attach at least one supporting document'),
  password: z.string(),
  confirm: z.string(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Consent is required under the Data Privacy Act' }) }),
}).superRefine((v, ctx) => {
  const failed = passwordChecks(v.password, minLen, v.email).find((c) => !c.ok);
  if (failed) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: `Password needs: ${failed.label.toLowerCase()}` });
  if (v.password !== v.confirm) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm'], message: "Passwords don't match" });
});
export const clientPortalSchema = portalAccessSchema(10);
export type ClientPortalForm = z.infer<typeof clientPortalSchema>;

export const ewaSchema = z.object({
  clientCode: req('Client'),
  contractNo: req('Contract'),
  branchCode: req('Pickup branch'),
  driverName: req('Driver name'),
  driverLicenseNo: req('Driver licence no.'),
  truckPlateNo: req('Truck plate no.'),
  trucker: req('Trucker'),
  units: z.array(z.object({ equipmentType: req('Equipment type'), qty: z.coerce.number().int().min(1, 'Min 1') })).min(1, 'Add at least one unit'),
  // Portal New EWA review (2026-11-11): optional extras.
  truckOrcr: z.string().optional(), expectedPickupAt: z.string().optional(), remarks: z.string().optional(),
});
export type EwaForm = z.infer<typeof ewaSchema>;
/** LTO formats (proposed — Operations / Gate to confirm): plate "ABC 1234" / "AB 1234" / "ABC 123"; driver licence "N01-23-456789". Checked in the form and by the API. */
export const PLATE_RE = /^[A-Z]{2,3} ?\d{3,4}$/;
export const LICENCE_RE = /^[A-Z]\d{2}-\d{2}-\d{6}$/;

export const rescueRequestSchema = z.object({
  chassisNo: req('Chassis / unit'),
  locationText: req('Location'),
  incident: req('Incident description'),
  sceneContactName: req('Scene contact name'),
  sceneContactPhone: phone,
  urgent: z.boolean(),
  loadStatus: z.enum(['Loaded', 'Empty']).optional(),
  photos: z.array(z.string()).optional(), // file names of supporting photos (DBL-RES-001)
});
export type RescueRequestForm = z.infer<typeof rescueRequestSchema>;
