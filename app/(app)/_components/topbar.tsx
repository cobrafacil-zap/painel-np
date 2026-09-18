'use client';

import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';

export function Topbar({
  onOpenMenu,
  title,
  subtitle,
  right,
}: {
  onOpenMenu: () => void;
  title?: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header
      className="md:hidden sticky top-0 z-30 bg-bg-base/85 backdrop-blur-xl border-b border-white/[0.06] -mx-4 sm:-mx-6 mb-4 px-4 py-3 flex items-center gap-3 max-w-full overflow-hidden"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <button
        onClick={onOpenMenu}
        className="shrink-0 -ml-1 w-11 h-11 rounded-lg flex items-center justify-center hover:bg-white/[0.06] active:bg-white/[0.1] text-zinc-200 transition-colors"
        aria-label="Abrir menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1 min-w-0">
        {title ? (
          <h1 className="text-base font-semibold truncate text-zinc-50">{title}</h1>
        ) : (
          <h1 className="text-base font-semibold text-zinc-50">Painel NP</h1>
        )}
        {subtitle && (
          <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>
        )}
      </div>

      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
