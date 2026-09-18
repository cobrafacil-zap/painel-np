'use client';

import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 sm:gap-4 flex-wrap">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="label-eyebrow">{eyebrow}</p>}
        <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-extrabold tracking-tight text-zinc-50 mt-1 break-words">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-zinc-500 mt-1.5 break-words">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
