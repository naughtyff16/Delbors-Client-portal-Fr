import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, CheckCircle2, Clock, Eye, EyeOff, FileText, KeyRound, MailCheck, ShieldCheck, Truck } from 'lucide-react';
import { api, ApiError, type PortalContact, type PortalRealm } from '../lib/api-client';
import { ACCESS_DOC_ACCEPT, ACCESS_DOC_MAX_MB, formatDateTime, passwordOk, portalAccessSchema, type ClientPortalForm } from '../lib/shared';
import { Banner, Button, Card, ChangeLogLauncher, Checkbox, FormGrid, Input, Select, Stack, cn } from '../lib/ui';
import logo from '../assets/delbros-logo.png';
import { clearSignOutReason, previewSessionExpired, readSignOutReason, usePortalAuth } from '../auth';
import { ContactLine, PasswordRules, PrivacyNoticeModal, useAppConfig, useNow } from './common';

type Tone = NonNullable<ComponentProps<typeof Banner>['tone']>;
const REALM_LABEL: Record<PortalRealm, string> = { CLIENT_PORTAL: 'Client', VENDOR_PORTAL: 'Vendor / supplier' };
const DEMO_PASSWORD = 'Demo@2026';

/** Shared brand header for the sign-in, registration and password-reset pages. */
function BrandBlock() {
  return <div className="mb-6 flex items-center justify-center gap-3"><img src={logo} alt="Delbros" className="h-12" /><div><p className="text-xl font-bold text-brand-800">Delbros Leasing</p><p className="text-sm text-muted">Client & vendor portal</p></div></div>;
}

/** Page footer for the public pages: privacy notice link. */
function PublicFooter() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="mt-4 text-center text-xs text-muted">© Delbros Group · <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setOpen(true)}>Privacy notice</button> · Data Privacy Act of 2012</p>
      <PrivacyNoticeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Show / hide toggle on a password field. */
function PasswordField({ label, value, onChange, autoComplete, placeholder, error, required = true }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string; error?: string; required?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input label={label} type={show ? 'text' : 'password'} autoComplete={autoComplete} required={required} className="pr-10" value={value} error={error} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={show} className="absolute right-0 top-[25px] flex h-9 w-10 items-center justify-center rounded-r-lg text-muted hover:text-ink">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
    </div>
  );
}

// ── Sign-in ─────────────────────────────────────────────────────────────────
interface SignInError { code: string; message: string; details?: Record<string, unknown> }
const toError = (x: unknown): SignInError => (x instanceof ApiError ? { code: x.code, message: x.message, details: x.details } : { code: 'UNKNOWN', message: 'Sign-in failed. Check your connection and try again.' });

/** One message per account state: wrong email/password (without saying which), locked, inactive, not accredited, pending, wrong portal. */
const SIGN_IN_ALERT: Record<string, [Tone, string]> = {
  INVALID_CREDENTIALS: ['danger', 'Sign-in failed'],
  ACCOUNT_LOCKED: ['danger', 'Account locked'],
  ACCOUNT_INACTIVE: ['warning', 'Account inactive'],
  NOT_ACCREDITED: ['warning', 'Company not yet accredited'],
  ACCOUNT_PENDING: ['info', 'Access request still under review'],
  WRONG_PORTAL: ['info', 'Wrong portal selected'],
  OTP_EXPIRED: ['warning', 'Sign-in code expired'],
  OTP_LOCKED: ['danger', 'Too many incorrect codes'],
};

function SignInAlert({ err, realm, email, onSwitch }: { err: SignInError; realm: PortalRealm; email: string; onSwitch: (r: PortalRealm) => void }) {
  const p = api.auth.policy();
  const [tone, title] = SIGN_IN_ALERT[err.code] ?? ['danger', 'Sign-in failed'];
  const contact = err.details?.contact as PortalContact | undefined;
  const other = err.details?.realm as PortalRealm | undefined;
  return (
    <Banner tone={tone} title={title}>
      <p>{err.message}</p>
      {err.code === 'INVALID_CREDENTIALS' && (
        <p className="mt-1">Check that you chose the right tab ({REALM_LABEL[realm]}). After {p.maxFailed} failed attempts the account is locked for {p.lockoutMinutes} minutes. <Link to={`/forgot-password?email=${encodeURIComponent(email)}`} className="font-medium underline">Forgot password?</Link></p>
      )}
      {err.code === 'ACCOUNT_LOCKED' && <p className="mt-1"><Link to={`/forgot-password?email=${encodeURIComponent(email)}`} className="font-medium underline">Reset your password</Link> to unlock it now.</p>}
      {err.code === 'WRONG_PORTAL' && other && <Button size="sm" variant="secondary" className="mt-2" onClick={() => onSwitch(other)}>Switch to {REALM_LABEL[other]}</Button>}
      {contact && <div className="mt-2 border-t border-current/15 pt-2"><p className="text-xs opacity-80">Need help? Contact:</p><ContactLine contact={contact} /></div>}
    </Banner>
  );
}

interface OtpChallenge { challengeId: string; maskedEmail: string; expiresAt: string; resendAfterSeconds: number }
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Second factor: 6-digit code sent to the user's email (System settings → auth.portal_second_factor). */
function OtpStep({ initial, showDemo, onBack }: { initial: OtpChallenge; showDemo: boolean; onBack: (err?: SignInError) => void }) {
  const { verifyOtp } = usePortalAuth();
  const [ch, setCh] = useState(initial);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.now() + initial.resendAfterSeconds * 1000);
  const [resent, setResent] = useState(false);
  const now = useNow();
  const expiresIn = Math.max(0, Math.ceil((Date.parse(ch.expiresAt) - now) / 1000));
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const demoCode = showDemo ? api.auth.demoOtp(ch.challengeId) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(undefined);
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code from the email.'); return; }
    setBusy(true);
    try { await verifyOtp(ch.challengeId, code); } catch (x) {
      if (x instanceof ApiError && (x.code === 'OTP_EXPIRED' || x.code === 'OTP_LOCKED')) onBack(toError(x));
      else { setErr(x instanceof ApiError ? x.message : 'Could not verify the code. Try again.'); setCode(''); }
    } finally { setBusy(false); }
  };
  const resend = async () => {
    setErr(undefined);
    try { const r = await api.auth.resendOtp(ch.challengeId); setCh({ ...ch, expiresAt: r.expiresAt }); setResendAt(Date.now() + r.resendAfterSeconds * 1000); setResent(true); setCode(''); }
    catch (x) { if (x instanceof ApiError && x.code === 'OTP_EXPIRED') onBack(toError(x)); else setErr(x instanceof ApiError ? x.message : 'Could not send a new code.'); }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="text-center">
        <span className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600"><ShieldCheck className="size-6" aria-hidden /></span>
        <h1 className="text-lg font-bold text-brand-800">Enter your sign-in code</h1>
        <p className="mt-1 text-sm text-ink-2">We emailed a 6-digit code to <span className="font-medium text-ink">{ch.maskedEmail}</span>.{' '}
          {expiresIn > 0 ? <>It expires in <span className="font-medium tabular-nums text-ink">{mmss(expiresIn)}</span>.</> : null}</p>
      </div>
      {resent && !err && expiresIn > 0 && <Banner tone="success">A new code is on its way. Earlier codes no longer work.</Banner>}
      {expiresIn === 0 ? (
        <Banner tone="warning" title="Code expired">This code is no longer valid. Sign in again to get a new code.</Banner>
      ) : err ? <Banner tone="danger">{err}</Banner> : null}
      <Input label="6-digit code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} disabled={expiresIn === 0}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" className="text-center font-mono text-lg tracking-[0.5em]" />
      {expiresIn === 0
        ? <Button size="lg" className="w-full" onClick={() => onBack()}>Sign in again</Button>
        : <Button type="submit" size="lg" className="w-full" loading={busy}>Verify and sign in</Button>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" onClick={() => onBack()}><ArrowLeft className="size-4" aria-hidden />Use a different account</button>
        <button type="button" className="font-medium text-brand-600 hover:underline disabled:text-muted disabled:no-underline" disabled={resendIn > 0 || expiresIn === 0} onClick={resend}>{resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}</button>
      </div>
      <p className="text-xs text-muted">Didn’t get it? Check your spam folder. The code works once, for this sign-in only. Delbros will never ask you for this code by phone or chat.</p>
      {demoCode && (
        <p className="rounded-lg border border-dashed border-warning-line bg-warning-bg/60 px-3 py-2 text-[13px] text-ink-2">
          <span className="font-semibold text-warning">Demo.</span> The emailed code is <code className="rounded bg-surface px-1 font-mono">{demoCode}</code>{' '}
          <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setCode(demoCode)}>Fill it in</button>
        </p>
      )}
    </form>
  );
}

/** Demo accounts for the UI review — one per sign-in state. Shown only when app-config.json has "showDemoLogins": true (never in production). */
const DEMO_ACCOUNTS: { realm: PortalRealm; email: string; state: string; tone: 'ok' | 'warn' | 'bad' }[] = [
  { realm: 'CLIENT_PORTAL', email: 'client@abclogistics.ph', state: 'Active — ABC Logistics', tone: 'ok' },
  { realm: 'CLIENT_PORTAL', email: 'client@pacificmovers.ph', state: 'On hold — signs in; EWA and rescue blocked', tone: 'warn' },
  { realm: 'CLIENT_PORTAL', email: 'ops@southernhaulers.ph', state: 'Allow Online = No — signs in; EWA restricted', tone: 'warn' },
  { realm: 'CLIENT_PORTAL', email: 'rico@northstar.ph', state: 'Not accredited', tone: 'bad' },
  { realm: 'CLIENT_PORTAL', email: 'tess@islandlink.ph', state: 'Access request pending', tone: 'bad' },
  { realm: 'CLIENT_PORTAL', email: 'j.cruz@abclogistics.ph', state: 'Inactive user', tone: 'bad' },
  { realm: 'CLIENT_PORTAL', email: 'dispatch@visayasfreight.ph', state: 'Locked', tone: 'bad' },
  { realm: 'VENDOR_PORTAL', email: 'vendor@tirepro.ph', state: 'Active — Tire Pro Supply', tone: 'ok' },
  { realm: 'VENDOR_PORTAL', email: 'sales@luzonbrake.ph', state: 'Not accredited', tone: 'bad' },
  { realm: 'VENDOR_PORTAL', email: 'orders@metropaint.ph', state: 'Inactive supplier', tone: 'bad' },
];

function DemoBox({ realm, onPick, onPreviewExpired }: { realm: PortalRealm; onPick: (realm: PortalRealm, email: string) => void; onPreviewExpired: () => void }) {
  const p = api.auth.policy();
  const group = (r: PortalRealm) => (
    <div>
      <p className={cn('mt-2 text-xs font-semibold uppercase tracking-wide', r === realm ? 'text-ink-2' : 'text-muted')}>{REALM_LABEL[r]} tab</p>
      <ul className="mt-1 space-y-0.5">
        {DEMO_ACCOUNTS.filter((a) => a.realm === r).map((a) => (
          <li key={a.email} className="flex flex-wrap items-baseline gap-x-2">
            <button type="button" className="font-mono text-brand-600 hover:underline" onClick={() => onPick(a.realm, a.email)}>{a.email}</button>
            <span className={cn('text-xs', a.tone === 'ok' ? 'text-success' : a.tone === 'warn' ? 'text-warning' : 'text-danger')}>{a.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="mt-4 rounded-lg border border-dashed border-warning-line bg-warning-bg/60 p-3 text-[13px] text-ink-2">
      <p><span className="font-semibold text-warning">Demo — UI review only.</span> Password <code className="rounded bg-surface px-1">{DEMO_PASSWORD}</code> for every account. Click an email to fill it in.</p>
      {group('CLIENT_PORTAL')}
      {group('VENDOR_PORTAL')}
      <p className="mt-2 text-xs text-muted">
        Wrong password: any account; it locks after {p.maxFailed} attempts for {p.lockoutMinutes} minutes.{' '}
        {p.secondFactor === 'email_otp' ? 'The emailed sign-in code is shown on the code screen. ' : ''}
        Session timeout: {p.sessionTimeoutMinutes} minutes idle — <button type="button" className="font-medium text-brand-600 hover:underline" onClick={onPreviewExpired}>preview the session-expired message</button>.
      </p>
      <p className="mt-1 text-xs text-muted">Hidden in production: set <code>"showDemoLogins": false</code> in app-config.json.</p>
    </div>
  );
}

export function LoginPage() {
  const { user, signIn } = usePortalAuth();
  const loc = useLocation();
  const st = (loc.state ?? {}) as { realm?: PortalRealm; email?: string; notice?: 'password_reset' };
  const cfg = useAppConfig();
  const policy = api.auth.policy();
  const [realm, setRealm] = useState<PortalRealm>(st.realm ?? 'CLIENT_PORTAL');
  const [v, setV] = useState({ id: st.email ?? '', pw: '' });
  const [err, setErr] = useState<SignInError>();
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<OtpChallenge | null>(null);
  const [reason, setReason] = useState(readSignOutReason);
  const [notice, setNotice] = useState(st.notice);
  const [privacy, setPrivacy] = useState(false);
  useEffect(() => { clearSignOutReason(); }, []);
  if (user) return <Navigate to={user.realm === 'VENDOR_PORTAL' ? '/vendor' : '/client'} replace state={{ mainNav: true }} />;
  const clearMessages = () => { setErr(undefined); setReason(null); setNotice(undefined); };
  const switchRealm = (r: PortalRealm) => { setRealm(r); clearMessages(); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); clearMessages(); setBusy(true);
    try {
      const r = await signIn(v.id, v.pw, realm);
      if (r.status === 'otp_required') setOtp(r);
    } catch (x) {
      setErr(toError(x));
      setV((s) => ({ ...s, pw: '' }));
    } finally { setBusy(false); }
  };
  const vendor = realm === 'VENDOR_PORTAL';
  const support = vendor ? policy.support.vendor : policy.support.client;
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <ChangeLogLauncher />{/* CHANGELOG-REMOVE (temporary) */}
      <div className="w-full max-w-md">
        <BrandBlock />
        <Card>
          {otp ? (
            <OtpStep initial={otp} showDemo={cfg.showDemoLogins === true} onBack={(e) => { setOtp(null); setV((s) => ({ ...s, pw: '' })); setErr(e); }} />
          ) : (
            <>
              <div role="radiogroup" aria-label="Portal" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line-strong bg-surface-alt p-1">
                {(['CLIENT_PORTAL', 'VENDOR_PORTAL'] as const).map((val) => (
                  <button key={val} type="button" role="radio" aria-checked={realm === val} onClick={() => switchRealm(val)}
                    className={cn('h-9 rounded-md text-sm font-medium transition-colors', realm === val ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-2 hover:bg-surface hover:text-ink')}>{REALM_LABEL[val]}</button>
                ))}
              </div>
              <form onSubmit={submit} className="space-y-4">
                {reason === 'expired' && <Banner tone="info" title="Your session has expired">For your security you were signed out after {policy.sessionTimeoutMinutes} minutes without activity. Sign in again to continue — unsaved entries were not kept.</Banner>}
                {reason === 'signed_out' && <Banner tone="success">You have signed out.</Banner>}
                {notice === 'password_reset' && <Banner tone="success" title="Password updated">Sign in with your new password.</Banner>}
                {err && <SignInAlert err={err} realm={realm} email={v.id} onSwitch={switchRealm} />}
                <Input label="Email" type="email" autoComplete="username" required value={v.id} onChange={(e) => setV({ ...v, id: e.target.value })} placeholder="e.g. name@company.ph"
                  hint={`Your email is your sign-in ID for the ${vendor ? 'vendor' : 'client'} portal.`} />
                <PasswordField label="Password" autoComplete="current-password" value={v.pw} onChange={(pw) => setV({ ...v, pw })} placeholder="Enter your password" />
                <div className="-mt-2 text-right"><Link to={`/forgot-password${v.id ? `?email=${encodeURIComponent(v.id)}` : ''}`} className="text-sm font-medium text-brand-600 hover:underline">Forgot password?</Link></div>
                <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
                <p className="flex gap-2 text-xs text-muted">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden />
                  <span>Delbros processes your personal data under the Data Privacy Act of 2012 (RA 10173). By signing in, you acknowledge our{' '}
                    <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setPrivacy(true)}>Privacy notice</button>.</span>
                </p>
              </form>
              <p className="mt-4 text-center text-sm text-muted">
                {vendor ? 'New supplier?' : 'New to Delbros?'}{' '}
                <Link to={vendor ? '/register?type=vendor' : '/register'} className="font-medium text-brand-600 hover:underline">{vendor ? 'Request vendor portal access' : 'Request portal access for your company'}</Link>
                <span className="mt-1 block text-[13px] text-ink-2">{vendor ? 'Requests are reviewed by Delbros Procurement before any access is granted.' : 'Requests are reviewed by your Account Executive before any access is granted.'}</span>
              </p>
              {cfg.staffUrl && <p className="mt-3 text-center text-xs text-muted">Delbros employee? <a href={cfg.staffUrl} className="font-medium text-brand-600 hover:underline">Staff sign-in →</a></p>}
              <div className="mt-4 border-t border-line pt-3 text-ink-2">
                <p className="text-xs font-medium text-muted">Need help signing in?</p>
                {!vendor && <p className="mt-0.5 text-[13px]">Contact your Account Executive, or:</p>}
                <ContactLine contact={support} className="mt-0.5" />
              </div>
            </>
          )}
        </Card>
        <PublicFooter />
        {cfg.showDemoLogins && !otp && (
          <DemoBox realm={realm}
            onPick={(r, email) => { setRealm(r); clearMessages(); setV({ id: email, pw: DEMO_PASSWORD }); }}
            onPreviewExpired={() => { previewSessionExpired(); clearMessages(); setReason(readSignOutReason()); clearSignOutReason(); }} />
        )}
      </div>
      <PrivacyNoticeModal open={privacy} onClose={() => setPrivacy(false)} />
    </div>
  );
}

// ── SCR-05 Request portal access — client or vendor ─────────────────────────
const DOC_GUIDE: Record<ClientPortalForm['accountType'], string[]> = {
  client: ['SEC or DTI registration', 'BIR Certificate of Registration (Form 2303)', 'Mayor’s / business permit', 'Valid ID of the contact person'],
  vendor: ['SEC or DTI registration', 'BIR Certificate of Registration (Form 2303)', 'Mayor’s / business permit', 'Company profile or product / price list'],
};

export function RegisterPage() {
  const [params] = useSearchParams();
  const ref = useQuery({ queryKey: ['ref'], queryFn: () => api.ref.all() });
  const minLen = api.auth.policy().passwordMinLength;
  const schema = useMemo(() => portalAccessSchema(minLen), [minLen]);
  const f = useForm<ClientPortalForm>({ resolver: zodResolver(schema), defaultValues: { accountType: params.get('type') === 'vendor' ? 'vendor' : 'client', documents: [], password: '', confirm: '' } });
  const [done, setDone] = useState<Awaited<ReturnType<typeof api.clients.registerPortal>>>();
  const [err, setErr] = useState<string>();
  const [docErr, setDocErr] = useState<string>();
  const [privacy, setPrivacy] = useState(false);
  const e = f.formState.errors;
  const type = f.watch('accountType');
  const vendor = type === 'vendor';
  const pw = f.watch('password') ?? '';
  const [show, setShow] = useState({ password: false, confirm: false });
  const pwd = (k: 'password' | 'confirm', label: string, error?: string) => (
    <div className="relative">
      <Input type={show[k] ? 'text' : 'password'} label={label} required autoComplete="new-password" className="pr-9" error={error} {...f.register(k)} placeholder={k === 'password' ? `At least ${minLen} characters` : 'Re-enter your password'} />
      <button type="button" onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className="absolute right-2 top-[30px] rounded p-1 text-muted hover:text-ink" aria-label={show[k] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={show[k]}>
        {show[k] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
  const onFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    const big = list.filter((x) => x.size > ACCESS_DOC_MAX_MB * 1024 * 1024);
    setDocErr(big.length ? `${big.map((x) => x.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over ${ACCESS_DOC_MAX_MB} MB and ${big.length === 1 ? 'was' : 'were'} not added.` : undefined);
    f.setValue('documents', list.filter((x) => !big.includes(x)).map((x) => x.name), { shouldValidate: f.formState.isSubmitted });
  };
  const submit = f.handleSubmit(async (v) => {
    setErr(undefined);
    try { setDone(await api.clients.registerPortal(v)); window.scrollTo(0, 0); } catch (x) {
      if (x instanceof ApiError && x.fields) for (const [k, m] of Object.entries(x.fields)) f.setError(k as keyof ClientPortalForm, { message: m });
      setErr(x instanceof ApiError ? x.message : 'The request could not be sent. Try again.');
    }
  });
  const branchName = (code: string) => ref.data?.branches.find((b) => b.code === code)?.name ?? code;
  const branches = (ref.data?.branches ?? []).filter((b) => !b.isHeadOffice).map((b) => ({ value: b.code, label: b.name }));

  if (done) {
    const isVendor = done.accountType === 'vendor';
    const steps = isVendor
      ? ['Access request submitted', 'Procurement review and vendor accreditation', 'Vendor portal sign-in enabled — view POs and upload invoices']
      : ['Access request submitted', 'Account Executive approval — portal sign-in enabled', 'Accreditation (Credit & Collection → Finance → Vice President)', 'Account active — create EWAs and request rescue online'];
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
        <div className="w-full max-w-xl">
          <BrandBlock />
          <Card>
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 size-12 text-success" aria-hidden />
              <h1 className="text-xl font-bold text-brand-800">Request received</h1>
              <p className="mt-1 text-sm text-ink-2">Reference <span className="font-mono font-semibold text-ink">{done.reference}</span> · {formatDateTime(done.submittedAt)}</p>
              <p className="mt-3 text-sm text-ink-2">This is a request, not an account yet. <strong>You cannot sign in until {isVendor ? 'Delbros Procurement' : 'your Account Executive'} approves it.</strong>{' '}
                {isVendor ? 'Procurement will also complete your supplier accreditation.' : 'EWAs and rescue requests stay disabled until your company completes accreditation.'} We sent an acknowledgement to <span className="font-medium">{done.email}</span> and will email you at each step.</p>
            </div>
            <dl className="mt-5 grid gap-x-4 gap-y-2 rounded-lg border border-line bg-surface-alt/50 p-4 text-sm sm:grid-cols-[10rem_1fr]">
              {([
                ['Account type', isVendor ? 'Vendor / supplier' : 'Client company'], ['Company', done.companyName], ['TIN', done.tin], ['Contact person', done.contactName],
                ['Email (sign-in ID)', done.email], ['Phone', done.phone], ['Branch', branchName(done.branchCode)],
              ] as const).map(([k, val]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="font-medium text-ink">{val}</dd></div>)}
              <dt className="text-muted">Supporting documents</dt>
              <dd><ul className="space-y-0.5">{done.documents.map((d) => <li key={d} className="flex items-center gap-1.5 text-ink"><FileText className="size-3.5 text-muted" aria-hidden />{d}</li>)}</ul></dd>
            </dl>
            <ol className="mx-auto mt-5 space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={s} className={cn('flex items-center gap-2', i === 0 ? 'text-ink' : i === 1 ? 'text-warning' : 'text-muted')}>
                  {i === 0 ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : i === 1 ? <Clock className="size-4" aria-hidden /> : <span className="size-4 rounded-full border" aria-hidden />}{s}
                </li>
              ))}
            </ol>
            <div className="mt-5 border-t border-line pt-3 text-ink-2">
              <p className="text-xs font-medium text-muted">Questions about your request? Quote {done.reference}:</p>
              <ContactLine contact={done.reviewer} className="mt-0.5" />
            </div>
            <div className="mt-5 text-center"><Link to="/login" state={{ realm: isVendor ? 'VENDOR_PORTAL' : 'CLIENT_PORTAL' }}><Button variant="secondary">Back to sign in</Button></Link></div>
          </Card>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-2xl">
        <BrandBlock />
        <Card>
          <form onSubmit={submit} noValidate>
            <Stack>
              <div>
                <h1 className="text-lg font-bold text-brand-800">Request portal access</h1>
                <p className="mt-1 text-sm text-ink-2">This submits a request. No portal access is granted until {vendor ? 'Delbros Procurement' : 'your Account Executive'} approves it{vendor ? ' and completes supplier accreditation' : ', followed by accreditation'}.</p>
              </div>
              <div role="radiogroup" aria-label="I am requesting access for" className="grid grid-cols-2 gap-1 rounded-lg border border-line-strong bg-surface-alt p-1">
                {([['client', 'Client company', Building2], ['vendor', 'Vendor / supplier', Truck]] as const).map(([val, label, Icon]) => (
                  <button key={val} type="button" role="radio" aria-checked={type === val} onClick={() => f.setValue('accountType', val)}
                    className={cn('flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors', type === val ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-2 hover:bg-surface hover:text-ink')}><Icon className="size-4" aria-hidden />{label}</button>
                ))}
              </div>
              {err && <Banner tone="danger" title="The request was not sent">{err}</Banner>}
              <FormGrid>
                <Input label="Company name" required error={e.clientName?.message} {...f.register('clientName')} wrapperClassName="md:col-span-2" placeholder="e.g. ABC Logistics Inc." />
                <Input label="TIN" required error={e.tin?.message} {...f.register('tin')} placeholder="000-000-000-000" inputMode="numeric" hint="BIR Tax Identification Number. One TIN = one company." />
                <Select label={vendor ? 'Branch you will serve' : 'Nearest branch'} required placeholder="Select" options={branches} error={e.branchCode?.message} {...f.register('branchCode')} />
                <Input label="Business address" required error={e.address1?.message} {...f.register('address1')} wrapperClassName="md:col-span-2" placeholder="e.g. 123 Roxas Blvd, Pasay City" />
                <Input label="Contact person — first name" required error={e.firstName?.message} {...f.register('firstName')} placeholder="e.g. Juan" />
                <Input label="Contact person — last name" required error={e.lastName?.message} {...f.register('lastName')} placeholder="e.g. Dela Cruz" />
                <Input label="Phone number" required error={e.phone?.message} {...f.register('phone')} placeholder="+63 917 000 0000" />
                <Input label="Email address" type="email" required error={e.email?.message} {...f.register('email')} placeholder="e.g. name@company.ph" hint="Becomes your sign-in ID. One email can belong to only one company." />
                <div className="md:col-span-2">
                  <Input type="file" label="Supporting documents" required multiple accept={ACCESS_DOC_ACCEPT} error={e.documents?.message ?? docErr} onChange={(ev) => onFiles(ev.target.files)}
                    hint={`PDF, JPG or PNG, up to ${ACCESS_DOC_MAX_MB} MB each. Choose all files at once.`} />
                  <p className="mt-1.5 text-[13px] text-muted">Please include: {DOC_GUIDE[type].join(' · ')}.</p>
                </div>
                {pwd('password', 'Password', e.password?.message)}
                {pwd('confirm', 'Confirm password', e.confirm?.message)}
                <div className="-mt-2 md:col-span-2">
                  <p className="mb-1 text-xs font-medium text-muted">Password rules</p>
                  <PasswordRules password={pw} minLength={minLen} email={f.watch('email')} />
                </div>
              </FormGrid>
              <div>
                <Checkbox label={<>I consent to Delbros processing this information for {vendor ? 'supplier accreditation' : 'account registration and credit evaluation'}, per the Data Privacy Act of 2012. <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setPrivacy(true)}>Privacy notice</button></>} {...f.register('consent')} />
                {e.consent && <p className="mt-1 text-xs text-danger">{e.consent.message}</p>}
              </div>
              <div className="flex justify-end gap-2"><Link to="/login" state={{ realm: vendor ? 'VENDOR_PORTAL' : 'CLIENT_PORTAL' }}><Button variant="secondary">Cancel</Button></Link><Button type="submit" loading={f.formState.isSubmitting}>Submit access request</Button></div>
            </Stack>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-muted">Already have access? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
        <PublicFooter />
      </div>
      <PrivacyNoticeModal open={privacy} onClose={() => setPrivacy(false)} />
    </div>
  );
}

// ── Forgot password (portal) — US-ADM-004: request → email sent → reset form ─
export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const cfg = useAppConfig();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ expiresInMinutes: number } | null>(null);
  const [resent, setResent] = useState(false);
  const send = async () => {
    setErr(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Enter the email address you sign in with.'); return; }
    setBusy(true);
    try { const r = await api.auth.forgotPassword(email.trim()); if (sent) setResent(true); setSent(r); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send the reset link. Try again.'); } finally { setBusy(false); }
  };
  const demoToken = sent && cfg.showDemoLogins ? api.auth.demoResetToken(email.trim()) : null;
  const support = api.auth.policy().support;
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <BrandBlock />
        <Card>
          {sent ? (
            <div className="text-center">
              <MailCheck className="mx-auto mb-3 size-12 text-success" aria-hidden />
              <h1 className="text-lg font-bold text-brand-800">Check your email</h1>
              <p className="mt-2 text-sm text-ink-2">If <span className="font-medium">{email.trim()}</span> has an active portal account, we’ve sent a link to reset your password. The link works once and expires in {sent.expiresInMinutes} minutes.</p>
              <p className="mt-2 text-sm text-ink-2">Not in your inbox? Check your spam folder, or send it again.</p>
              {resent && <Banner tone="success" className="mt-3 text-left">A new link has been sent. Earlier links no longer work.</Banner>}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" loading={busy} onClick={send}>Resend link</Button>
                <Link to="/login"><Button>Back to sign in</Button></Link>
              </div>
              {cfg.showDemoLogins && (
                <p className="mt-4 rounded-lg border border-dashed border-warning-line bg-warning-bg/60 px-3 py-2 text-left text-[13px] text-ink-2">
                  <span className="font-semibold text-warning">Demo.</span>{' '}
                  {demoToken ? <>Email is not sent in the demo. <Link className="font-medium text-brand-600 hover:underline" to={`/reset-password?token=${demoToken}`}>Open the reset link from the email →</Link></>
                    : <>No email was sent: this address has no active portal account. The page shows the same message either way, so it never reveals which emails are registered.</>}
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate className="space-y-4">
              <div>
                <h1 className="text-lg font-bold text-brand-800">Reset your password</h1>
                <p className="mt-1 text-sm text-ink-2">Enter the email you use to sign in to the client or vendor portal. If an account exists for it, we’ll email you a link to set a new password. Resetting also unlocks a locked account.</p>
              </div>
              {err && <Banner tone="danger">{err}</Banner>}
              <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. name@company.ph" />
              <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
              <p className="text-center text-sm"><Link to="/login" className="font-medium text-brand-600 hover:underline">← Back to sign in</Link></p>
            </form>
          )}
          <div className="mt-5 border-t border-line pt-3 text-ink-2">
            <p className="text-xs font-medium text-muted">Still can’t sign in? Clients: your Account Executive or</p>
            <ContactLine contact={support.client} className="mt-0.5" />
            <p className="mt-1.5 text-xs font-medium text-muted">Vendors:</p>
            <ContactLine contact={support.vendor} className="mt-0.5" />
          </div>
        </Card>
        <PublicFooter />
      </div>
    </div>
  );
}

// ── Reset password (link from the email) ────────────────────────────────────
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const check = useQuery({ queryKey: ['reset-token', token], queryFn: () => api.auth.checkResetToken(token), enabled: !!token, retry: false });
  const [v, setV] = useState({ pw: '', confirm: '' });
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; realm: PortalRealm }>();
  const info = check.data;
  const ok = info ? passwordOk(v.pw, info.minLength, info.email) : false;
  const mismatch = v.confirm && v.confirm !== v.pw ? "Passwords don't match" : undefined;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTried(true); setErr(undefined);
    if (!info || !ok || !v.confirm || v.confirm !== v.pw) return;
    setBusy(true);
    try { setDone(await api.auth.resetPassword(token, v.pw)); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not update the password. Try again.'); } finally { setBusy(false); }
  };
  const linkError = !token ? 'This page needs the link from the password-reset email.' : check.error instanceof ApiError ? check.error.message : check.error ? 'This reset link could not be checked.' : undefined;
  const linkTitle = check.error instanceof ApiError && check.error.code === 'RESET_EXPIRED' ? 'Reset link expired' : check.error instanceof ApiError && check.error.code === 'RESET_USED' ? 'Reset link already used' : 'Reset link not valid';
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <BrandBlock />
        <Card>
          {done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 size-12 text-success" aria-hidden />
              <h1 className="text-lg font-bold text-brand-800">Password updated</h1>
              <p className="mt-2 text-sm text-ink-2">Your new password is set and your account is unlocked. Sign in with <span className="font-medium">{done.email}</span> and your new password.</p>
              <Link to="/login" state={{ realm: done.realm, email: done.email, notice: 'password_reset' }}><Button className="mt-6">Sign in</Button></Link>
            </div>
          ) : linkError ? (
            <div className="space-y-4">
              <Banner tone="warning" title={linkTitle}>{linkError}</Banner>
              <div className="flex flex-wrap gap-2"><Link to="/forgot-password"><Button>Request a new link</Button></Link><Link to="/login"><Button variant="secondary">Back to sign in</Button></Link></div>
            </div>
          ) : !info ? (
            <p className="text-sm text-muted">Checking your reset link…</p>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              <div>
                <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600"><KeyRound className="size-6" aria-hidden /></span>
                <h1 className="text-lg font-bold text-brand-800">Set a new password</h1>
                <p className="mt-1 text-sm text-ink-2">For <span className="font-medium text-ink">{info.email}</span> ({REALM_LABEL[info.realm]} portal). This link expires {formatDateTime(info.expiresAt)}.</p>
              </div>
              {err && <Banner tone="danger">{err}</Banner>}
              <div>
                <PasswordField label="New password" autoComplete="new-password" value={v.pw} onChange={(pw) => setV({ ...v, pw })} placeholder={`At least ${info.minLength} characters`}
                  error={tried && !v.pw ? 'Required' : tried && !ok ? 'Meet every rule below' : undefined} />
                <p className="mb-1 mt-2 text-xs font-medium text-muted">Password rules</p>
                <PasswordRules password={v.pw} minLength={info.minLength} email={info.email} />
              </div>
              <PasswordField label="Confirm new password" autoComplete="new-password" value={v.confirm} onChange={(confirm) => setV({ ...v, confirm })} placeholder="Re-enter the new password"
                error={tried && !v.confirm ? 'Required' : mismatch} />
              <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
              <p className="text-center text-sm"><Link to="/login" className="font-medium text-brand-600 hover:underline">← Back to sign in</Link></p>
            </form>
          )}
        </Card>
        <PublicFooter />
      </div>
    </div>
  );
}
