import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FileBarChart, History, Search, Sparkles, Wrench, X } from 'lucide-react';
import { CHANGELOG, formatDate, loadAppConfig, type ChangeEntry } from '../shared';
import { cn } from './cn';

// CHANGELOG-REMOVE (temporary): sticky "Change log" button for the staff and portal sign-in pages; opens a full-page change log.
// Entries live in src/lib/shared/changelog.ts. Shown only while app-config.json has "showChangeLog": true.
// Remove: delete this file, its export in index.ts and the <ChangeLogLauncher /> line on each login page.

type Kind = ChangeEntry['kind'];
const KIND: Record<Kind, { label: string; icon: typeof Wrench; chip: string; bar: string; dot: string }> = {
  Fix: { label: 'Fix', icon: Wrench, chip: 'bg-brand-50 text-brand-700 ring-brand-100', bar: 'before:bg-brand-600', dot: 'bg-brand-600' },
  Feature: { label: 'Feature', icon: Sparkles, chip: 'bg-success-bg text-success ring-success/20', bar: 'before:bg-success', dot: 'bg-success' },
  Report: { label: 'Report', icon: FileBarChart, chip: 'bg-surface-alt text-ink-2 ring-line', bar: 'before:bg-muted', dot: 'bg-muted' },
  Housekeeping: { label: 'Housekeeping', icon: History, chip: 'bg-warning-bg text-warning ring-warning/20', bar: 'before:bg-warning', dot: 'bg-warning' },
};
const KINDS = Object.keys(KIND) as Kind[];
const PLURAL: Record<Kind, string> = { Fix: 'Fixes', Feature: 'Features', Report: 'Reports', Housekeeping: 'Housekeeping' };

export function ChangeLogLauncher() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { loadAppConfig().then((c) => setShow(c.showChangeLog === true)); }, []);
  if (!show) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 shadow-lg transition-colors hover:border-brand-300 hover:text-brand-700">
        <History className="size-4" aria-hidden />Change log
      </button>
      {open && <ChangeLogScreen onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangeLogScreen({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'All' | Kind>('All');
  const [q, setQ] = useState('');
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return CHANGELOG.filter((e) => (kind === 'All' || e.kind === kind) && (!s || [e.title, e.why, e.result ?? '', ...e.changes].join(' ').toLowerCase().includes(s)));
  }, [kind, q]);
  const days = [...new Set(list.map((e) => e.date))];
  const count = (k: Kind) => CHANGELOG.filter((e) => e.kind === k).length;
  const dates = CHANGELOG.map((e) => e.date).sort();

  return (
    <div role="dialog" aria-modal="true" aria-label="Change log" className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
      {/* Header */}
      <header className="relative overflow-hidden bg-brand-900 text-white">
        <div className="absolute -right-24 -top-24 size-96 rotate-45 rounded-3xl bg-brand-800/60" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-6 pb-8 pt-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-brand-200"><History className="size-4" aria-hidden />Delbros Leasing · frontend v0.1.0</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Change log</h1>
              <p className="mt-2 max-w-2xl text-brand-100">Every change made during the correction and UI/UX work — why it was needed, what changed and the result. Newest first.</p>
            </div>
            <button type="button" onClick={onClose} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10" aria-label="Close change log">
              <X className="size-4" aria-hidden />Close
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat value={CHANGELOG.length} label="Changes" />
            {KINDS.map((k) => <Stat key={k} value={count(k)} label={PLURAL[k]} />)}
          </div>
          <p className="mt-4 text-xs text-brand-200">Period {formatDate(dates[0])} → {formatDate(dates[dates.length - 1])}</p>
        </div>
      </header>

      {/* Filters */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-6 py-3">
          {(['All', ...KINDS] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={cn('rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 ring-inset transition-colors', kind === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-ink-2 ring-line hover:bg-surface-alt')}>
              {k === 'All' ? `All (${CHANGELOG.length})` : `${KIND[k].label} (${count(k)})`}
            </button>
          ))}
          <label className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-disabled" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search changes…" aria-label="Search changes"
              className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-8 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-3 focus:ring-brand-100" />
          </label>
        </div>
      </div>

      {/* Timeline */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {!list.length && <p className="rounded-xl border border-dashed border-line bg-surface py-12 text-center text-sm text-muted">No changes match the filter.</p>}
        {days.map((d) => (
          <section key={d} className="grid gap-x-8 gap-y-3 pb-8 md:grid-cols-[150px_minmax(0,1fr)]">
            <div className="md:sticky md:top-20 md:self-start">
              <p className="text-sm font-semibold text-ink">{formatDate(d)}</p>
              <p className="text-xs text-muted">{list.filter((e) => e.date === d).length} change{list.filter((e) => e.date === d).length === 1 ? '' : 's'}</p>
            </div>
            <ol className="relative space-y-4 border-l border-line pl-6">
              {list.filter((e) => e.date === d).map((e) => {
                const K = KIND[e.kind];
                return (
                  <li key={e.title} className="relative">
                    <span className={cn('absolute -left-[31px] top-5 size-3 rounded-full ring-4 ring-canvas', K.dot)} aria-hidden />
                    <article className={cn('relative overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] before:absolute before:inset-y-0 before:left-0 before:w-1', K.bar)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', K.chip)}><K.icon className="size-3" aria-hidden />{K.label}</span>
                        <h2 className="text-base font-semibold text-ink">{e.title}</h2>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-ink-2"><span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Why</span>{e.why}</p>
                      <ul className="mt-3 space-y-1.5">
                        {e.changes.map((c) => <li key={c} className="flex gap-2 text-sm leading-relaxed text-ink-2"><ChevronRight className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /><span>{c}</span></li>)}
                      </ul>
                      {e.result && (
                        <p className="mt-4 flex gap-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-ink-2">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /><span><span className="font-semibold text-success">Result: </span>{e.result}</span>
                        </p>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
        <p className="border-t border-line pt-4 text-xs text-muted">Temporary page for the correction phase. Hide it with <code className="rounded bg-surface-alt px-1">"showChangeLog": false</code> in app-config.json. The same entries are in CHANGELOG.md.</p>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/10">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-brand-200">{label}</p>
    </div>
  );
}
