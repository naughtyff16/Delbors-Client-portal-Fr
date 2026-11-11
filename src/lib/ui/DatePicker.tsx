import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from './cn';

// One calendar for the whole app (replaces the browser's native date input, whose format and look differed per browser).
// Values stay in the native formats so existing forms and the API are unchanged: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'.
// Shown to the user as dd-Mon-yyyy (and HH:mm), the same format as every date in the app.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n: number) => String(n).padStart(2, '0');

type Ymd = { y: number; m: number; d: number }; // m is 0-based
const parseYmd = (s?: string | null): Ymd | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const parseTime = (s?: string | null) => { const m = /T(\d{2}):(\d{2})/.exec(s ?? ''); return m ? { h: +m[1], mi: +m[2] } : null; };
const ymdStr = (v: Ymd) => `${v.y}-${pad(v.m + 1)}-${pad(v.d)}`;
const key = (v: Ymd) => v.y * 10000 + v.m * 100 + v.d;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const addDays = (v: Ymd, n: number): Ymd => { const t = new Date(Date.UTC(v.y, v.m, v.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }; };
const todayYmd = (): Ymd => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; };

export function formatPickerValue(value: string, withTime: boolean) {
  const d = parseYmd(value); if (!d) return '';
  const t = parseTime(value);
  return `${pad(d.d)}-${MONTHS[d.m]}-${d.y}${withTime && t ? ` ${pad(t.h)}:${pad(t.mi)}` : ''}`;
}

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  title?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function DatePicker({ value, onChange, withTime = false, min, max, id, name, disabled, required, invalid, placeholder, className, title, ...aria }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const sel = parseYmd(value);
  const time = parseTime(value) ?? { h: 9, mi: 0 };
  const minY = parseYmd(min), maxY = parseYmd(max);
  const [view, setView] = useState<{ y: number; m: number }>(() => { const b = sel ?? todayYmd(); return { y: b.y, m: b.m }; });
  const [focus, setFocus] = useState<Ymd>(() => sel ?? todayYmd());
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });

  const outOfRange = useCallback((v: Ymd) => (minY && key(v) < key(minY)) || (maxY && key(v) > key(maxY)), [minY, maxY]);

  const openPicker = () => {
    if (disabled) return;
    const base = sel ?? (maxY && key(todayYmd()) > key(maxY) ? maxY : todayYmd());
    setView({ y: base.y, m: base.m }); setFocus(base); setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const emit = (d: Ymd | null, t = time) => onChange(d ? (withTime ? `${ymdStr(d)}T${pad(t.h)}:${pad(t.mi)}` : ymdStr(d)) : '');

  // Position the popover against the trigger (fixed, in a portal) so dialogs and scroll areas never clip it.
  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect(); if (!r) return;
    const h = pop.current?.offsetHeight ?? 360, w = pop.current?.offsetWidth ?? 296;
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), up });
  }, []);
  useLayoutEffect(() => { if (open) place(); }, [open, place, view, withTime]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false); };
    window.addEventListener('mousedown', onDoc); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('mousedown', onDoc); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);
  useEffect(() => { if (open) pop.current?.querySelector<HTMLButtonElement>('[data-focus="true"]')?.focus(); }, [open, focus.y, focus.m, focus.d]);

  const grid = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
    const start = addDays({ y: view.y, m: view.m, d: 1 }, -first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view]);

  const moveFocus = (n: number) => { const f = addDays(focus, n); setFocus(f); if (f.m !== view.m || f.y !== view.y) setView({ y: f.y, m: f.m }); };
  const onGridKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowLeft') moveFocus(-1); else if (k === 'ArrowRight') moveFocus(1); else if (k === 'ArrowUp') moveFocus(-7); else if (k === 'ArrowDown') moveFocus(7);
    else if (k === 'PageUp') moveFocus(-daysIn(focus.y, (focus.m + 11) % 12)); else if (k === 'PageDown') moveFocus(daysIn(focus.y, focus.m));
    else if (k === 'Home') moveFocus(-((new Date(Date.UTC(focus.y, focus.m, focus.d)).getUTCDay())));
    else if (k === 'End') moveFocus(6 - new Date(Date.UTC(focus.y, focus.m, focus.d)).getUTCDay());
    else if ((k === 'Enter' || k === ' ') && !outOfRange(focus)) { emit(focus); if (!withTime) close(); }
    else if (k === 'Escape') close();
    else return;
    e.preventDefault();
  };
  const shift = (n: number) => { const m = view.m + n; setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }); };
  const years = useMemo(() => { const c = (sel ?? todayYmd()).y; const lo = Math.min(minY?.y ?? c - 30, c - 30), hi = Math.max(maxY?.y ?? c + 10, c + 10); return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i); }, [sel?.y, minY?.y, maxY?.y]);
  const today = todayYmd();
  const shown = formatPickerValue(value, withTime);

  return (
    <>
      <button ref={trigger} type="button" id={id} name={name} title={title} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-required={required} aria-invalid={invalid}
        aria-label={aria['aria-label'] ? `${aria['aria-label']}${shown ? `: ${shown}` : ''}` : undefined} aria-describedby={aria['aria-describedby']}
        onClick={() => (open ? close() : openPicker())} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openPicker(); } }}
        className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 text-left text-sm text-ink transition-colors focus:border-brand-600 focus:outline-none focus:ring-3 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-muted',
          open && 'border-brand-600 ring-3 ring-brand-100', invalid && 'border-danger! focus:border-danger! focus:ring-danger-bg', className)}>
        <span className={cn('truncate', !shown && 'text-disabled')}>{shown || placeholder || (withTime ? 'Select date & time' : 'Select date')}</span>
        <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && createPortal(
        <div ref={pop} role="dialog" aria-label={withTime ? 'Choose date and time' : 'Choose date'} style={{ top: pos.top, left: pos.left }}
          className="fixed z-[70] w-[296px] rounded-xl border border-line bg-surface p-3 shadow-xl" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
          <div className="mb-2 flex items-center gap-1">
            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-surface-alt hover:text-ink" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></button>
            <select aria-label="Month" className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm font-semibold text-ink" value={view.m} onChange={(e) => setView({ ...view, m: +e.target.value })}>
              {MONTHS_LONG.map((l, i) => <option key={l} value={i}>{l}</option>)}
            </select>
            <select aria-label="Year" className="h-8 w-[86px] rounded-md border border-line bg-surface px-2 text-sm font-semibold text-ink tabular" value={view.y} onChange={(e) => setView({ ...view, y: +e.target.value })}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-surface-alt hover:text-ink" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="size-4" /></button>
          </div>
          <div role="grid" aria-label={`${MONTHS_LONG[view.m]} ${view.y}`} onKeyDown={onGridKey}>
            <div role="row" className="grid grid-cols-7">{WEEKDAYS.map((w) => <span key={w} role="columnheader" className="py-1 text-center text-[11px] font-semibold uppercase text-muted">{w}</span>)}</div>
            {Array.from({ length: 6 }, (_, r) => (
              <div role="row" key={r} className="grid grid-cols-7">
                {grid.slice(r * 7, r * 7 + 7).map((d) => {
                  const inMonth = d.m === view.m, isSel = !!sel && key(d) === key(sel), isToday = key(d) === key(today), off = !!outOfRange(d), isFocus = key(d) === key(focus);
                  return (
                    <button key={key(d)} type="button" role="gridcell" aria-selected={isSel} aria-disabled={off} disabled={off} tabIndex={isFocus ? 0 : -1} data-focus={isFocus}
                      aria-label={`${d.d} ${MONTHS_LONG[d.m]} ${d.y}${isToday ? ' (today)' : ''}`}
                      onClick={() => { setFocus(d); emit(d); if (!withTime) close(); }}
                      className={cn('m-0.5 flex h-8 items-center justify-center rounded-md text-[13px] tabular transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                        isSel ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-ink hover:bg-brand-50' : 'text-disabled hover:bg-surface-alt',
                        isToday && !isSel && 'font-semibold text-brand-700 ring-1 ring-inset ring-brand-300', off && 'cursor-not-allowed opacity-35 hover:bg-transparent')}>
                      {d.d}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {withTime && (
            <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
              <Clock className="size-4 text-muted" aria-hidden />
              <select aria-label="Hour" className="h-8 rounded-md border border-line bg-surface px-2 text-sm tabular" value={time.h} disabled={!sel} onChange={(e) => emit(sel, { ...time, h: +e.target.value })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}</option>)}
              </select>
              <span className="text-muted">:</span>
              <select aria-label="Minute" className="h-8 rounded-md border border-line bg-surface px-2 text-sm tabular" value={time.mi} disabled={!sel} onChange={(e) => emit(sel, { ...time, mi: +e.target.value })}>
                {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{pad(m)}</option>)}
              </select>
              {!sel && <span className="text-xs text-muted">Pick a day first</span>}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <button type="button" disabled={!!outOfRange(today)} className="rounded-md px-2 py-1 text-[13px] font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-disabled"
              onClick={() => { const n = new Date(); emit(today, withTime ? { h: n.getHours(), mi: n.getMinutes() } : time); if (!withTime) close(); else { setView({ y: today.y, m: today.m }); setFocus(today); } }}>{withTime ? 'Now' : 'Today'}</button>
            <span className="flex gap-1">
              {!required && <button type="button" className="rounded-md px-2 py-1 text-[13px] font-medium text-muted hover:bg-surface-alt hover:text-ink" onClick={() => { emit(null); close(); }}>Clear</button>}
              {withTime && <button type="button" className="rounded-md bg-brand-600 px-3 py-1 text-[13px] font-medium text-white hover:bg-brand-700" onClick={() => close()}>Done</button>}
            </span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
