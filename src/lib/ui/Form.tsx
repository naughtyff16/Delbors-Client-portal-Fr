import { Paperclip } from 'lucide-react';
import { createPortal } from 'react-dom';
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';
import { DatePicker } from './DatePicker';
import { userText } from './userText';

const control = 'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-disabled transition-colors focus:border-brand-600 focus:outline-none focus:ring-3 focus:ring-brand-100 disabled:bg-surface-alt disabled:text-muted';
// Read-only shading for text fields only — <select> always matches :read-only, which made every dropdown look disabled.
const readOnlyText = 'read-only:bg-surface-alt';
// `!` so the error border wins over the default border colour on every field, not only the focused one.
const invalid = 'border-danger! focus:border-danger! focus:ring-danger-bg';

export interface FieldProps { label?: ReactNode; required?: boolean; error?: string; hint?: ReactNode; className?: string; children: (id: string, describedBy?: string) => ReactNode }
/** Label above, helper/error below, error linked with aria-describedby (docs/02 §11). */
export function Field({ label, required, error, hint, className, children }: FieldProps) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div data-field className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
          {label}{required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        </label>
      )}
      {children(id, descId)}
      {error ? <p id={descId} className="text-xs text-danger">{error}</p> : hint ? <p id={descId} className="text-xs text-muted">{userText(hint)}</p> : null}
    </div>
  );
}

type Base = { label?: ReactNode; error?: string; hint?: ReactNode; wrapperClassName?: string };

/** Type-ahead option for <Input suggestions>: the value typed into the field, plus an optional muted hint (e.g. a status). */
export interface Suggestion { value: string; hint?: string }

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Base & { suggestions?: Suggestion[] }>(function Input(
  { label, error, hint, required, wrapperClassName, className, suggestions, ...rest }, ref,
) {
  if (suggestions) return <SuggestInput ref={ref} label={label} error={error} hint={hint} required={required} wrapperClassName={wrapperClassName} className={className} suggestions={suggestions} {...rest} />;
  if (rest.type === 'file') return <FileInput ref={ref} label={label} error={error} hint={hint} required={required} wrapperClassName={wrapperClassName} {...rest} />;
  if (rest.type === 'date' || rest.type === 'datetime-local') {
    // App calendar instead of the browser's native picker; callers keep reading e.target.value as before.
    const { type, value, onChange, min, max, name, disabled, placeholder, title } = rest;
    const emit = (v: string) => onChange?.({ target: { name, value: v }, currentTarget: { name, value: v } } as unknown as ChangeEvent<HTMLInputElement>);
    return (
      <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
        {(id, d) => <DatePicker id={id} name={name} withTime={type === 'datetime-local'} value={String(value ?? '')} onChange={emit} min={min as string | undefined} max={max as string | undefined}
          disabled={disabled} required={required} invalid={!!error} placeholder={placeholder} title={title} className={className} aria-label={rest['aria-label']} aria-describedby={d} />}
      </Field>
    );
  }
  return (
    <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
      {(id, d) => <input ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} required={required} className={cn(control, readOnlyText, 'h-9', error && invalid, className)} {...rest} />}
    </Field>
  );
});

/** App-styled type-ahead (replaces the browser's <datalist>, whose ▼ arrow and dark popup did not match the app).
 *  Filters as you type; ↑ ↓ Enter Esc; a free value can still be typed. Callers keep reading e.target.value. */
const SuggestInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Base & { suggestions: Suggestion[] }>(function SuggestInput(
  { label, error, hint, required, wrapperClassName, className, suggestions, onChange, onKeyDown, onFocus, onBlur, ...rest }, ref,
) {
  const box = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const q = String(rest.value ?? '').trim().toLowerCase();
  const list = suggestions.filter((s) => !q || s.value.toLowerCase().includes(q) || s.hint?.toLowerCase().includes(q)).slice(0, 50);
  const show = open && list.length > 0 && !(list.length === 1 && list[0].value.toLowerCase() === q);
  const place = useCallback(() => { const r = box.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width }); }, []);
  useLayoutEffect(() => { if (show) place(); }, [show, place]);
  useEffect(() => {
    if (!show) return;
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [show, place]);
  const pick = (v: string) => { onChange?.({ target: { name: rest.name, value: v }, currentTarget: { name: rest.name, value: v } } as unknown as ChangeEvent<HTMLInputElement>); setOpen(false); setActive(-1); };
  return (
    <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
      {(id, d) => (
        <>
          <input ref={(el) => { box.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }} id={id} aria-describedby={d} aria-invalid={!!error} required={required}
            role="combobox" aria-expanded={show} aria-autocomplete="list" aria-controls={`${id}-list`} autoComplete="off"
            className={cn(control, readOnlyText, 'h-9', error && invalid, className)} {...rest}
            onChange={(e) => { onChange?.(e); setOpen(true); setActive(-1); }}
            onFocus={(e) => { setOpen(true); onFocus?.(e); }}
            onBlur={(e) => { setOpen(false); onBlur?.(e); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, list.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
              if (e.key === 'Enter' && show && active >= 0) { e.preventDefault(); pick(list[active].value); return; }
              if (e.key === 'Escape' && show) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
              onKeyDown?.(e);
            }} />
          {show && createPortal(
            <ul id={`${id}-list`} role="listbox" style={{ top: pos.top, left: pos.left, width: pos.width }}
              className="fixed z-[70] max-h-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
              {list.map((s, i) => (
                <li key={s.value} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(s.value); }} onMouseEnter={() => setActive(i)}
                  className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm', i === active ? 'bg-brand-50 text-brand-800' : 'text-ink hover:bg-surface-alt')}>
                  <span className="truncate font-medium">{s.value}</span>{s.hint && <span className="shrink-0 text-xs text-muted">{s.hint}</span>}
                </li>
              ))}
            </ul>,
            document.body,
          )}
        </>
      )}
    </Field>
  );
});

/** Styled file picker (replaces the browser's raw "Choose Files / No file chosen" control); callers still get the native change event. */
const FileInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Base>(function FileInput(
  { label, error, hint, required, wrapperClassName, className, onChange, ...rest }, ref,
) {
  const [names, setNames] = useState<string[]>([]);
  return (
    <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
      {(id, d) => (
        <div className={cn('flex min-h-9 flex-wrap items-center gap-2', className)}>
          <label className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-surface px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-ink focus-within:ring-3 focus-within:ring-brand-100',
            error ? 'border-danger' : 'border-line-strong', rest.disabled && 'pointer-events-none opacity-50')}>
            <Paperclip className="size-4" aria-hidden />{rest.multiple ? 'Choose files' : 'Choose file'}
            <input ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} required={required} className="sr-only" {...rest}
              onChange={(e) => { setNames(Array.from(e.target.files ?? []).map((f) => f.name)); onChange?.(e); }} />
          </label>
          <span className={cn('min-w-0 truncate text-[13px]', names.length ? 'text-ink' : 'text-muted')} title={names.join(', ') || undefined}>
            {names.length ? names.join(', ') : rest.multiple ? 'No files selected' : 'No file selected'}
          </span>
        </div>
      )}
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Base>(function Textarea(
  { label, error, hint, required, wrapperClassName, className, rows = 3, ...rest }, ref,
) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
      {(id, d) => <textarea ref={ref} id={id} rows={rows} aria-describedby={d} aria-invalid={!!error} required={required} className={cn(control, readOnlyText, 'py-2', error && invalid, className)} {...rest} />}
    </Field>
  );
});

/** Compact labelled "from – to" date filter for list toolbars (sits on one line, opts out of toolbar auto-sizing). */
export function DateRangeFilter({ label = 'Date', from, to, onChange }: { label?: string; from: string; to: string; onChange: (v: { from: string; to: string }) => void }) {
  return (
    <div data-wide className="flex h-9 items-center gap-1.5">
      <span className="whitespace-nowrap text-[13px] font-medium text-muted">{label}</span>
      <DatePicker aria-label={`${label} from`} className="w-[9.25rem] px-2.5" placeholder="From" value={from} max={to || undefined} onChange={(v) => onChange({ from: v, to })} />
      <span className="text-muted" aria-hidden>–</span>
      <DatePicker aria-label={`${label} to`} className="w-[9.25rem] px-2.5" placeholder="To" value={to} min={from || undefined} onChange={(v) => onChange({ from, to: v })} />
    </div>
  );
}

export interface Option { value: string; label: string; disabled?: boolean }
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Base & { options: Option[]; placeholder?: string }>(function Select(
  { label, error, hint, required, wrapperClassName, className, options, placeholder, ...rest }, ref,
) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
      {(id, d) => (
        <select ref={ref} id={id} aria-describedby={d} aria-invalid={!!error} required={required} className={cn(control, 'h-9 pr-8', error && invalid, className)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }>(function Checkbox(
  { label, description, className, ...rest }, ref,
) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input ref={ref} id={id} type="checkbox" className="mt-0.5 size-4 rounded border-line-strong accent-brand-600" {...rest} />
      <label htmlFor={id} className="text-sm text-ink-2 leading-5">
        {label}{description && <span className="block text-xs text-muted">{description}</span>}
      </label>
    </div>
  );
});

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    // Toggle sits directly before its own label, so in multi-column forms it can never read as belonging to the neighbour.
    <div className="flex items-start gap-3 py-1">
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-line-strong')}>
        <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
      <label htmlFor={id} className="min-w-0 text-sm text-ink-2">{label}{description && <span className="block text-xs text-muted">{userText(description)}</span>}</label>
    </div>
  );
}

/** ₱ input — keeps a numeric value, shows 2 decimals. */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Base>(function MoneyInput(
  { label, error, hint, required, wrapperClassName, className, ...rest }, ref,
) {
  return (
    <Field label={label} required={required} error={error} hint={hint} className={wrapperClassName}>
      {(id, d) => (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">₱</span>
          <input ref={ref} id={id} type="number" step="0.01" inputMode="decimal" aria-describedby={d} aria-invalid={!!error} required={required}
            placeholder="0.00" className={cn(control, readOnlyText, 'h-9 pl-7 text-right tabular', error && invalid, className)} {...rest} />
        </div>
      )}
    </Field>
  );
});

export function FormGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }[cols];
  return <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2', c, className)}>{children}</div>;
}

export function ReadField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm text-ink break-words">{children ?? '—'}</span>
    </div>
  );
}
