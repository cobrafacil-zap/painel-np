'use client';

/**
 * Placeholder para subcategorias ainda não implementadas (#feature cuidado pessoal).
 */

import type { LucideIcon } from 'lucide-react';

export function SecaoPlaceholder({
  icon: Icon,
  titulo,
  descricao,
}: {
  icon: LucideIcon;
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="glass-elevated rounded-xl p-5">
      <header className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-zinc-700/40 border border-white/[0.06] flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-zinc-400" />
        </div>
        <div>
          <p className="label-eyebrow">Em breve</p>
          <h2 className="text-lg font-semibold mt-1">{titulo}</h2>
        </div>
      </header>
      <p className="text-xs text-zinc-400 leading-relaxed">{descricao}</p>
    </div>
  );
}
