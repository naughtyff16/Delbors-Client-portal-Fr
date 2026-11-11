// Account restrictions shown after sign-in (portal sign-in review, 2026-11-11):
//  • Hold (BR-01): the client can sign in, but EWAs / chassis release and rescue requests are blocked.
//  • Allow Online = No: the client can sign in, but cannot create EWAs online.
// Each message says what is blocked, what still works, and who to contact.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ShieldOff } from 'lucide-react';
import type { api, PortalContact } from '../lib/api-client';
import { formatPhp } from '../lib/shared';
import { Banner, Button, Modal, cn } from '../lib/ui';
import { HOLD_NOTICE_SHOWN, sessionFlag } from '../auth';
import { ContactLine } from './common';

type Dash = Awaited<ReturnType<typeof api.portal.dashboard>>;
type Scope = 'account' | 'ewa' | 'rescue';

const aeContact = (d: Dash): PortalContact | null =>
  d.accountExecutive ? { role: 'Your Account Executive', name: d.accountExecutive.name, phone: d.accountExecutive.mobile, email: d.accountExecutive.email } : null;

function Contacts({ list }: { list: (PortalContact | null | undefined)[] }) {
  const shown = list.filter(Boolean) as PortalContact[];
  if (!shown.length) return null;
  return (
    <div className="mt-2 border-t border-current/15 pt-2">
      <p className="text-xs opacity-80">Who to contact:</p>
      {shown.map((c) => <ContactLine key={c.role} contact={c} className="mt-0.5" />)}
    </div>
  );
}

function HoldDetails({ d }: { d: Dash }) {
  return (
    <>
      <p>{d.overdue > 0 ? <>Overdue balance <strong>{formatPhp(d.overdue)}</strong>. </> : null}Until the balance is settled and the hold is lifted, these are <strong>blocked</strong>:</p>
      <ul className="mt-1 list-disc pl-5">
        <li>New EWAs and chassis release</li>
        <li>Rescue requests</li>
        <li>Repair scheduling and new services</li>
      </ul>
      <p className="mt-1">You can still view invoices and your statement (SOA), pay or top up your e-wallet, and return units.</p>
      <Contacts list={[d.creditContact, aeContact(d)]} />
    </>
  );
}

/** What blocks this scope, or null when nothing does. */
export function restrictionOf(d: Dash | undefined, scope: Scope) {
  if (!d) return null;
  const hold = d.client.status === 'Hold';
  if (scope === 'account') return hold ? ('hold' as const) : null;
  const gate = scope === 'ewa' ? d.gates.ewa : d.gates.rescue;
  if (gate.allowed) return null;
  if (hold) return 'hold' as const;
  return gate.code === 'ELIGIBILITY' ? ('not_enabled' as const) : ('other' as const);
}

/** Short label for a blocked quick-action tile on the dashboard. */
export function restrictionHint(d: Dash, scope: 'ewa' | 'rescue') {
  const r = restrictionOf(d, scope);
  return r === 'hold' ? 'Blocked — account on hold' : r === 'not_enabled' ? 'Not enabled — contact your Account Executive' : 'Unavailable — account restricted';
}

export function AccountRestriction({ dash, scope, className }: { dash?: Dash; scope: Scope; className?: string }) {
  const r = restrictionOf(dash, scope);
  if (!dash || !r) return null;
  const d = dash;
  if (r === 'hold') {
    const title = scope === 'ewa' ? 'New EWAs are blocked — your account is on hold' : scope === 'rescue' ? 'Rescue requests are blocked — your account is on hold' : 'Your account is on hold';
    return (
      <Banner tone="danger" className={className} title={title} actions={<Link to="/client/invoices"><Button size="sm" variant="danger">View balance</Button></Link>}>
        <HoldDetails d={d} />
      </Banner>
    );
  }
  if (r === 'not_enabled') {
    return (
      <Banner tone="warning" className={className} title={scope === 'ewa' ? 'Online EWA is not enabled for your account' : 'Rescue requests are not enabled for your account'}>
        {scope === 'ewa' ? (
          <p>You can sign in and use the rest of the portal, but EWAs for {d.client.clientName} cannot be created online. To book a pickup, or to ask for online EWA access, contact your Account Executive.</p>
        ) : (
          <p>Roadside rescue is not part of {d.client.clientName}’s service. For a breakdown, call your Account Executive, who can arrange help.</p>
        )}
        <Contacts list={[aeContact(d)]} />
      </Banner>
    );
  }
  const gate = scope === 'ewa' ? d.gates.ewa : d.gates.rescue;
  return (
    <Banner tone="danger" className={className} title={scope === 'ewa' ? 'EWA creation unavailable' : 'Rescue requests unavailable'}>
      <p>{gate.reason}</p>
      <Contacts list={[aeContact(d)]} />
    </Banner>
  );
}

/** Shown once per session right after sign-in when the client is on hold (BR-01). */
export function HoldNoticeAfterSignIn({ dash }: { dash?: Dash }) {
  const [open, setOpen] = useState(false);
  const hold = dash?.client.status === 'Hold';
  useEffect(() => {
    if (hold && !sessionFlag.get(HOLD_NOTICE_SHOWN)) { sessionFlag.set(HOLD_NOTICE_SHOWN, '1'); setOpen(true); }
  }, [hold]);
  if (!dash || !hold) return null;
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={<span className="flex items-center gap-2 text-danger"><ShieldOff className="size-5" aria-hidden />{dash.client.clientName} is on hold</span>}
      footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Continue to dashboard</Button><Link to="/client/invoices" onClick={() => setOpen(false)}><Button variant="danger">View balance</Button></Link></>}>
      <div className={cn('text-sm text-ink-2')}><HoldDetails d={dash} /></div>
    </Modal>
  );
}
