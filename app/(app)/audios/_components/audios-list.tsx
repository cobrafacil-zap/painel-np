'use client';

import { useState, useTransition } from 'react';
import { Search, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateBR } from '@/lib/utils';

export interface AudioItem {
  id: string;
  message_id_whatsapp: string;
  occurred_at: string;
  duration_seconds: number | null;
  mime_type: string | null;
  transcription: string | null;
  ai_summary: string | null;
  ai_topics: string[] | null;
  ai_entities: { people?: string[]; amounts?: number[]; places?: string[] } | null;
  audio_storage_path: string | null;
  signed_url: string | null;
}

interface ListResponse {
  items: AudioItem[];
  total: number;
}

function formatDuration(secs: number | null): string {
  if (secs == null) return '';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function AudiosList({
  initialItems,
  initialTotal,
}: {
  initialItems: AudioItem[];
  initialTotal: number;
}) {
  const [items, setItems] = useState<AudioItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSearch(q: string) {
    setQuery(q);
    startTransition(async () => {
      const url = new URL('/api/audios', window.location.origin);
      url.searchParams.set('limit', '20');
      url.searchParams.set('offset', '0');
      if (q.trim()) url.searchParams.set('q', q.trim());
      const res = await fetch(url.toString());
      const data: ListResponse = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePlay(item: AudioItem) {
    if (!item.signed_url) return;
    if (playing === item.id) {
      setPlaying(null);
    } else {
      setPlaying(item.id);
      // Player é só um <audio> abaixo; controlamos via state pra
      // fechar player anterior ao abrir outro (evita 2 tocando junto).
    }
  }

  // Coleta tópicos únicos do top 10 mais frequentes pra chips de filtro
  const topTopics = (() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const t of item.ai_topics ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);
  })();

  return (
    <div className="space-y-4">
      {/* Header com busca */}
      <div className="glass p-3 sm:p-4">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="search"
            placeholder="Buscar em transcrições e sumários…"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full h-11 pl-10 pr-3 rounded-lg bg-bg-base border border-border focus:border-emerald-500 focus:outline-none text-sm"
          />
        </label>

        {topTopics.length > 0 && (
          <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1">
            {topTopics.map((t) => (
              <button
                key={t}
                onClick={() => handleSearch(t)}
                className="px-2.5 h-7 rounded-full text-xs whitespace-nowrap bg-bg-base border border-border text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-zinc-500 mt-2">
          {total} resultado{total === 1 ? '' : 's'}{query.trim() && ` para "${query}"`}
        </p>
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <EmptyState
          title={query ? 'Nenhum áudio encontrado' : 'Nenhum áudio ainda'}
          description={
            query
              ? 'Tente outra palavra ou remova o filtro.'
              : 'Quando você enviar áudio no WhatsApp, ele aparece aqui com sumário e tópicos.'
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isExpanded = expanded.has(item.id);
            const isPlaying = playing === item.id;
            const archived = !item.audio_storage_path;

            return (
              <article key={item.id} className="glass p-4 sm:p-5 space-y-3">
                {/* Header: data + duração + botão play */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500">
                      {formatDateBR(item.occurred_at.slice(0, 10))}
                      {item.duration_seconds != null && (
                        <> · <span className="tabular-nums">{formatDuration(item.duration_seconds)}</span></>
                      )}
                      {archived && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-600">
                          arquivo expirado
                        </span>
                      )}
                    </p>
                  </div>
                  {item.signed_url && (
                    <button
                      onClick={() => togglePlay(item)}
                      className="shrink-0 w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 flex items-center justify-center transition-colors"
                      aria-label={isPlaying ? 'Pausar áudio' : 'Tocar áudio'}
                    >
                      <Play className={`w-4 h-4 ${isPlaying ? 'opacity-60' : ''}`} />
                    </button>
                  )}
                </div>

                {/* Player inline (renderizado condicionalmente) */}
                {isPlaying && item.signed_url && (
                  <audio
                    src={item.signed_url}
                    controls
                    autoPlay
                    onEnded={() => setPlaying(null)}
                    className="w-full h-9"
                  />
                )}

                {/* Sumário IA */}
                {item.ai_summary && (
                  <p className="text-sm text-zinc-200 leading-relaxed">
                    {item.ai_summary}
                  </p>
                )}

                {/* Tópicos */}
                {item.ai_topics && item.ai_topics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.ai_topics.map((t) => (
                      <span
                        key={t}
                        className="px-2 h-6 inline-flex items-center rounded-full text-[11px] bg-zinc-800/60 border border-zinc-700/50 text-zinc-300"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Entidades */}
                {item.ai_entities && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {item.ai_entities.amounts && item.ai_entities.amounts.length > 0 && (
                      <span>
                        💰 {item.ai_entities.amounts.map((a) => `R$ ${a}`).join(', ')}
                      </span>
                    )}
                    {item.ai_entities.places && item.ai_entities.places.length > 0 && (
                      <span>📍 {item.ai_entities.places.join(', ')}</span>
                    )}
                    {item.ai_entities.people && item.ai_entities.people.length > 0 && (
                      <span>👤 {item.ai_entities.people.join(', ')}</span>
                    )}
                  </div>
                )}

                {/* Transcrição (colapsável) */}
                {item.transcription && (
                  <div className="border-t border-border pt-2">
                    <button
                      onClick={() => toggleExpanded(item.id)}
                      className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      {isExpanded ? 'Ocultar' : 'Ver'} transcrição completa
                    </button>
                    {isExpanded && (
                      <p className="mt-2 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {item.transcription}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
