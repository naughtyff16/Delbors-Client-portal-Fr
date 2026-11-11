import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, Clock, Eye, EyeOff, MailCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api-client';
import { clientPortalSchema, loadAppConfig, type ClientPortalForm } from '../lib/shared';
import { Banner, Button, Card, ChangeLogLauncher, Checkbox, FormGrid, Input, Select, Stack, cn } from '../lib/ui';
import logo from '../assets/delbros-logo.png';
import { usePortalAuth } from '../auth';

/** Shared brand header for the sign-in, registration and password-reset pages. */
function BrandBlock() {
  return <div className="mb-6 flex items-center justify-center gap-3"><img src={logo} alt="Delbros" className="h-12" /><div><p className="text-xl font-bold text-brand-800">Delbros Leasing</p><p className="text-sm text-muted">Client & vendor portal</p></div></div>;
}

export function LoginPage() {
  const { user, login } = usePortalAuth();
  const nav = useNavigate();
  const [realm, setRealm] = useState<'CLIENT_PORTAL' | 'VENDOR_PORTAL'>('CLIENT_PORTAL');
  const [v, setV] = useState({ id: '', pw: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [staffUrl, setStaffUrl] = useState('');
  const [showDemoLogins, setShowDemo] = useState(false); // app-config.json showDemoLogins — off in production
  useEffect(() => { loadAppConfig().then((c) => { setStaffUrl(c.staffUrl ?? ''); setShowDemo(c.showDemoLogins === true); }); }, []);
  if (user) return <Navigate to={user.realm === 'VENDOR_PORTAL' ? '/vendor' : '/client'} replace state={{ mainNav: true }} />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(undefined); setBusy(true);
    try { const u = await login(v.id, v.pw, realm); nav(u?.realm === 'VENDOR_PORTAL' ? '/vendor' : '/client', { replace: true, state: { mainNav: true } }); } catch (x) { setErr(x instanceof ApiError ? (x.code === 'INVALID_CREDENTIALS' ? 'Invalid email or password. Check that you selected the right portal (Client or Vendor) and try again.' : x.message) : 'Sign-in failed'); } finally { setBusy(false); }
  };
  const demo = realm === 'CLIENT_PORTAL' ? ['client@abclogistics.ph', 'client@pacificmovers.ph'] : ['vendor@tirepro.ph'];
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <ChangeLogLauncher />{/* CHANGELOG-REMOVE (temporary) */}
      <div className="w-full max-w-md">
        <BrandBlock />
        <Card>
          <div role="radiogroup" aria-label="Portal" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line-strong bg-surface-alt p-1">
            {([['CLIENT_PORTAL', 'Client'], ['VENDOR_PORTAL', 'Vendor / supplier']] as const).map(([val, label]) => (
              <button key={val} type="button" role="radio" aria-checked={realm === val} onClick={() => setRealm(val)}
                className={cn('h-9 rounded-md text-sm font-medium transition-colors', realm === val ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-2 hover:bg-surface hover:text-ink')}>{label}</button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-4">
            {err && <Banner tone="danger" title="Sign-in failed">{err}</Banner>}
            <Input label="Email" type="email" autoComplete="username" required value={v.id} onChange={(e) => setV({ ...v, id: e.target.value })} placeholder="e.g. name@company.ph" />
            <div className="relative">
              <Input label="Password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required className="pr-10" value={v.pw} onChange={(e) => setV({ ...v, pw: e.target.value })} placeholder="Enter your password" />
              <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw} className="absolute bottom-0 right-0 flex h-9 w-10 items-center justify-center rounded-r-lg text-muted hover:text-ink">{showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            </div>
            <div className="-mt-2 text-right"><Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">Forgot password?</Link></div>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
          </form>
          {realm === 'CLIENT_PORTAL' && <p className="mt-4 text-center text-sm text-muted">New to Delbros? <Link to="/register" className="font-medium text-brand-600 hover:underline">Request portal access for your company</Link><span className="mt-1 block text-[13px] text-ink-2">Requests are reviewed by your Account Executive before any access is granted.</span></p>}
          {staffUrl && <p className="mt-3 text-center text-xs text-muted">Delbros employee? <a href={staffUrl} className="font-medium text-brand-600 hover:underline">Staff sign-in →</a></p>}
        </Card>
        {showDemoLogins && (
          <div className="mt-4 rounded-lg border border-dashed border-warning-line bg-warning-bg/60 p-3 text-[13px] text-ink-2">
            <p><span className="font-semibold text-warning">Demo.</span> Password <code className="rounded bg-surface px-1">Demo@2026</code>. Try:</p>
            <div className="mt-1 flex flex-wrap gap-2">{demo.map((d) => <button key={d} className="font-mono text-brand-600 hover:underline" onClick={() => setV({ id: d, pw: 'Demo@2026' })}>{d}</button>)}</div>
            {realm === 'CLIENT_PORTAL' && <p className="mt-1 text-xs text-muted">Pacific Movers is ON HOLD — see how the portal blocks EWA and rescue.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SCR-05 Client Registration — External (Portal) ─────────────────────────
export function RegisterPage() {
  const ref = useQuery({ queryKey: ['ref'], queryFn: () => api.ref.all() });
  const f = useForm<ClientPortalForm>({ resolver: zodResolver(clientPortalSchema) });
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string>();
  const e = f.formState.errors;
  const pw = f.watch('password') ?? '';
  const rules = [['At least 10 characters', pw.length >= 10], ['Uppercase letter', /[A-Z]/.test(pw)], ['Lowercase letter', /[a-z]/.test(pw)], ['A digit', /\d/.test(pw)]] as const;
  const [show, setShow] = useState({ password: false, confirm: false });
  const pwd = (k: 'password' | 'confirm', label: string, error?: string) => (
    <div className="relative">
      <Input type={show[k] ? 'text' : 'password'} label={label} required autoComplete="new-password" className="pr-9" error={error} {...f.register(k)} placeholder={k === 'password' ? 'At least 10 characters' : 'Re-enter your password'} />
      <button type="button" onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className="absolute right-2 top-[30px] rounded p-1 text-muted hover:text-ink" aria-label={show[k] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={show[k]}>
        {show[k] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
  const submit = f.handleSubmit(async (v) => {
    setErr(undefined);
    try { await api.clients.registerPortal(v); setDone(true); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Registration failed'); }
  });
  const branches = (ref.data?.branches ?? []).filter((b) => !b.isHeadOffice).map((b) => ({ value: b.code, label: b.name }));
  if (done) return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Card className="max-w-lg text-center">
        <Clock className="mx-auto mb-3 size-12 text-warning" />
        <h1 className="text-xl font-bold text-brand-800">Registration request received — pending approval</h1>
        <p className="mt-2 text-sm text-ink-2">This is a request, not an account. Your Account Executive has been notified and will review it. <strong>You cannot sign in to the portal until the Account Executive approves</strong>, and EWAs and rescue requests stay disabled until your company completes accreditation (background and credit investigation). We'll email you at each step.</p>
        <ol className="mx-auto mt-5 max-w-sm space-y-2 text-left text-sm">
          <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" /> Registration request submitted</li>
          <li className="flex items-center gap-2 text-warning"><Clock className="size-4" /> Account Executive approval — portal sign-in enabled</li>
          <li className="flex items-center gap-2 text-muted"><span className="size-4 rounded-full border" /> Accreditation (C&amp;C → Finance → VP)</li>
          <li className="flex items-center gap-2 text-muted"><span className="size-4 rounded-full border" /> Account active — create EWAs and request rescue online</li>
        </ol>
        <Link to="/login"><Button variant="secondary" className="mt-6">Back to sign in</Button></Link>
      </Card>
    </div>
  );
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-2xl">
        <BrandBlock />
        <Card>
          <form onSubmit={submit} noValidate>
            <Stack>
              <div>
                <h1 className="text-lg font-bold text-brand-800">Request portal access for your company</h1>
                <p className="mt-1 text-sm text-ink-2">This submits a registration request. No portal access is granted until your Account Executive approves it, followed by accreditation.</p>
                <p className="mt-1 text-[13px] text-muted">For client companies only — vendors and suppliers, please contact Delbros Procurement for portal access.</p>
              </div>
              {err && <Banner tone="danger">{err}</Banner>}
              <FormGrid>
                <Input label="Company name" required error={e.clientName?.message} {...f.register('clientName')} wrapperClassName="md:col-span-2" placeholder="e.g. ABC Logistics Inc." />
                <Select label="Nearest branch" required placeholder="Select" options={branches} error={e.branchCode?.message} {...f.register('branchCode')} />
                <Input label="Business address" required error={e.address1?.message} {...f.register('address1')} placeholder="e.g. 123 Roxas Blvd, Pasay City" />
                <Input label="Contact first name" required error={e.firstName?.message} {...f.register('firstName')} placeholder="e.g. Juan" />
                <Input label="Contact last name" required error={e.lastName?.message} {...f.register('lastName')} placeholder="e.g. Dela Cruz" />
                <Input label="Phone number" required error={e.phone?.message} {...f.register('phone')} placeholder="+63 917 000 0000" />
                <Input label="Email address" type="email" required error={e.email?.message} {...f.register('email')} hint="Becomes your sign-in" placeholder="e.g. name@company.ph" />
                <div>
                  {pwd('password', 'Password', e.password?.message)}
                  {/* Live checklist, same pattern as staff Change password (X04); rules follow clientPortalSchema. */}
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-live="polite">
                    {rules.map(([t, ok]) => <li key={t} className={cn('flex items-center gap-1.5', ok ? 'font-medium text-success' : 'text-muted')}>{ok ? <Check className="size-3.5" aria-hidden /> : <span className="mx-[5px] size-1.5 rounded-full bg-disabled" aria-hidden />}{t}<span className="sr-only">{ok ? ' — met' : ' — not met yet'}</span></li>)}
                  </ul>
                </div>
                {pwd('confirm', 'Confirm password', e.confirm?.message)}
              </FormGrid>
              <Checkbox label="I consent to Delbros processing this information for account registration and credit evaluation, per the Data Privacy Act of 2012." {...f.register('consent')} />
              {e.consent && <p className="-mt-3 text-xs text-danger">{e.consent.message}</p>}
              <div className="flex justify-end gap-2"><Link to="/login"><Button variant="secondary">Cancel</Button></Link><Button type="submit" loading={f.formState.isSubmitting}>Submit registration request</Button></div>
            </Stack>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-muted">Already have access? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
      </div>
    </div>
  );
}

// ── Forgot password (portal) — US-ADM-004 ──────────────────────────────────
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Enter the email address you sign in with.'); return; }
    setBusy(true);
    try { await api.auth.forgotPassword(email.trim()); setSent(true); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send the reset link. Try again.'); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <BrandBlock />
        <Card>
          {sent ? (
            <div className="text-center">
              <MailCheck className="mx-auto mb-3 size-12 text-success" />
              <h1 className="text-lg font-bold text-brand-800">Check your email</h1>
              <p className="mt-2 text-sm text-ink-2">If <span className="font-medium">{email.trim()}</span> is registered for the portal, we've sent a link to reset your password. The link expires after a short time; if it doesn't arrive, check your spam folder or contact your Account Executive.</p>
              <Link to="/login"><Button variant="secondary" className="mt-6">Back to sign in</Button></Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              <div>
                <h1 className="text-lg font-bold text-brand-800">Reset your password</h1>
                <p className="mt-1 text-sm text-ink-2">Enter the email you use to sign in. If an account exists for it, we'll email you a link to set a new password.</p>
              </div>
              {err && <Banner tone="danger">{err}</Banner>}
              <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. name@company.ph" />
              <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
              <p className="text-center text-sm"><Link to="/login" className="font-medium text-brand-600 hover:underline">← Back to sign in</Link></p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
