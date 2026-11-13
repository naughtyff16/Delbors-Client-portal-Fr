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
            className={cn('inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors duration-150',
              active ? 'border-brand-600 text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
            {t.count != null && <span className={cn('rounded-md px-1.5 text-sm tabular', active ? 'bg-brand-50 text-brand-700' : 'bg-surface-alt text-muted')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Pill switch between views of the same list. The weight never changes between states, so labels do not shift. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-11 max-w-full shrink-0 items-center overflow-x-auto rounded-full bg-surface-alt p-1 shadow-[inset_0_0_0_1px_var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={o.value === value}
          className={cn('h-full shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150', o.value === value ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-2 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
