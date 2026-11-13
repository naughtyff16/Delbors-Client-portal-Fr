import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { toneFor, type StatusDomain, type Tone } from '../shared';
import { cn } from './cn';

const TONES: Record<Tone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  'danger-solid': 'bg-danger text-white',
  info: 'bg-info-bg text-info',
  neutral: 'bg-neutral-bg text-neutral',
  purple: 'bg-purple-bg text-purple',
  brand: 'bg-brand-50 text-brand-700',
};

/** Status tag: tinted rectangle with the status in words. No leading dot — the tint plus the text carry the meaning.
 *  (`dot` is still accepted so existing callers compile; it no longer draws anything.) */
export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium leading-5', TONES[tone], className)}>
      {icon}
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
    <Badge tone={tone} className={cn(loud && 'font-semibold', className)} icon={loud ? <Lock className="size-3.5" aria-hidden /> : undefined}>
      {domain === 'chassis' ? sentenceCase(value) : value}
    </Badge>
  );
}
