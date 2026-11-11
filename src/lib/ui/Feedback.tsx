import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Inbox, OctagonAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from './cn';
import { userText } from './userText';

type BannerTone = 'info' | 'warning' | 'danger' | 'success';
const BANNER: Record<BannerTone, { cls: string; icon: ReactNode }> = {
  info: { cls: 'bg-info-bg border-info-line text-brand-800', icon: <Info className="size-4 text-info" /> },
  warning: { cls: 'bg-warning-bg border-warning-line text-[#7a3a06]', icon: <AlertTriangle className="size-4 text-warning" /> },
  danger: { cls: 'bg-danger-bg border-danger-line text-[#7a1a12]', icon: <OctagonAlert className="size-4 text-danger" /> },
  success: { cls: 'bg-success-bg border-success-line text-[#0c4a24]', icon: <CheckCircle2 className="size-4 text-success" /> },
};

export function Banner({ tone = 'info', title, children, actions, className }: { tone?: BannerTone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', BANNER[tone].cls, className)}>
      <span className="mt-0.5 shrink-0">{BANNER[tone].icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{userText(children)}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-alt text-muted">{icon ?? <Inbox className="size-5" />}</span>
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-muted">{userText(hint)}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-alt', className)} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

export function KpiTile({ label, value, delta, tone, hint, onClick, icon }: { label: ReactNode; value: ReactNode; delta?: number; tone?: 'default' | 'danger' | 'warning' | 'success'; hint?: ReactNode; onClick?: () => void; icon?: ReactNode }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    // @container: the value scales with the tile width so long peso amounts never overflow into the next tile.
    // Label top-left; value in the bottom-right corner (right-aligned) with any hint / trend bottom-left on the same line.
    <Comp onClick={onClick} className={cn('@container flex h-full min-h-[104px] min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-left shadow-[var(--shadow-card)]', onClick && 'transition-colors hover:border-brand-300 hover:bg-brand-50/40')}>
      <span className="flex items-start justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted">{label}{icon && <span className="text-disabled">{icon}</span>}</span>
      {/* flex-wrap: when the hint and the value don't fit on one line, the value drops below (still right-aligned) instead of overlapping. */}
      <span className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pb-1 text-xs text-muted">
          {delta != null && (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', delta >= 0 ? 'text-success' : 'text-danger')}>
              {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}{Math.abs(delta)}%
            </span>
          )}
          {userText(hint)}
        </span>
        <span className={cn('ml-auto shrink-0 whitespace-nowrap text-right text-[clamp(16px,11.5cqi,26px)] font-bold leading-8 tabular', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink')}>{value}</span>
      </span>
    </Comp>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600', className)} aria-label="Loading" />;
}
