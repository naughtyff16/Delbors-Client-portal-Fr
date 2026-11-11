import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { toneFor, type StatusDomain, type Tone } from '../shared';
import { cn } from './cn';

const TONES: Record<Tone, string> = {
  success: 'bg-success-bg text-success border-success-line',
  warning: 'bg-warning-bg text-warning border-warning-line',
  danger: 'bg-danger-bg text-danger border-danger-line',
  'danger-solid': 'bg-danger text-white border-danger',
  info: 'bg-info-bg text-info border-info-line',
  neutral: 'bg-neutral-bg text-neutral border-neutral-line',
  purple: 'bg-purple-bg text-purple border-purple-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
};
const DOTS: Record<Tone, string> = {
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', 'danger-solid': 'bg-white', info: 'bg-info', neutral: 'bg-neutral', purple: 'bg-purple', brand: 'bg-brand-600',
};

export function Badge({ tone = 'neutral', children, dot = true, className, icon }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {icon ?? (dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} aria-hidden />)}
      {children}
    </span>
  );
}

/** Colour from the shared status map; always shows text (never colour alone). */
// Chassis statuses display in sentence case ('On Hire' → 'On hire', as the portal shows); acronyms like TQS stay upper-case. The stored value is unchanged.
export const sentenceCase = (s: string) => s.replace(/(?<=\s)([A-Z])([a-z]+)/g, (_, a: string, b: string) => a.toLowerCase() + b);

export function StatusBadge({ domain, value, className }: { domain: StatusDomain; value?: string | null; className?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  const tone = toneFor(domain, value);
  const loud = domain === 'client' && (value === 'Hold' || value === 'Blacklist');
  return (
    <Badge tone={tone} className={cn(loud && 'font-semibold', className)} icon={loud ? <Lock className="size-3" aria-hidden /> : undefined}>
      {domain === 'chassis' ? sentenceCase(value) : value}
    </Badge>
  );
}
