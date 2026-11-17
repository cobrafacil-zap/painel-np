'use client';

import { useEffect, useState } from 'react';
import { formatBRL, startOfMonthISO, endOfMonthISO } from '@/lib/utils';
import { labelForma } from '@/lib/financeiro/formas-pagamento';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useCountUp } from '@/lib/hooks/use-count-up';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

interface Resumo {
  saldo: number;
  total_receitas: number;
  total_gastos: number;
  total_investido?: number;
  por_categoria: Array<{ category: string | null; total: number; count: number }>;
  por_forma: Array<{ forma: string | null; total: number; count: number }>;
  evolucao_mensal: Array<{ mes: string; receitas: number; gastos: number }>;
}

interface LinhaTabela {
  label: string;
  total: number;
  cor: string;
  pct: number;
}

const PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#a855f7', '#10b981', '#0ea5e9'];
const COR_INVESTIDO = '#38bdf8';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'cartao_credito' → 'Cartao credito' (slug vira texto legível) */
function labelCategoria(slug: string): string {
  const s = slug.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** '2026-11' → 'nov/2026' */
function labelMes(yyyyMM: string): string {
  const [ano, mes] = yyyyMM.split('-');
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

export function ResumoCharts({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Resumo | null>(null);
  const [evolucao, setEvolucao] = useState<Resumo['evolucao_mensal']>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ini = startOfMonthISO();
    const fim = endOfMonthISO();
    // Evolução dos últimos 6 meses (o resumo do mês não inclui histórico)
    const hoje = new Date();
    const ini6 = startOfMonthISO(new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1));
    setLoading(true);
    Promise.all([
      fetch(`/api/financeiro/resumo?from=${ini}&to=${fim}`).then((r) => r.json()),
      fetch(`/api/financeiro/resumo?from=${ini6}&to=${fim}`).then((r) => r.json()),
    ])
      .then(([mes, hist]) => {
        setData(mes);
        setEvolucao((hist?.evolucao_mensal ?? []).slice(-6));
      })
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass p-5 h-24 shimmer rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass p-5 h-[300px] shimmer rounded-xl" />
          <div className="glass p-5 h-[300px] shimmer rounded-xl" />
        </div>
      </div>
    );
  }
  if (!data) return null;

  // Investimento não é lançamento, mas conta como gasto do mês — entra
  // como linha própria pra cada tabela bater com o total de Gastos.
  const investido = data.total_investido ?? 0;
  const montarLinhas = (itens: { label: string; total: number }[]): LinhaTabela[] => {
    const comInvestido = [...itens];
    if (investido > 0) {
      comInvestido.push({ label: 'Investimentos', total: investido });
    }
    const totalTabela = comInvestido.reduce((s, c) => s + c.total, 0);
    return comInvestido
      .map((c, i) => ({
        ...c,
        cor: c.label === 'Investimentos' ? COR_INVESTIDO : PALETTE[i % PALETTE.length],
        pct: totalTabela > 0 ? (c.total / totalTabela) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  };

  const linhasCategoria = montarLinhas(
    data.por_categoria.map((c) => ({
      label: c.category ? labelCategoria(c.category) : 'Não informado',
      total: c.total,
    })),
  );
  const linhasTipo = montarLinhas(
    data.por_forma.map((c) => ({
      label: c.forma ? labelForma(c.forma) : 'Não informado',
      total: c.total,
    })),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <CardKPI
          icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
          label="Receitas (mês)"
          value={data.total_receitas}
          color="emerald"
        />
        <CardKPI
          icon={<TrendingDown className="w-4 h-4 text-red-400" />}
          label="Gastos (mês)"
          value={data.total_gastos}
          color="red"
        />
        <CardKPI
          icon={<Wallet className="w-4 h-4 text-zinc-400" />}
          label="Saldo (mês)"
          value={data.saldo}
          color={data.saldo >= 0 ? 'emerald' : 'red'}
        />
      </div>

      {/* TABELAS — gastos por categoria e por tipo de pagamento */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TabelaGastos titulo="Gastos por categoria" linhas={linhasCategoria} />
        <TabelaGastos titulo="Gastos por tipo" linhas={linhasTipo} />
      </div>

      {/* GRÁFICO + TABELA — evolução mensal */}
      <div className="glass p-5">
        <h3 className="font-semibold mb-3">Evolução mensal (últimos 6 meses)</h3>
        {evolucao.length === 0 ? (
          <p className="text-sm text-zinc-500">Sem dados.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={evolucao}>
                <CartesianGrid stroke="#2a2a32" strokeDasharray="3 3" />
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 11, fill: '#a1a1aa' }}
                  stroke="#3f3f46"
                  tickFormatter={labelMes}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#a1a1aa' }}
                  stroke="#3f3f46"
                />
                <Tooltip
                  contentStyle={{ background: '#15151a', border: '1px solid #2a2a32', borderRadius: 8 }}
                  labelStyle={{ color: '#e4e4e7' }}
                  itemStyle={{ color: '#e4e4e7' }}
                  labelFormatter={(m) => labelMes(String(m))}
                  formatter={(v: number) => formatBRL(v)}
                />
                <Legend
                  formatter={(v) => (
                    <span style={{ color: '#d4d4d8' }}>
                      {v === 'receitas' ? 'Receitas' : 'Gastos'}
                    </span>
                  )}
                />
                <Line type="monotone" dataKey="receitas" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="gastos" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>

            <table className="w-full text-sm mt-4">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="font-medium pb-2">Mês</th>
                  <th className="font-medium pb-2 text-right">Receitas</th>
                  <th className="font-medium pb-2 text-right">Gastos</th>
                </tr>
              </thead>
              <tbody>
                {evolucao.map((m) => (
                  <tr key={m.mes} className="border-t border-white/[0.05]">
                    <td className="py-2 text-zinc-200">{labelMes(m.mes)}</td>
                    <td className="py-2 text-right num-tabular text-emerald-300">
                      {formatBRL(m.receitas)}
                    </td>
                    <td className="py-2 text-right num-tabular text-red-300">
                      {formatBRL(m.gastos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function TabelaGastos({ titulo, linhas }: { titulo: string; linhas: LinhaTabela[] }) {
  return (
    <div className="glass p-5">
      <h3 className="font-semibold mb-3">{titulo}</h3>
      {linhas.length === 0 ? (
        <p className="text-sm text-zinc-500">Sem gastos no período.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="font-medium pb-2">{titulo.replace('Gastos por ', '')}</th>
              <th className="font-medium pb-2 text-right">Valor</th>
              <th className="font-medium pb-2 text-right w-14">%</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.label} className="border-t border-white/[0.05]">
                <td className="py-2.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: l.cor }}
                    />
                    <span className="text-zinc-200 truncate">{l.label}</span>
                  </span>
                </td>
                <td className="py-2.5 text-right num-tabular text-zinc-100">
                  {formatBRL(l.total)}
                </td>
                <td className="py-2.5 text-right num-tabular text-zinc-400">
                  {l.pct.toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CardKPI({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'emerald' | 'red';
}) {
  const animated = useCountUp(value);
  const colorClass = color === 'emerald' ? 'text-emerald-300' : 'text-red-300';
  const accentBg =
    color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20';
  return (
    <div className="glass p-5 card-hover-lift">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${accentBg}`}>
          {icon}
        </div>
        <p className="label-eyebrow">{label}</p>
      </div>
      <p className={`text-2xl sm:text-3xl font-bold num-tabular mt-3 break-words ${colorClass}`}>
        {formatBRL(animated)}
      </p>
    </div>
  );
}
