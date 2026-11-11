import { useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, ChevronDown, KeyRound, LogOut, MessageSquare } from 'lucide-react';
import { Banner, Button, Input, Modal, Stack, cn } from './lib/ui';
import logo from './assets/delbros-logo.png';
import { api } from './lib/api-client';
import { errMessage, useAction, useData, usePortalAuth } from './auth';
import { ForgotPasswordPage, LoginPage, RegisterPage } from './pages/public';
import { ClientContractsPage, ClientDashboard, ClientEwaPage, ClientEwalletPage, ClientInvoicesPage, ClientRescuePage, FeedbackModal } from './pages/client';
import { VendorPortalPage } from './pages/vendor';

/** Back to the previous screen — only on screens reached through a link inside a page; hidden on screens opened from the portal menu. */
// Screens opened from the portal menu carry this state, so Back stays hidden there.
const MAIN_NAV = { mainNav: true };
function BackButton() {
  const loc = useLocation(); // re-render on every navigation
  const nav = useNavigate();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx < 1 || (loc.state as { mainNav?: boolean } | null)?.mainNav) return null;
  return (
    <button type="button" onClick={() => nav(-1)} title="Back to the previous screen"
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line bg-surface pl-2 pr-3 text-[13px] font-medium text-ink-2 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
      <ArrowLeft className="size-4" aria-hidden />Back
    </button>
  );
}

/** Review 1.1 (ADM-004): change password from the portal. */
function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const blank = { current: '', next: '', confirm: '' };
  const [v, setV] = useState(blank);
  const [tried, setTried] = useState(false);
  const save = useAction(() => api.auth.changePassword(v.current, v.next), { success: 'Password changed', onSuccess: () => { setV(blank); setTried(false); onClose(); } });
  const weak = v.next && (v.next.length < 10 || !/[A-Z]/.test(v.next) || !/[a-z]/.test(v.next) || !/\d/.test(v.next)) ? 'At least 10 characters with upper- and lower-case letters and a number' : undefined;
  const mismatch = v.confirm && v.confirm !== v.next ? 'Does not match the new password' : undefined;
  return (
    <Modal open={open} onClose={onClose} title="Change password" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => { setTried(true); if (v.current && v.next && !weak && v.confirm === v.next) save.mutate(undefined); }}>Change password</Button></>}>
      <Stack>
        <Input label="Current password" type="password" autoComplete="current-password" required placeholder="Enter your current password" value={v.current} error={tried && !v.current ? 'Required' : undefined} onChange={(e) => setV({ ...v, current: e.target.value })} />
        <Input label="New password" type="password" autoComplete="new-password" required placeholder="At least 10 characters, with A–Z, a–z and 0–9" value={v.next} error={(tried && !v.next ? 'Required' : undefined) ?? weak} onChange={(e) => setV({ ...v, next: e.target.value })} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required placeholder="Re-enter the new password" value={v.confirm} error={(tried && !v.confirm ? 'Required' : undefined) ?? mismatch} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
        {save.error && <Banner tone="danger">{errMessage(save.error)}</Banner>}
      </Stack>
    </Modal>
  );
}

/** Account menu under the user's name — closes on a click outside, on Esc and when an item is picked. */
function AccountMenu({ name, client, onSignOut }: { name: string; client: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'pw' | 'fb' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-alt';
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-alt">
        <span className="max-w-40 truncate">{name}</span><ChevronDown className="size-4 text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setModal('pw'); }}><KeyRound className="size-4" />Change password</button>
          {client && <button role="menuitem" className={item} onClick={() => { setOpen(false); setModal('fb'); }}><MessageSquare className="size-4" />Send feedback</button>}
          <button role="menuitem" className={cn(item, 'border-t border-line')} onClick={() => { setOpen(false); onSignOut(); }}><LogOut className="size-4" />Sign out</button>
        </div>
      )}
      <ChangePasswordModal open={modal === 'pw'} onClose={() => setModal(null)} />
      {client && <FeedbackModal open={modal === 'fb'} onClose={() => setModal(null)} />}
    </div>
  );
}

/** Footer support line: names the client's Account Executive with phone and email (review 1.1). */
function SupportLine({ client }: { client: boolean }) {
  const d = useData(['portal-dash'], () => api.portal.dashboard(), client);
  const ae = d.data?.accountExecutive;
  if (!client) return <>Support: Delbros Procurement</>;
  if (!ae) return <>Support: your Account Executive</>;
  return <>Your Account Executive: <span className="text-ink-2">{ae.name}</span>{ae.mobile && <> · <a className="hover:underline" href={`tel:${ae.mobile.replace(/\s/g, '')}`}>{ae.mobile}</a></>} · <a className="hover:underline" href={`mailto:${ae.email}`}>{ae.email}</a></>;
}

function Shell({ realm }: { realm: 'CLIENT_PORTAL' | 'VENDOR_PORTAL' }) {
  const { user, logout } = usePortalAuth();
  const nav = useNavigate();
  if (!user) return <Navigate to="/login" replace />;
  if (user.realm !== realm) return <Navigate to={user.realm === 'VENDOR_PORTAL' ? '/vendor' : '/client'} replace state={{ mainNav: true }} />;
  const links = realm === 'CLIENT_PORTAL'
    ? [['/client', 'Dashboard'], ['/client/ewa', 'EWA'], ['/client/rescue', 'Rescue'], ['/client/invoices', 'Invoices & SOA'], ['/client/ewallet', 'E-wallet'], ['/client/contracts', 'Contracts']]
    : [['/vendor', 'My POs & invoices']];
  // Review 1.1: the cash bond lives on the E-wallet page — the menu label says so.
  if (realm === 'CLIENT_PORTAL') links[4][1] = 'E-wallet & bond';
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <div className="flex items-center gap-2"><img src={logo} alt="Delbros" className="h-8" /><div className="leading-tight"><p className="text-sm font-bold text-brand-800">Delbros Leasing</p><p className="text-[11px] text-muted">{realm === 'CLIENT_PORTAL' ? 'Client portal' : 'Vendor portal'}</p></div></div>
          <BackButton />
          <nav className="hidden flex-1 gap-1 md:flex" aria-label="Portal">
            {links.map(([to, label]) => <NavLink key={to} to={to} state={MAIN_NAV} end className={({ isActive }) => cn('rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-2 hover:bg-surface-alt')}>{label}</NavLink>)}
          </nav>
          <div className="ml-auto flex items-center gap-1 text-sm">
            <AccountMenu name={user.name} client={realm === 'CLIENT_PORTAL'} onSignOut={async () => { await logout(); nav('/login'); }} /></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-2 py-1 md:hidden" aria-label="Portal mobile">
          {links.map(([to, label]) => <NavLink key={to} to={to} state={MAIN_NAV} end className={({ isActive }) => cn('whitespace-nowrap rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-2')}>{label}</NavLink>)}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6"><Outlet /></main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted">© Delbros Group · Data Privacy Act compliant · <SupportLine client={realm === 'CLIENT_PORTAL'} /></footer>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/client', element: <Shell realm="CLIENT_PORTAL" />, children: [
    { index: true, element: <ClientDashboard /> }, { path: 'ewa', element: <ClientEwaPage /> }, { path: 'rescue', element: <ClientRescuePage /> },
    { path: 'invoices', element: <ClientInvoicesPage /> }, { path: 'ewallet', element: <ClientEwalletPage /> }, { path: 'contracts', element: <ClientContractsPage /> },
  ] },
  { path: '/vendor', element: <Shell realm="VENDOR_PORTAL" />, children: [{ index: true, element: <VendorPortalPage /> }] },
  { path: '*', element: <Navigate to="/login" replace /> },
]);
