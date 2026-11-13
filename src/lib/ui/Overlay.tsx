import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Textarea } from './Form';
import { cn } from './cn';
import { userText } from './userText';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    // A nested popover (e.g. the date picker) handles its own Escape and marks it handled.
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
}

const closeBtn = 'flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink';

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'doc' }) {
  useEscape(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return null;
  // 'doc' fits an A4 print preview at readable size.
  const w = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', doc: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/45 p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* Header and footer stay fixed; only the body scrolls, so action buttons are always visible however tall the form is. */}
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={cn('flex max-h-[88vh] w-full animate-pop flex-col rounded-3xl bg-surface shadow-pop outline-none', w)}>
        <div className="flex shrink-0 items-start justify-between gap-4 pb-2 pl-6 pr-4 pt-5">
          <div className="min-w-0 pt-1"><h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>{description && <p className="mt-1 text-sm text-muted">{userText(description)}</p>}</div>
          <button onClick={onClose} className={closeBtn} aria-label="Close"><X className="size-5" /></button>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>}
        {/* Phones: actions stack full width with the main action on top. From tablet up they sit in a row on the right. */}
        {footer && <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* Drawers use at least 75% of the viewport on tablet and up (full width on phones); min-width wins over any narrower max-w passed in. */}
      <aside role="dialog" aria-modal="true" className={cn('flex h-full w-full flex-col bg-surface shadow-pop', width, 'md:min-w-[75vw]')}>
        <div className="flex items-center justify-between gap-4 pb-2 pl-6 pr-4 pt-5">
          <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
          <button onClick={onClose} className={closeBtn} aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

/** Destructive/controlled actions require a reason that goes to the audit log (docs/02 §6). */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', requireReason, loading }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: ReactNode; message?: ReactNode; confirmLabel?: string; tone?: 'primary' | 'danger'; requireReason?: boolean; loading?: boolean;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} disabled={requireReason && !reason.trim()} onClick={() => onConfirm(reason)}>{confirmLabel}</Button>
      </>}>
      {message && <div className="text-sm text-ink-2">{message}</div>}
      {requireReason && <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the audit trail" wrapperClassName="mt-4" />}
    </Modal>
  );
}
