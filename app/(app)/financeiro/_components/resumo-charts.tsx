'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatBRL, startOfMonthISO, endOfMonthISO, monthISO } from '@/lib/utils';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { useCountUp } from '@/lib/hooks/use-count-up';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

interface Resumo {
  saldo: number;
  total_receitas: number;
  total_gastos: number;
  por_categoria: Array<{ category: string; total: number; count: number }>;
  evolucao_mensal: Array<{ mes: string; receitas: number; gastos: number }>;
}

const PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#a855f7', '#10b981', '#0ea5e9'];

export function ResumoCharts({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ini = startOfMonthISO();
    const fim = endOfMonthISO();
    setLoading(true);
    fetch(`/api/financeiro/resumo?from=${ini}&to=${fim}`)
      .then((r) => r.json())
      .then((d) => setData(d))
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass p-5">
          <h3 className="font-semibold mb-3">Gastos por categoria</h3>
          {data.por_categoria.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem gastos no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.por_categoria}
                  dataKey="total"
                  nameKey="category"
                  outerRadius={90}
                  label={(d) => d.category}
                >
                  {data.por_categoria.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#15151a', border: '1px solid #2a2a32' }}
                  formatter={(v: number) => formatBRL(v)}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass p-5">
          <h3 className="font-semibold mb-3">Top categorias (barras)</h3>
          {data.por_categoria.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem dados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.por_categoria.slice(0, 8)}>
                <CartesianGrid stroke="#2a2a32" strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#15151a', border: '1px solid #2a2a32' }}
                  formatter={(v: number) => formatBRL(v)}
                />
                <Bar dataKey="total" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="glass p-5">
        <h3 className="font-semibold mb-3">Evolução mensal (últimos 6 meses)</h3>
        {data.evolucao_mensal.length === 0 ? (
          <p className="text-sm text-zinc-500">Sem dados.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.evolucao_mensal}>
              <CartesianGrid stroke="#2a2a32" strokeDasharray="3 3" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#15151a', border: '1px solid #2a2a32' }}
                formatter={(v: number) => formatBRL(v)}
              />
              <Legend />
              <Line type="monotone" dataKey="receitas" stroke="#22c55e" strokeWidth={2} />
              <Line type="monotone" dataKey="gastos" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
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
      <p className={`text-3xl font-bold num-tabular mt-3 ${colorClass}`}>
        {formatBRL(animated)}
      </p>
    </div>
  );
}
