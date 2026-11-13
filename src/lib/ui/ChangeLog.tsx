import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FileBarChart, History, Search, Sparkles, Wrench, X } from 'lucide-react';
import { CHANGELOG, formatDate, loadAppConfig, type ChangeEntry } from '../shared';
import { cn } from './cn';

// CHANGELOG-REMOVE (temporary): sticky "Change log" button for the staff and portal sign-in pages; opens a full-page change log.
// Entries live in src/lib/shared/changelog.ts. Shown only while app-config.json has "showChangeLog": true.
// Remove: delete this file, its export in index.ts and the <ChangeLogLauncher /> line on each login page.

type Kind = ChangeEntry['kind'];
const KIND: Record<Kind, { label: string; icon: typeof Wrench; chip: string; dot: string }> = {
  Fix: { label: 'Fix', icon: Wrench, chip: 'bg-brand-50 text-brand-700', dot: 'bg-brand-600' },
  Feature: { label: 'Feature', icon: Sparkles, chip: 'bg-success-bg text-success', dot: 'bg-success' },
  Report: { label: 'Report', icon: FileBarChart, chip: 'bg-surface-alt text-ink-2', dot: 'bg-muted' },
  Housekeeping: { label: 'Housekeeping', icon: History, chip: 'bg-warning-bg text-warning', dot: 'bg-warning' },
};
const KINDS = Object.keys(KIND) as Kind[];

export function ChangeLogLauncher() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { loadAppConfig().then((c) => setShow(c.showChangeLog === true)); }, []);
  if (!show) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex h-11 items-center gap-2 rounded-full bg-surface px-5 text-sm font-medium text-ink shadow-pop transition-[background-color,transform] duration-150 ease-out hover:bg-surface-alt active:scale-[0.96]">
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
      <header className="bg-brand-900 text-white">
        <div className="mx-auto max-w-5xl px-6 pb-8 pt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Change log</h1>
              <p className="mt-2 max-w-[60ch] text-base text-white/80">Every change from the correction and UI/UX work: why it was needed, what changed and the result. Newest first.</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-medium text-white transition-colors duration-150 hover:bg-white/20" aria-label="Close change log">
              <X className="size-4" aria-hidden />Close
            </button>
          </div>
          {/* The per-kind counts live on the filter buttons below, so the header carries only the scope line. */}
          <p className="mt-5 text-sm text-white/80">Delbros Leasing · frontend v0.1.0 · {CHANGELOG.length} changes · {formatDate(dates[0])} → {formatDate(dates[dates.length - 1])}</p>
        </div>
      </header>

      {/* Filters */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-6 py-3">
          {(['All', ...KINDS] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={cn('h-10 rounded-full px-4 text-sm font-medium ring-1 ring-inset transition-colors duration-150', kind === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-ink-2 ring-line-strong hover:bg-surface-alt')}>
              {k === 'All' ? `All (${CHANGELOG.length})` : `${KIND[k].label} (${count(k)})`}
            </button>
          ))}
          <label className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search changes…" aria-label="Search changes"
              className="h-11 w-full rounded-full border border-line-strong bg-surface pl-10 pr-4 text-base text-ink placeholder:text-disabled transition-[border-color,box-shadow] duration-150 hover:border-ink/35 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12 sm:text-sm" />
          </label>
        </div>
      </div>

      {/* Timeline */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {!list.length && <p className="rounded-card bg-surface py-14 text-center text-sm text-muted shadow-card">No changes match the filter.</p>}
        {days.map((d) => (
          <section key={d} className="grid gap-x-8 gap-y-3 pb-8 md:grid-cols-[150px_minmax(0,1fr)]">
            <div className="md:sticky md:top-20 md:self-start">
              <p className="text-sm font-semibold text-ink">{formatDate(d)}</p>
              <p className="text-sm text-muted">{list.filter((e) => e.date === d).length} change{list.filter((e) => e.date === d).length === 1 ? '' : 's'}</p>
            </div>
            <ol className="relative space-y-4 border-l border-line pl-6">
              {list.filter((e) => e.date === d).map((e) => {
                const K = KIND[e.kind];
                return (
                  <li key={e.title} className="relative">
                    <span className={cn('absolute -left-[31px] top-5 size-3 rounded-full ring-4 ring-canvas', K.dot)} aria-hidden />
                    <article className={cn('rounded-card bg-surface p-6 shadow-card')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium', K.chip)}><K.icon className="size-3.5" aria-hidden />{K.label}</span>
                        <h2 className="text-base font-semibold text-ink">{e.title}</h2>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-ink-2"><span className="mr-1.5 font-semibold text-ink">Why</span>{e.why}</p>
                      <ul className="mt-3 space-y-1.5">
                        {e.changes.map((c) => <li key={c} className="flex gap-2 text-sm leading-relaxed text-ink-2"><ChevronRight className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden /><span>{c}</span></li>)}
                      </ul>
                      {e.result && (
                        <p className="mt-4 flex gap-2 rounded-xl bg-success-bg px-3.5 py-2.5 text-sm text-ink-2">
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
        <p className="border-t border-line pt-4 text-sm text-muted">Temporary page for the correction phase. Hide it with <code className="rounded bg-surface-alt px-1">"showChangeLog": false</code> in app-config.json. The same entries are in CHANGELOG.md.</p>
      </main>
    </div>
  );
}
