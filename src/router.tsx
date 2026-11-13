import React, { useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Bell, ChevronDown, KeyRound, LogOut, MessageSquare, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from './lib/shared';
import { Banner, Button, Modal, PasswordInput, Stack, cn } from './lib/ui';
import logo from './assets/delbros-logo.png';
import { api } from './lib/api-client';
import { errMessage, useAction, useData, usePortalAuth } from './auth';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/public';
import { PrivacyNoticeModal } from './pages/common';
import { AccessApprovalPage, AccessStatusPage } from './pages/access';
import { ClientDashboard } from './pages/dashboard';
import { ClientEwalletPage } from './pages/ewallet';
import { ClientContractsPage } from './pages/contracts';
import { ClientEwaPage, ClientInvoicesPage, ClientRescuePage, FeedbackModal } from './pages/client';
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
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-sm font-medium text-ink shadow-card transition-[background-color,transform] duration-150 ease-out hover:bg-surface-alt active:scale-[0.96]">
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
  const submit = () => { setTried(true); if (v.current && v.next && !weak && v.confirm === v.next) save.mutate(undefined); };
  return (
    <Modal open={open} onClose={onClose} title="Change password" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="change-password" loading={save.isPending}>Change password</Button></>}>
      {/* A real <form>, so Enter submits from any field. */}
      <form id="change-password" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Stack>
          <PasswordInput label="Current password" autoComplete="current-password" required placeholder="Enter your current password" value={v.current} error={tried && !v.current ? 'Required' : undefined} onChange={(e) => setV({ ...v, current: e.target.value })} />
          <PasswordInput label="New password" autoComplete="new-password" required placeholder="At least 10 characters, with A–Z, a–z and 0–9" value={v.next} error={(tried && !v.next ? 'Required' : undefined) ?? weak} onChange={(e) => setV({ ...v, next: e.target.value })} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" required placeholder="Re-enter the new password" value={v.confirm} error={(tried && !v.confirm ? 'Required' : undefined) ?? mismatch} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
          {save.error && <Banner tone="danger">{errMessage(save.error)}</Banner>}
        </Stack>
      </form>
    </Modal>
  );
}

/** Portal dashboard review: "My profile" in the user menu — who is signed in, for which company, and who to contact. */
function ProfileModal({ open, onClose, client }: { open: boolean; onClose: () => void; client: boolean }) {
  const { user } = usePortalAuth();
  const d = useData(['portal-dash'], () => api.portal.dashboard(), client && open);
  if (!user) return null;
  const ae = d.data?.accountExecutive;
  const vendorSupport = api.auth.policy().support.vendor;
  const rows: [string, React.ReactNode][] = [
    ['Name', user.name],
    ['Sign-in email', user.email],
    ['Role', user.designation],
    ...(client
      ? ([['Company', d.data ? `${d.data.client.clientName} (${d.data.client.clientCode})` : '…'], ['Account status', d.data?.client.status ?? '…'],
        ['Account Executive', ae ? <>{ae.name}<span className="block font-normal text-muted">{[ae.mobile, ae.email].filter(Boolean).join(' · ')}</span></> : '—']] as [string, React.ReactNode][])
      : ([['Vendor ID', user.vendorId ?? '—'], ['Support', <>{vendorSupport.role}<span className="block font-normal text-muted">{[vendorSupport.phone, vendorSupport.email].filter(Boolean).join(' · ')}</span></>]] as [string, React.ReactNode][])),
    ['Signed in', formatDateTime(user.lastLogin)],
  ];
  return (
    <Modal open={open} onClose={onClose} title="My profile" description="Your sign-in email is your user ID. To change your name, email or company details, contact your Account Executive." footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        {rows.map(([l, v]) => <div key={l} className="min-w-0"><dt className="text-sm text-muted">{l}</dt><dd className="mt-0.5 break-words font-medium text-ink">{v}</dd></div>)}
      </dl>
    </Modal>
  );
}

/** Portal dashboard review: client notifications with an unread count; each opens the related record. */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const list = useData(['portal-notifications'], () => api.portal.notifications());
  const unread = (list.data ?? []).filter((n) => !n.read).length;
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['portal-notifications'] }); qc.invalidateQueries({ queryKey: ['portal-dash'] }); };
  const openOne = async (id: string, link: string) => {
    setOpen(false);
    await api.portal.markNotificationsRead(id); refresh();
    const [path, hash] = link.split('#');
    nav(path || '/client');
    if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  };
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => setOpen((o) => !o)}
        className="relative flex size-11 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card transition-[background-color,transform] duration-150 ease-out hover:bg-surface-alt hover:text-ink active:scale-[0.96]">
        <Bell className="size-5" aria-hidden />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold tabular text-white ring-2 ring-canvas" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] origin-top-right animate-pop overflow-hidden rounded-2xl bg-surface shadow-pop">
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
            <p className="text-base font-semibold tracking-tight text-ink">Notifications</p>
            {unread > 0 && <button type="button" className="text-sm font-medium text-brand-600 hover:underline" onClick={async () => { await api.portal.markNotificationsRead(); refresh(); }}>Mark all as read</button>}
          </div>
          {list.data?.length ? (
            <ul className="max-h-96 space-y-0.5 overflow-y-auto p-1.5">
              {list.data.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openOne(n.id, n.link ?? '/client')} className={cn('flex w-full gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-alt', !n.read && 'bg-brand-50/60')}>
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                    <span className="min-w-0">
                      <span className={cn('block text-sm', n.read ? 'text-ink-2' : 'font-semibold text-ink')}>{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</span>
                      <span className="block text-sm text-muted">{n.body}</span>
                      <span className="mt-0.5 block text-sm text-muted">{formatDateTime(n.at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-8 text-center text-sm text-muted">{list.isLoading ? 'Loading…' : 'No notifications.'}</p>}
          <p className="border-t border-line px-4 py-3 text-sm text-muted">Select a notification to open the related record. <Link to="/client" className="font-medium text-brand-600 hover:underline" onClick={() => setOpen(false)}>Dashboard</Link></p>
        </div>
      )}
    </div>
  );
}

/** Account menu under the user's name — closes on a click outside, on Esc and when an item is picked. */
function AccountMenu({ name, client, onSignOut }: { name: string; client: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'pw' | 'fb' | 'profile' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  // Inner radius = menu radius (16px) − its padding (6px).
  const item = 'flex h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-sm text-ink transition-colors duration-150 hover:bg-surface-alt';
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-11 items-center gap-1.5 rounded-full bg-surface pl-4 pr-3 text-sm font-medium text-ink shadow-card transition-colors duration-150 hover:bg-surface-alt">
        <span className="max-w-32 truncate sm:max-w-40">{name}</span><ChevronDown className={cn('size-4 text-muted transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 origin-top-right animate-pop rounded-2xl bg-surface p-1.5 shadow-pop">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setModal('profile'); }}><UserRound className="size-4 text-muted" aria-hidden />My profile</button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setModal('pw'); }}><KeyRound className="size-4 text-muted" aria-hidden />Change password</button>
          {client && <button role="menuitem" className={item} onClick={() => { setOpen(false); setModal('fb'); }}><MessageSquare className="size-4 text-muted" aria-hidden />Send feedback</button>}
          <div className="my-1.5 border-t border-line" role="separator" />
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onSignOut(); }}><LogOut className="size-4 text-muted" aria-hidden />Sign out</button>
        </div>
      )}
      <ProfileModal open={modal === 'profile'} onClose={() => setModal(null)} client={client} />
      <ChangePasswordModal open={modal === 'pw'} onClose={() => setModal(null)} />
      {client && <FeedbackModal open={modal === 'fb'} onClose={() => setModal(null)} />}
    </div>
  );
}

/** Footer: Data Privacy Act notice (same text as on the sign-in page). */
function PrivacyLink() {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="hover:underline" onClick={() => setOpen(true)}>Privacy notice (Data Privacy Act of 2012)</button><PrivacyNoticeModal open={open} onClose={() => setOpen(false)} /></>;
}

/** Footer support line: names the client's Account Executive with phone and email (review 1.1); Procurement for vendors. */
function SupportLine({ client }: { client: boolean }) {
  const d = useData(['portal-dash'], () => api.portal.dashboard(), client);
  const ae = d.data?.accountExecutive;
  if (!client) { const p = api.auth.policy().support.vendor; return <>Support: {p.role}{p.phone && <> · <a className="text-brand-600 hover:underline" href={`tel:${p.phone.replace(/\s/g, '')}`}>{p.phone}</a></>}{p.email && <> · <a className="text-brand-600 hover:underline" href={`mailto:${p.email}`}>{p.email}</a></>}</>; }
  // Production contact details: the AE comes from the user directory; Client Support from the approved release contacts (app-config.json).
  const cs = api.auth.policy().support.client;
  const support = (cs.phone || cs.email) && <> · Client Support{cs.phone && <> <a className="text-brand-600 hover:underline" href={`tel:${cs.phone.replace(/\s/g, '')}`}>{cs.phone}</a></>}{cs.email && <> · <a className="text-brand-600 hover:underline" href={`mailto:${cs.email}`}>{cs.email}</a></>}</>;
  if (!ae) return <>Support: your Account Executive{support}</>;
  return <>Your Account Executive: <span className="text-ink-2">{ae.name}</span>{ae.mobile && <> · <a className="text-brand-600 hover:underline" href={`tel:${ae.mobile.replace(/\s/g, '')}`}>{ae.mobile}</a></>} · <a className="text-brand-600 hover:underline" href={`mailto:${ae.email}`}>{ae.email}</a>{support}</>;
}

const navPill = (isActive: boolean) => cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150',
  isActive ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-surface-alt hover:text-ink');

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
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-pop">Skip to content</a>
      {/* The header floats on the canvas (no bar, no border); the menu is one white pill with the current page filled in brand blue. */}
      <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-3 px-5 lg:px-8">
          <div className="flex shrink-0 items-center gap-2.5"><img src={logo} alt="Delbros" className="h-9" /><div className="leading-tight"><p className="text-[15px] font-semibold tracking-tight text-ink">Delbros Leasing</p><p className="text-sm text-muted">{realm === 'CLIENT_PORTAL' ? 'Client portal' : 'Vendor portal'}</p></div></div>
          <BackButton />
          <nav className="mx-auto hidden h-12 items-center gap-1 rounded-full bg-surface p-1 shadow-card xl:flex" aria-label="Portal">
            {links.map(([to, label]) => <NavLink key={to} to={to} state={MAIN_NAV} end className={({ isActive }) => cn(navPill(isActive), 'h-10')}>{label}</NavLink>)}
          </nav>
          <div className="ml-auto flex items-center gap-2 xl:ml-0">
            {realm === 'CLIENT_PORTAL' && <NotificationBell />}
            <AccountMenu name={user.name} client={realm === 'CLIENT_PORTAL'} onSignOut={async () => { await logout('signed_out'); nav('/login'); }} /></div>
        </div>
        {/* Below 1280px the same menu drops to its own row and scrolls sideways if it has to. */}
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:px-7 xl:hidden [&::-webkit-scrollbar]:hidden" aria-label="Portal mobile">
          {links.map(([to, label]) => <NavLink key={to} to={to} state={MAIN_NAV} end className={({ isActive }) => cn(navPill(isActive), 'h-11', !isActive && 'bg-surface shadow-card')}>{label}</NavLink>)}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-5 pb-10 pt-4 lg:px-8"><Outlet /></main>
      <footer className="mx-auto max-w-7xl px-5 pb-[max(2rem,env(safe-area-inset-bottom))] text-sm text-muted lg:px-8">© Delbros Group · <PrivacyLink /> · <SupportLine client={realm === 'CLIENT_PORTAL'} /></footer>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  // Timeline 2 review: access request status (applicant) and the reviewer's one-click approval link (DBL-CLT-019).
  { path: '/access-status', element: <AccessStatusPage /> },
  { path: '/access-approval/:token', element: <AccessApprovalPage /> },
  { path: '/client', element: <Shell realm="CLIENT_PORTAL" />, children: [
    { index: true, element: <ClientDashboard /> }, { path: 'ewa', element: <ClientEwaPage /> }, { path: 'rescue', element: <ClientRescuePage /> },
    { path: 'invoices', element: <ClientInvoicesPage /> }, { path: 'ewallet', element: <ClientEwalletPage /> }, { path: 'contracts', element: <ClientContractsPage /> },
  ] },
  { path: '/vendor', element: <Shell realm="VENDOR_PORTAL" />, children: [{ index: true, element: <VendorPortalPage /> }] },
  { path: '*', element: <Navigate to="/login" replace /> },
]);
