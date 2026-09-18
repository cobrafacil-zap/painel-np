import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'danger' | 'pill' | 'pill-active' | 'pill-inactive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const sizeMap: Record<Size, string> = {
  sm: 'h-7 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

const variantMap: Record<Variant, string> = {
  primary:
    'bg-accent-400 hover:bg-accent-500 text-bg-base font-semibold shadow-[0_0_0_0_rgb(34,197,94,0)] hover:shadow-[0_0_24px_-2px_rgb(34,197,94,0.5)]',
  ghost: 'hover:bg-bg-elevated text-zinc-300 hover:text-zinc-100',
  danger:
    'bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30',
  pill:
    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border bg-white/[0.02] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.04] text-zinc-300 hover:text-zinc-100 transition-all',
  'pill-active':
    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border bg-accent-400/15 border-accent-400/40 text-accent-300 shadow-[0_0_18px_-4px_rgb(34,197,94,0.5)]',
  'pill-inactive':
    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:border-white/15 transition-all',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'ghost', size = 'md', className, children, ...rest }, ref) => {
    const isPill = variant.startsWith('pill');
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-50 disabled:cursor-not-allowed',
          isPill ? variantMap[variant] : cn(variantMap[variant], sizeMap[size]),
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
