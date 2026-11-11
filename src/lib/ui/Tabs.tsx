import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem { id: string; label: ReactNode; count?: number }

export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    // Baseline drawn as an inset shadow (no -1px overhang), so the strip only ever scrolls sideways and shows no scrollbar arrows.
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      {items.map((t) => {
        const active = t.id === value;
        return (
          <button key={t.id} role="tab" aria-selected={active} onClick={() => onChange(t.id)}
            className={cn('inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
            {t.count != null && <span className={cn('rounded-full px-1.5 text-xs', active ? 'bg-brand-100 text-brand-700' : 'bg-surface-alt text-muted')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-line-strong bg-surface-alt p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={o.value === value}
          className={cn('h-full whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors', o.value === value ? 'bg-surface text-brand-700 shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
