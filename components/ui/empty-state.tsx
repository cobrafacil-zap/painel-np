import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'glass flex flex-col items-center justify-center text-center p-8 sm:p-10',
        className
      )}
    >
      {icon && <div className="mb-3 text-zinc-500 opacity-80">{icon}</div>}
      <h3 className="text-base font-semibold text-zinc-200">{title}</h3>
      {description && (
        <p className="text-sm text-zinc-500 mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
