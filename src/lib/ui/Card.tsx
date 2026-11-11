import type { ReactNode } from 'react';
import { cn } from './cn';
import { userText } from './userText';

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn('rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]', padded && 'p-5', className)}>{children}</section>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{userText(description)}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FormSection({ title, description, children, actions, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={actions} />
      {children}
    </Card>
  );
}

export function PageHeader({ title, description, actions, breadcrumb, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-6">
      {breadcrumb && <div className="mb-2 text-[13px] text-muted">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-bold leading-[30px] text-brand-800">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{userText(description)}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </header>
  );
}

export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-5', className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('my-4 border-line', className)} />;
}
