import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-100 disabled:text-brand-700/70 disabled:shadow-none',
  secondary: 'bg-surface text-ink-2 border border-line-strong hover:bg-surface-alt disabled:text-disabled',
  ghost: 'text-ink-2 hover:bg-surface-alt disabled:text-disabled',
  danger: 'bg-danger text-white hover:bg-[#912018] shadow-sm disabled:opacity-50',
  success: 'bg-success text-white hover:bg-[#116932] shadow-sm disabled:opacity-50',
  link: 'text-brand-600 hover:text-brand-700 hover:underline px-0',
};
const SIZES: Record<Size, string> = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-[15px] gap-2' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed',
        VARIANTS[variant], variant !== 'link' && SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cn('inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-alt transition-colors', className)} {...rest} />
  );
}
