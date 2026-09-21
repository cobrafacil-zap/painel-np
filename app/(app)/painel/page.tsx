import { createClient } from '@/lib/supabase/server';
import { startOfMonthISO, endOfMonthISO, formatBRL, formatDateBR } from '@/lib/utils';
import type { Tarefa, FinanceRecord } from '@/lib/types';
import { HeroSaldo } from './_components/hero-saldo';
import { TarefasProximas } from './_components/tarefas-proximas';
import { GraficoGastos7d } from './_components/grafico-gastos-7d';
import { HeatmapAtividade } from './_components/heatmap-atividade';
import { TopCategorias } from './_components/top-categorias';
import { ContasMoradia } from './_components/contas-moradia';
import { PadroesPrevistos } from './_components/padroes-previstos';
import { MetasMes } from './_components/metas-mes';
import { AtalhosRapidos } from './_components/atalhos-rapidos';
import { InstallPWAButton } from './_components/install-pwa-button';
import { PageHeader } from '../_components/page-header';
import { getMetaDiaria, getGastoHoje } from '@/lib/financeiro/meta-diaria';

export default async function PainelPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const inicio = startOfMonthISO();
  const fim = endOfMonthISO();

  // 7 dias atrás pra sparkline + heatmap
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 27);
  const seteDiasAtrasISO = seteDiasAtras.toISOString().slice(0, 10);

  // 5 dias pra frente (pra heatmap)
  const hojeISO = new Date().toISOString().slice(0, 10);

  // Fetch paralelo: tarefas pendentes, records mês, records 28 dias, meta diária + gasto de hoje
  const [tarefasRes, recordsMesRes, recordsRecentesRes, profileRes] = await Promise.all([
    supabase
      .from('tarefas')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pendente')
      .order('data_prazo', { ascending: true, nullsFirst: false })
      .order('hora_prazo', { ascending: true, nullsFirst: false })
      .order('ordem', { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from('records')
      .select('type, amount')
      .eq('user_id', user.id)
      .eq('module_id', 'financeiro')
      .gte('occurred_at', inicio)
      .lte('occurred_at', fim),
    supabase
      .from('records')
      .select('type, amount, category, occurred_at')
      .eq('user_id', user.id)
      .eq('module_id', 'financeiro')
      .gte('occurred_at', seteDiasAtrasISO)
      .lte('occurred_at', hojeISO),
    supabase
      .from('profiles')
      .select('full_name, evolution_instance_name, evolution_status')
      .eq('id', user.id)
      .single(),
  ]);

  // Meta diária + gasto de hoje (mini-ring do Hero). Funciona mesmo
  // sem migration 014 aplicada — `getMetaDiaria` retorna null e o
  // HeroSaldo decide não renderizar o ring.
  const [metaDiaria, gastoHoje] = await Promise.all([
    getMetaDiaria(user.id),
    getGastoHoje(user.id),
  ]);

  const tarefas = (tarefasRes.data ?? []) as Tarefa[];
  const receitas = (recordsMesRes.data ?? [])
    .filter((r: any) => r.type === 'receita')
    .reduce((s: number, r: any) => s + Number(r.amount), 0);
  const gastos = (recordsMesRes.data ?? [])
    .filter((r: any) => r.type === 'gasto')
    .reduce((s: number, r: any) => s + Number(r.amount), 0);
  const saldo = receitas - gastos;

  // === 7 dias (sparkline) — array de 7 dias, do mais antigo ao mais recente ===
  const sparklineDias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const sparklineLabels = sparklineDias.map((iso) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  );
  const sparklineData = sparklineDias.map((iso) =>
    (recordsRecentesRes.data ?? [])
      .filter((r: any) => r.type === 'gasto' && r.occurred_at === iso)
      .reduce((s: number, r: any) => s + Number(r.amount), 0)
  );

  // === Heatmap — 28 dias ===
  const heatmapMap = new Map<string, number>();
  for (const r of recordsRecentesRes.data ?? []) {
    if (r.type !== 'gasto') continue;
    heatmapMap.set(
      r.occurred_at,
      (heatmapMap.get(r.occurred_at) ?? 0) + Number(r.amount)
    );
  }
  const heatmapData = Array.from(heatmapMap.entries()).map(([dia, valor]) => ({
    dia,
    valor,
  }));

  // === Top categorias (mês) ===
  const porCategoria = new Map<string, number>();
  for (const r of recordsMesRes.data ?? []) {
    if (r.type !== 'gasto') continue;
    const cat = (r as any).category || 'Outros';
    porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + Number(r.amount));
  }
  const topCategorias = Array.from(porCategoria.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const periodo = new Date().toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const saudacao = profileRes.data?.full_name
    ? `Olá, ${profileRes.data.full_name.split(' ')[0]}.`
    : 'Olá.';
  const statusTarefas =
    tarefas.length === 0
      ? 'Nada pendente por aqui.'
      : `${tarefas.length} tarefa${tarefas.length > 1 ? 's' : ''} pendente${
          tarefas.length > 1 ? 's' : ''
        }.`;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* HEADER */}
      <PageHeader
        eyebrow="Painel"
        title={periodo}
        subtitle={`${saudacao} ${statusTarefas}`}
        action={<InstallPWAButton />}
      />

      {/* HERO SALDO (com mini-ring da meta diária se definida) */}
      <HeroSaldo
        receitas={receitas}
        gastos={gastos}
        saldo={saldo}
        metaDiaria={metaDiaria}
        gastoHoje={gastoHoje}
      />

      {/* GRID: TAREFAS + ATALHOS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div className="lg:col-span-8">
          <TarefasProximas tarefas={tarefas} />
        </div>
        <div className="lg:col-span-4">
          <AtalhosRapidos
            whatsappOn={!!profileRes.data?.evolution_instance_name}
          />
        </div>
      </div>

      {/* GRID: GRÁFICOS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
        <div className="lg:col-span-5">
          <GraficoGastos7d data={sparklineData} labels={sparklineLabels} />
        </div>
        <div className="lg:col-span-7">
          <HeatmapAtividade data={heatmapData} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <TopCategorias data={topCategorias} />
        <ContasMoradia refreshKey={0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <PadroesPrevistos />
        <MetasMes />
      </div>
    </div>
  );
}
