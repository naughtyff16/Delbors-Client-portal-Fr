// Pieces shared by the sign-in pages, the portal shell and the client pages (portal sign-in review, 2026-11-11).
import { useEffect, useState } from 'react';
import { Check, Mail, Minus, Phone } from 'lucide-react';
import { api, type PortalContact } from '../lib/api-client';
import { loadAppConfig, passwordChecks, type AppConfig } from '../lib/shared';
import { Button, Modal, cn } from '../lib/ui';

/** Runtime settings from /app-config.json (showDemoLogins, staffUrl…). */
export function useAppConfig() {
  const [cfg, setCfg] = useState<AppConfig>({});
  useEffect(() => { let live = true; loadAppConfig().then((c) => live && setCfg(c)); return () => { live = false; }; }, []);
  return cfg;
}

/** Re-renders every second (countdowns). */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [active]);
  return now;
}

/** "Name — role · phone · email", with tel: / mailto: links. */
export function ContactLine({ contact, className }: { contact?: PortalContact | null; className?: string }) {
  if (!contact) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm', className)}>
      <span className="font-medium">{contact.name ? <>{contact.name} <span className="font-normal opacity-80">· {contact.role}</span></> : contact.role}</span>
      {contact.phone && <a className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline" href={`tel:${contact.phone.replace(/\s/g, '')}`}><Phone className="size-4" aria-hidden />{contact.phone}</a>}
      {contact.email && <a className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline" href={`mailto:${contact.email}`}><Mail className="size-4" aria-hidden />{contact.email}</a>}
    </p>
  );
}

/** Live password checklist — the rules come from System settings (minimum length) and are re-checked by the server. */
export function PasswordRules({ password, minLength, email, className }: { password: string; minLength: number; email?: string; className?: string }) {
  return (
    <ul className={cn('grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2', className)} aria-label="Password rules" aria-live="polite">
      {passwordChecks(password, minLength, email).map((r) => (
        <li key={r.key} className={cn('flex items-center gap-1.5', r.ok ? 'text-success' : 'text-muted')}>
          {r.ok ? <Check className="size-4 shrink-0" aria-hidden /> : <Minus className="size-4 shrink-0" aria-hidden />}
          {r.label}<span className="sr-only">{r.ok ? ' — met' : ' — not met yet'}</span>
        </li>
      ))}
    </ul>
  );
}

/** Data Privacy Act of 2012 (RA 10173) notice — shown from the sign-in page, the access request form and the portal footer. */
export function PrivacyNoticeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dpo = api.auth.policy().dpoEmail;
  const h = 'mt-5 text-base font-semibold text-ink first:mt-0';
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Privacy notice" description="Delbros Leasing client & vendor portal — Data Privacy Act of 2012 (Republic Act No. 10173)"
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-2 text-sm text-ink-2">
        <h3 className={h}>Who we are</h3>
        <p>Delbros Leasing (Delbros Group) runs this portal and is the personal information controller for the data you give us here.</p>
        <h3 className={h}>What we collect</h3>
        <p>Your name, business email and phone, company and position; sign-in activity (date, time, browser and network address); and the records you create in the portal, such as EWAs, rescue requests, payments, invoices and uploaded documents.</p>
        <h3 className={h}>Why we use it</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>To confirm your identity and keep your account secure (sign-in, one-time codes, lockout after failed attempts).</li>
          <li>To process your company’s leasing, billing and supply transactions.</li>
          <li>To contact you about your account, invoices, deliveries and service.</li>
          <li>To meet legal, tax and audit requirements.</li>
        </ul>
        <h3 className={h}>Who sees it</h3>
        <p>Authorised Delbros staff who handle your account; service providers that host or support the portal under written agreements; and government agencies when the law requires it. We do not sell personal data.</p>
        <h3 className={h}>How long we keep it</h3>
        <p>While your company’s account is active, then for as long as the law and Delbros’s records-retention policy require. After that it is securely disposed of.</p>
        <h3 className={h}>Your rights</h3>
        <p>You have the right to be informed, to access, to object, to correct (rectification), to erasure or blocking, to data portability and to damages. You can also file a complaint with the National Privacy Commission.</p>
        <h3 className={h}>Contact our Data Protection Officer</h3>
        <p>{dpo ? <a className="font-medium text-brand-600 hover:underline" href={`mailto:${dpo}`}>{dpo}</a> : 'Ask your Account Executive or Delbros Procurement to reach our Data Protection Officer.'}</p>
      </div>
    </Modal>
  );
}
