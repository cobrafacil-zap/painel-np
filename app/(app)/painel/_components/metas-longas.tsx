/**
 * Card de metas financeiras de longo prazo (#overhaul metas-largas).
 *
 * Mostra:
 *   - Lista de metas ativas com barra de progresso + status
 *   - Simulador "se eu quiser juntar X em Y meses"
 *
 * Server component que faz fetch via service role direto (mesmo
 * padrão de AudiosRecentes / PadroesPrevistos).
 */

import { listMetasLongas, simularMetaLonga, type MetaLongaComProgresso } from '@/lib/financeiro/metas-longas';
import { formatBRL } from '@/lib/utils';
import { Target, TrendingUp, Calculator } from 'lucide-react';
import { SimuladorMetaLonga } from './simulador-meta-longa';
import { requireUser } from '@/lib/supabase/server';

export async function MetasLongas() {
  let userId: string;
  try {
    const { userId: id } = await requireUser();
    userId = id;
  } catch {
    return null;
  }

  const metas = await listMetasLongas(userId);

  return (
    <section className="glass p-5">
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
            <Target className="w-3.5 h-3.5 text-blue-300" />
          </div>
          <div className="min-w-0">
            <p className="label-eyebrow">Metas de longo prazo</p>
            <h2 className="text-lg font-semibold mt-1">Seus objetivos</h2>
          </div>
        </div>
        <SimuladorMetaLonga />
      </header>

      {metas.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-zinc-400">Nenhuma meta de longo prazo definida.</p>
          <p className="text-[11px] text-zinc-600 mt-2">
            Manda no WhatsApp:{' '}
            <span className="text-zinc-300">&ldquo;quero juntar 100 mil em 5 anos&rdquo;</span>
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {metas.map((m) => (
            <MetaLongaItem key={m.id} meta={m} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MetaLongaItem({ meta }: { meta: MetaLongaComProgresso }) {
  const statusLabel = {
    no_prazo: { texto: 'No prazo', cor: 'text-emerald-300', bg: 'bg-emerald-500' },
    atrasado: { texto: 'Atrasado', cor: 'text-red-300', bg: 'bg-red-500' },
    concluida: { texto: '✓ Concluída', cor: 'text-emerald-300', bg: 'bg-emerald-500' },
  }[meta.status];

  const pctDisplay = Math.min(100, meta.progresso_pct);

  return (
    <li className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100 truncate">{meta.nome}</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {formatBRL(meta.valor_guardado)} de {formatBRL(meta.valor_alvo)} ·{' '}
            {meta.prazo_meses >= 12
              ? `${(meta.prazo_meses / 12).toFixed(meta.prazo_meses % 12 === 0 ? 0 : 1)} ano${meta.prazo_meses > 12 ? 's' : ''}`
              : `${meta.prazo_meses} meses`}
          </p>
        </div>
        <span className={`text-[10px] uppercase tracking-wider ${statusLabel.cor} shrink-0`}>
          {statusLabel.texto}
        </span>
      </div>

      {/* Barra de progresso */}
      <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className={`h-full ${statusLabel.bg} transition-all`}
          style={{ width: `${pctDisplay}%` }}
        />
      </div>

      {/* Detalhes: pct + parcela mensal */}
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-400 num-tabular">{meta.progresso_pct.toFixed(0)}%</span>
        {meta.status !== 'concluida' && (
          <span className="text-zinc-500 num-tabular">
            <TrendingUp className="w-3 h-3 inline-block -mt-0.5 mr-1" />
            guardar {formatBRL(meta.parcela_mensal)}/mês
          </span>
        )}
      </div>

      {/* Mensagem de atraso */}
      {meta.status === 'atrasado' && (
        <p className="text-[10px] text-red-300/80">
          Pra bater o prazo, precisa guardar {formatBRL(meta.parcela_mensal)}/mês.
        </p>
      )}
    </li>
  );
}

// Re-export do simulador pra ficar junto do componente
export { SimuladorMetaLonga };
