/**
 * Card "Áudios recentes" embeddado no `/painel`.
 *
 * Mostra os últimos 5 áudios transcritos (do user atual) com sumário
 * + tópicos. Link "Ver todos" → `/audios` (página completa com busca).
 *
 * Server component: faz fetch via service role direto. Não precisa de
 * API route aqui — o painel já tem permissão de service.
 */

import Link from 'next/link';
import { Mic, ArrowRight } from 'lucide-react';
import { requireUser } from '@/lib/supabase/server';
import { listAudios } from '@/lib/audio-storage';
import { formatDateBR } from '@/lib/utils';

export async function AudiosRecentes() {
  let userId: string;
  try {
    const { userId: id } = await requireUser();
    userId = id;
  } catch {
    return null;
  }

  const { items } = await listAudios({
    userId,
    limit: 5,
    offset: 0,
  });

  // Sem áudio: card vazio (não polui painel). Sem CTA — o user nem sabe
  // que existe ainda.
  if (items.length === 0) return null;

  return (
    <section className="glass p-5">
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Mic className="w-3.5 h-3.5 text-violet-300" />
          </div>
          <div className="min-w-0">
            <p className="label-eyebrow">Áudios recentes</p>
            <h2 className="text-lg font-semibold mt-1">Sua memória do WhatsApp</h2>
          </div>
        </div>
        <Link
          href="/audios"
          className="shrink-0 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Ver todos <ArrowRight className="w-3 h-3" />
        </Link>
      </header>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5 py-2 border-b border-border last:border-0">
            {/* Data + duração */}
            <p className="text-[11px] text-zinc-500">
              {formatDateBR(item.occurred_at.slice(0, 10))}
              {item.duration_seconds != null && (
                <> · <span className="tabular-nums">
                  {item.duration_seconds < 60
                    ? `${item.duration_seconds}s`
                    : `${Math.floor(item.duration_seconds / 60)}:${(item.duration_seconds % 60).toString().padStart(2, '0')}`}
                </span></>
              )}
              {!item.audio_storage_path && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-600">
                  arquivo expirado
                </span>
              )}
            </p>

            {/* Sumário ou fallback pra transcrição truncada */}
            <p className="text-sm text-zinc-200 leading-snug">
              {item.ai_summary ?? (item.transcription ? item.transcription.slice(0, 110) + '…' : '(sem sumário)')}
            </p>

            {/* Tópicos */}
            {item.ai_topics && item.ai_topics.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {item.ai_topics.slice(0, 4).map((t) => (
                  <span
                    key={t}
                    className="px-1.5 h-5 inline-flex items-center rounded-full text-[10px] bg-zinc-800/60 border border-zinc-700/50 text-zinc-400"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
