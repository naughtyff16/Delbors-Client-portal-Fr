import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Inbox, OctagonAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from './cn';
import { userText } from './userText';

type BannerTone = 'info' | 'warning' | 'danger' | 'success';
const BANNER: Record<BannerTone, { cls: string; icon: ReactNode }> = {
  info: { cls: 'bg-info-bg text-brand-800', icon: <Info className="size-5 text-info" /> },
  warning: { cls: 'bg-warning-bg text-[#7a3a06]', icon: <AlertTriangle className="size-5 text-warning" /> },
  danger: { cls: 'bg-danger-bg text-[#7a1a12]', icon: <OctagonAlert className="size-5 text-danger" /> },
  success: { cls: 'bg-success-bg text-[#0c4a24]', icon: <CheckCircle2 className="size-5 text-success" /> },
};

export function Banner({ tone = 'info', title, children, actions, className }: { tone?: BannerTone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex flex-wrap gap-3 rounded-2xl px-4 py-3.5 text-sm', BANNER[tone].cls, className)}>
      <span className="shrink-0">{BANNER[tone].icon}</span>
      <div className="min-w-0 flex-1 basis-56">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{userText(children)}</div>}
      </div>
      {actions && <div className="shrink-0 self-center">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-surface-alt text-muted">{icon ?? <Inbox className="size-5" />}</span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{userText(hint)}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-alt', className)} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}
    </div>
  );
}

const VALUE_TONE = { danger: 'text-danger', warning: 'text-warning', success: 'text-success', default: 'text-ink' } as const;

export function KpiTile({ label, value, delta, tone, hint, onClick, icon }: { label: ReactNode; value: ReactNode; delta?: number; tone?: 'default' | 'danger' | 'warning' | 'success'; hint?: ReactNode; onClick?: () => void; icon?: ReactNode }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    // @container: the value scales with the tile width so long peso amounts never overflow into the next tile.
    // Reads top to bottom: label, the figure, then any hint / trend underneath.
    <Comp onClick={onClick} className={cn('@container flex h-full min-h-[116px] min-w-0 flex-col gap-1.5 rounded-card bg-surface p-5 text-left shadow-card', onClick && 'transition-colors duration-150 hover:bg-brand-50/50')}>
      <span className="flex items-start justify-between gap-2 text-sm font-medium text-muted">{label}{icon && <span className="text-disabled">{icon}</span>}</span>
      <span className={cn('whitespace-nowrap text-[clamp(18px,12cqi,28px)] font-semibold leading-9 tracking-tight tabular', VALUE_TONE[tone ?? 'default'])}>{value}</span>
      {(delta != null || hint) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
          {delta != null && (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', delta >= 0 ? 'text-success' : 'text-danger')}>
              {delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}{Math.abs(delta)}%
            </span>
          )}
          {userText(hint)}
        </span>
      )}
    </Comp>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600', className)} aria-label="Loading" />;
}
