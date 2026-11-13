import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'success';
type Size = 'sm' | 'md' | 'lg';

// Disabled buttons use dedicated muted tokens (not opacity), so they read the same on every surface.
const OFF = 'disabled:bg-surface-alt disabled:text-disabled disabled:shadow-none';
const VARIANTS: Record<Variant, string> = {
  primary: cn('bg-brand-600 text-white hover:bg-brand-700', OFF),
  // Inset ring instead of a border: no layout cost, and it recedes on any surface.
  secondary: 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-surface-alt disabled:text-disabled',
  ghost: 'text-ink-2 hover:bg-ink/5 disabled:text-disabled disabled:hover:bg-transparent',
  danger: cn('bg-danger text-white hover:bg-[#912018]', OFF),
  success: cn('bg-success text-white hover:bg-[#116932]', OFF),
  link: 'text-brand-600 hover:text-brand-700 hover:underline px-0',
};
const SIZES: Record<Size, string> = { sm: 'h-9 px-3.5 text-sm gap-1.5', md: 'h-11 px-5 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' };

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
        'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out disabled:cursor-not-allowed',
        variant !== 'link' && 'active:scale-[0.96] disabled:active:scale-100',
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
      className={cn('inline-flex size-10 items-center justify-center rounded-full text-ink-2 transition-[background-color,transform] duration-150 ease-out hover:bg-ink/5 active:scale-[0.96]', className)} {...rest} />
  );
}
