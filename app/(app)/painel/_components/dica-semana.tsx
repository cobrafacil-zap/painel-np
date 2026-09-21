/**
 * Card "Dicas personalizadas" (#overhaul metas-largas).
 *
 * Mostra até 3 insights baseados nos dados reais do user: padrão de
 * gasto, aderência à meta diária, progresso de metas longas.
 *
 * Server component que faz fetch via service role. Se não houver
 * dados suficientes, mostra mensagem amigável incentivando registrar
 * gastos/definir metas.
 */

import { Lightbulb } from 'lucide-react';
import { requireUser } from '@/lib/supabase/server';
import { gerarInsights, type Insight } from '@/lib/financeiro/insights';

export async function DicaSemana() {
  let userId: string;
  try {
    const { userId: id } = await requireUser();
    userId = id;
  } catch {
    return null;
  }

  const insights = await gerarInsights(userId);

  return (
    <section className="glass p-5">
      <header className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
          <Lightbulb className="w-3.5 h-3.5 text-yellow-300" />
        </div>
        <div className="min-w-0">
          <p className="label-eyebrow">Dicas personalizadas</p>
          <h2 className="text-lg font-semibold mt-1">Baseado nos seus dados</h2>
        </div>
      </header>

      {insights.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-zinc-400">
            Sem dicas ainda — continue registrando seus gastos que em alguns dias
            aparecem padrões aqui.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {insights.map((ins, i) => (
            <InsightItem key={i} insight={ins} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InsightItem({ insight }: { insight: Insight }) {
  return (
    <li className="space-y-1">
      <p className="text-sm font-medium text-zinc-100">{insight.titulo}</p>
      <p className="text-xs text-zinc-400 leading-relaxed">{insight.descricao}</p>
    </li>
  );
}
