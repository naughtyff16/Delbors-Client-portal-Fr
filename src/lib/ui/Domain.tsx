import { useEffect, useRef, useState, type ReactNode } from 'react';
import SignaturePadLib from 'signature_pad';
import { Check, Copy, Eraser } from 'lucide-react';
import { formatDateTime, formatPhp, ROLE_TEMPLATES, type ApprovalStep, type InspectionLine, type WorkflowInstance } from '../shared';
import { Button } from './Button';
import { StatusBadge } from './Badge';
import { cn } from './cn';

export function MoneyText({ value, className, strong }: { value?: number | null; className?: string; strong?: boolean }) {
  const neg = (value ?? 0) < 0;
  return <span className={cn('tabular whitespace-nowrap', neg && 'text-danger', strong && 'font-semibold', className)}>{neg ? '−' + formatPhp(Math.abs(value!)) : formatPhp(value)}</span>;
}

export function DocNo({ value, className }: { value?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-[13px] font-medium text-ink', className)}>
      {value}
      <button type="button" aria-label={`Copy ${value}`} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
        className="rounded p-0.5 text-disabled hover:bg-surface-alt hover:text-muted no-print">{copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}</button>
    </span>
  );
}

function signatures(step: ApprovalStep) {
  return (step.comment ?? '').split('|').filter(Boolean).map((s) => { const [user, role, ...rest] = s.split(':'); return { user, role, text: rest.join(':') }; });
}

/** Vertical stepper: approver role, decision, timestamp, comment (docs/03 §6). */
export function ApprovalTimeline({ workflow, userName }: { workflow: WorkflowInstance; userName?: (id: string) => string }) {
  return (
    <ol className="relative space-y-4">
      {workflow.steps.map((s, i) => {
        const current = workflow.status === 'Pending' && i === workflow.currentStep;
        const overdue = current && s.dueAt && new Date(s.dueAt) < new Date();
        // Steps not reached yet read as neutral 'Not started' so amber stays reserved for the current / escalated step.
        const decision = overdue ? 'Escalated' : current ? 'Pending' : s.decision === 'Pending' ? (workflow.status !== 'Pending' ? 'Skipped' : 'Not started') : s.decision;
        const sigs = signatures(s);
        return (
          <li key={s.step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn('flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold',
                s.decision === 'Approved' ? 'border-success bg-success-bg text-success' : s.decision === 'Rejected' ? 'border-danger bg-danger-bg text-danger' : current ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line-strong bg-surface text-muted')}>
                {s.step}
              </span>
              {i < workflow.steps.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">{s.label}</p>
                <StatusBadge domain="approval" value={decision} />
              </div>
              <p className="text-xs text-muted">{s.roles.map((r) => (ROLE_TEMPLATES as Record<string, { label: string }>)[r]?.label.replace(/\s*\(Officer.*\)$/, '') ?? r.replaceAll('_', ' ')).join(' + ')}{s.dueAt && current ? ` · due ${formatDateTime(s.dueAt)}` : ''}</p>
              {sigs.map((g, k) => (
                <p key={k} className="mt-1 text-[13px] text-ink-2"><span className="font-medium">{userName?.(g.user) ?? g.user}</span>{g.text && <> — “{g.text}”</>}</p>
              ))}
              {s.decidedAt && <p className="text-xs text-muted">{formatDateTime(s.decidedAt)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const STATUS_CODES = ['OK', 'DMG', 'MSG', 'WRN', 'RPL'];
const STATUS_LABEL: Record<string, string> = { OK: 'OK', DMG: 'Damaged', MSG: 'Missing', WRN: 'Worn', RPL: 'Replaced' };
const isTire = (part: string) => /tire|tyre/i.test(part);
/** Gate checklist (GP2 Rev.2 Parts Status table). Shared by Gate Out, Gate In and Park & Fix. */
export function InspectionChecklist({ lines, onChange, showCharges = true, readOnly }: { lines: InspectionLine[]; onChange?: (l: InspectionLine[]) => void; showCharges?: boolean; readOnly?: boolean }) {
  const set = (i: number, patch: Partial<InspectionLine>) => onChange?.(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const cell = 'h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] focus:border-brand-600 focus:outline-none';
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line bg-surface-alt px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Parts status</span>
        {!readOnly && <Button size="sm" variant="ghost" onClick={() => onChange?.(lines.map((l) => ({ ...l, statusCode: 'OK', chargeable: 0 })))}>Mark all OK</Button>}
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
          <th className="px-3 py-2">Part</th><th className="px-2 py-2">Branding</th><th className="px-2 py-2">Tread depth</th><th className="px-2 py-2">Status</th><th className="px-2 py-2 w-16">Qty</th>{showCharges && <th className="px-3 py-2 text-right">Chargeable ₱</th>}
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.part} className={cn('border-t border-line', l.statusCode !== 'OK' && 'bg-warning-bg/50')}>
              <td className="px-3 py-1.5 font-medium">{l.part}</td>
              {/* Branding and tread depth apply to tires only; other parts show a dash. */}
              <td className="px-2 py-1.5">{!isTire(l.part) ? <span className="text-disabled">—</span> : readOnly ? (l.branding || '—') : <input className={cell} value={l.branding ?? ''} placeholder="e.g. Bridgestone" onChange={(e) => set(i, { branding: e.target.value })} aria-label={`${l.part} branding`} />}</td>
              <td className="px-2 py-1.5">{!isTire(l.part) ? <span className="text-disabled">—</span> : readOnly ? (l.threadDepth || '—') : <input className={cell} value={l.threadDepth ?? ''} placeholder="e.g. 8 mm" onChange={(e) => set(i, { threadDepth: e.target.value })} aria-label={`${l.part} tread depth`} />}</td>
              <td className="px-2 py-1.5">{readOnly ? (STATUS_LABEL[l.statusCode] ?? l.statusCode) : (
                <select className={cell} value={l.statusCode} onChange={(e) => set(i, { statusCode: e.target.value, chargeable: e.target.value === 'OK' ? 0 : l.chargeable })} aria-label={`${l.part} status`}>
                  {STATUS_CODES.map((c) => <option key={c} value={c}>{STATUS_LABEL[c]}</option>)}
                </select>)}
              </td>
              <td className="px-2 py-1.5">{readOnly ? l.qty : <input type="number" min={0} className={cell} value={l.qty} placeholder="0" onChange={(e) => set(i, { qty: Number(e.target.value) })} aria-label={`${l.part} qty`} />}</td>
              {showCharges && <td className="px-3 py-1.5 text-right">{readOnly || l.statusCode === 'OK' ? (l.chargeable ? formatPhp(l.chargeable) : <span className="text-disabled">—</span>) : <input type="number" min={0} step="0.01" className={cn(cell, 'text-right')} value={l.chargeable || ''} placeholder="0.00" onChange={(e) => set(i, { chargeable: Number(e.target.value) })} aria-label={`${l.part} chargeable`} />}</td>}
            </tr>
          ))}
        </tbody>
        {showCharges && (
          <tfoot><tr className="border-t border-line bg-surface-alt"><td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted">Total chargeable damages</td>
            <td className="px-3 py-2 text-right font-semibold tabular">{formatPhp(lines.reduce((a, l) => a + (l.chargeable || 0), 0))}</td></tr></tfoot>
        )}
      </table>
    </div>
  );
}

export function SignaturePad({ value, onChange, label = 'Driver signature' }: { value?: string; onChange: (dataUrl?: string) => void; label?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePadLib | null>(null);
  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio; c.getContext('2d')!.scale(ratio, ratio);
    const p = new SignaturePadLib(c, { penColor: '#0f172a', backgroundColor: 'rgb(255,255,255)' });
    p.addEventListener('endStroke', () => onChange(p.toDataURL('image/png')));
    pad.current = p;
    return () => p.off();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-2">{label}<span className="ml-0.5 text-danger">*</span></span>
        <Button size="sm" variant="ghost" icon={<Eraser className="size-4" />} onClick={() => { pad.current?.clear(); onChange(undefined); }}>Clear</Button>
      </div>
      <canvas ref={canvas} className={cn('h-36 w-full touch-none rounded-lg border-2 border-dashed bg-surface', value ? 'border-success-line' : 'border-line-strong')} aria-label="Signature area" />
      <p className="text-xs text-muted">{value ? 'Signature captured.' : 'Sign inside the box with a finger, stylus or mouse.'}</p>
    </div>
  );
}

export function KeyValueGrid({ items, cols = 4 }: { items: { label: ReactNode; value: ReactNode }[]; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[cols];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2', c)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{it.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
