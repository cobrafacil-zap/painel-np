'use client';

/**
 * Aba "Reserva de Emergência" (#feature reserva-emergencia).
 *
 * Meta = gastos fixos mensais × 6 (auto-detecta via Compromissos).
 * Barra de progresso avança a cada depósito. Quando atinge 100%,
 * mostra CTA "Ir pra renda passiva".
 *
 * Sugestões textuais de onde guardar (sem número mágico):
 *   - Tesouro Selic, CDB liquidez diária, Conta remunerada.
 *
 * Projeção de tempo baseada em 'posso guardar X/mês' (input manual,
 * auto-preenchido com sobrinha só no primeiro load).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldCheck,
  Wallet,
  PiggyBank,
  Plus,
  Trash2,
  ExternalLink,
  ArrowRight,
  TrendingUp,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { formatBRL, formatDateBR } from '@/lib/utils';
import {
  ONDE_GUARDAR_SUGESTOES,
  calcularProgresso,
  TAXA_MENSAL_CDI,
} from '@/lib/financeiro/reserva-emergencia';

const STORAGE_KEY = 'painel-np:reserva-emergencia:v1';

interface EstadoSalvo {
  aporteMensal: number; // quanto o user pode guardar por mês (0 = sem input)
}

interface ResumoAPI {
  gastos_fixos_mensal: number;
  meta_reserva: number;
  total_depositado: number;
  progresso_pct: number;
  completa: boolean;
  falta: number;
  fase: 'construindo' | 'rendendo';
  rendimento_mensal_estimado: number;
  receita_media_3m: number;
  sobrinha_estimada: number;
  compromissos_ativos: number;
  depositos_recentes: DepositoReserva[];
}

interface DepositoReserva {
  id: string;
  valor: number;
  descricao: string | null;
  occurred_at: string;
}

export function AbaReservaEmergencia() {
  const router = useRouter();
  const [resumo, setResumo] = useState<ResumoAPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  // ref pra saber se é o primeiro carregamento (auto-popular aporte só na primeira vez)
  const primeiroLoad = useRef(true);
  const [aporteMensal, setAporteMensal] = useState<number>(0);

  async function load() {
    try {
      const r = await fetch('/api/financeiro/reserva-emergencia');
      const j = await r.json();
      setResumo(j);
    } finally {
      setLoading(false);
    }
  }

  // Hidrata aporteMensal do localStorage na primeira vez
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as EstadoSalvo;
        if (typeof parsed.aporteMensal === 'number') {
          setAporteMensal(parsed.aporteMensal);
          primeiroLoad.current = false;
        }
      }
    } catch {
      // ignore parse error
    }
  }, []);

  // Auto-popula aporteMensal com sobrinha só no primeiro load (se user não tem valor salvo)
  useEffect(() => {
    if (primeiroLoad.current && resumo && resumo.sobrinha_estimada > 0) {
      primeiroLoad.current = false;
      setAporteMensal((atual) => (atual > 0 ? atual : resumo.sobrinha_estimada));
    }
  }, [resumo]);

  // Persiste aporteMensal em localStorage em qualquer mudança
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ aporteMensal } satisfies EstadoSalvo),
      );
    } catch {
      // ignore quota error
    }
  }, [aporteMensal]);

  // Recalcula projeção derivada da reserva (mesma lógica do backend)
  const projecao = useMemo(() => {
    if (!resumo) return null;
    return calcularProgresso(
      resumo.gastos_fixos_mensal,
      resumo.total_depositado,
      aporteMensal,
    );
  }, [resumo, aporteMensal]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function depositar() {
    const v = Number(valor);
    if (!v || v <= 0) {
      setErro('Informe um valor maior que zero');
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      const r = await fetch('/api/financeiro/reserva-emergencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valor: v,
          descricao: descricao.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErro(j.error ?? j.message ?? 'Erro ao salvar');
        return;
      }
      setValor('');
      setDescricao('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remover(id: string) {
    if (!confirm('Remover este depósito?')) return;
    setRemovendoId(id);
    try {
      const r = await fetch(`/api/financeiro/reserva-emergencia/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        alert('Erro ao remover');
        return;
      }
      await load();
    } finally {
      setRemovendoId(null);
    }
  }

  if (loading || !resumo) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-xl shimmer" />
        <div className="h-24 rounded-xl shimmer" />
      </div>
    );
  }

  const pctExibido = Math.min(100, Math.round(resumo.progresso_pct));
  const pctReal = resumo.progresso_pct;
  const corBarra =
    pctReal >= 100
      ? 'from-emerald-400 to-emerald-600'
      : pctReal >= 50
        ? 'from-emerald-400 to-emerald-500'
        : pctReal >= 20
          ? 'from-amber-400 to-amber-500'
          : 'from-red-400 to-red-500';

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Card principal: progresso */}
      <section className="glass-elevated rounded-xl p-5">
        <header className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <p className="label-eyebrow">Reserva de Emergência</p>
              <h2 className="text-base sm:text-lg font-semibold mt-0.5">
                Sua rede de segurança financeira
              </h2>
            </div>
          </div>
        </header>

        {/* Banner gate: reserva completa */}
        {resumo.completa && (
          <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-emerald-200">
              <span className="text-lg">✅</span>
              <span className="font-medium">
                Reserva completa! Agora você pode investir com segurança.
              </span>
            </div>
            <button
              type="button"
              onClick={() => router.push('/financeiro/investimentos?tab=renda-passiva')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/30 text-sm font-medium"
            >
              Ir pra renda passiva <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Meta vazia: orientar cadastro */}
        {resumo.meta_reserva === 0 && (
          <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">Sem meta definida ainda.</p>
            <p className="text-xs text-amber-300/80 mt-1">
              Cadastre um compromisso de gasto fixo (aluguel, conta de luz, etc.) em{' '}
              <Link
                href="/financeiro/compromissos"
                className="underline hover:text-amber-100"
              >
                Compromissos
              </Link>{' '}
              — a meta da reserva vai ser calculada como 6× seus gastos fixos.
            </p>
          </div>
        )}

        {/* Números principais */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat
            label="Meta"
            value={formatBRL(resumo.meta_reserva)}
            help={`6× ${formatBRL(resumo.gastos_fixos_mensal)}`}
          />
          <Stat
            label="Guardado"
            value={formatBRL(resumo.total_depositado)}
            accent="emerald"
          />
          <Stat
            label={resumo.completa ? 'Passou da meta' : 'Faltam'}
            value={formatBRL(resumo.falta)}
            accent={resumo.completa ? 'emerald' : 'amber'}
          />
        </div>

        {/* Barra de progresso grande */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Progresso</span>
            <span className="font-semibold text-zinc-200 tabular-nums">
              {pctExibido}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${corBarra} transition-all duration-500`}
              style={{ width: `${pctExibido}%` }}
            />
          </div>
        </div>
      </section>

      {/* Card: depósito */}
      <section className="glass-elevated rounded-xl p-5">
        <header className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-emerald-300" />
          <p className="label-eyebrow">Depositar</p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="block">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
              Valor (R$)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="500.00"
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-3 py-2 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
              Nota (opcional)
            </span>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="ex: rendimento mensal"
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-400/40"
            />
          </label>
          <button
            type="button"
            onClick={depositar}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 text-sm font-medium whitespace-nowrap"
          >
            {saving ? 'Salvando…' : 'Depositar'}
          </button>
        </div>

        {erro && (
          <p className="mt-2 text-xs text-red-300">❌ {erro}</p>
        )}
      </section>

      {/* Card: posso guardar por mês + projeção */}
      <section className="glass-elevated rounded-xl p-5">
        <header className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-emerald-300" />
          <p className="label-eyebrow">Projeção</p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end mb-4">
          <label className="block">
            <span className="block text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
              Posso guardar por mês (R$)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={aporteMensal > 0 ? aporteMensal : ''}
              onChange={(e) => {
                const v = e.target.value;
                setAporteMensal(v === '' ? 0 : Number(v));
              }}
              placeholder={
                resumo.sobrinha_estimada > 0
                  ? `auto-preenchido com ${formatBRL(resumo.sobrinha_estimada)}`
                  : 'ex: 500.00'
              }
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-3 py-2 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
            />
            {resumo.sobrinha_estimada > 0 && (
              <span className="block text-[10px] text-zinc-500 mt-1">
                💡 Sugestão: sua sobrinha estimada é{' '}
                <span className="text-emerald-300">
                  {formatBRL(resumo.sobrinha_estimada)}
                </span>{' '}
                (receita {formatBRL(resumo.receita_media_3m)} − gastos{' '}
                {formatBRL(resumo.gastos_fixos_mensal)})
              </span>
            )}
          </label>
        </div>

        {/* Resultado da projeção */}
        {projecao && (
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-4">
            {projecao.fase === 'rendendo' ? (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-emerald-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-emerald-200">
                    Fase 2: reserva rendendo ~{formatBRL(projecao.rendimento_mensal_estimado)}/mês
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    A reserva está rendendo ~{(TAXA_MENSAL_CDI * 100).toFixed(2)}%/mês
                    (~100% CDI). Agora o foco é manter e investir o excedente.
                  </p>
                </div>
              </div>
            ) : projecao.meses_estimados != null ? (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-200">
                    Fase 1: construindo —{' '}
                    {projecao.anos_estimados != null && projecao.anos_estimados > 0
                      ? `${projecao.anos_estimados} ${projecao.anos_estimados === 1 ? 'ano' : 'anos'}`
                      : ''}
                    {projecao.anos_estimados != null &&
                      projecao.anos_estimados > 0 &&
                      projecao.meses_restantes != null &&
                      projecao.meses_restantes > 0 &&
                      ' e '}
                    {projecao.meses_restantes != null && projecao.meses_restantes > 0
                      ? `${projecao.meses_restantes} ${projecao.meses_restantes === 1 ? 'mês' : 'meses'}`
                      : ''}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Guardando {formatBRL(aporteMensal)}/mês → reserva completa em{' '}
                    <span className="text-zinc-100 font-medium">
                      {projecao.meses_estimados}{' '}
                      {projecao.meses_estimados === 1 ? 'mês' : 'meses'}
                    </span>
                    . Faltam {formatBRL(projecao.falta)}.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Sem projeção ainda
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Informe quanto consegue guardar por mês pra ver em quanto tempo
                    bate a meta.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Card: onde guardar (sugestões textuais) */}
      <section className="glass-elevated rounded-xl p-5">
        <header className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-emerald-300" />
          <p className="label-eyebrow">Onde guardar</p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ONDE_GUARDAR_SUGESTOES.map((s) => (
            <div
              key={s.titulo}
              className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-medium text-zinc-100">{s.titulo}</p>
                <span className="text-[9px] uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded shrink-0">
                  {s.badge}
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">{s.descricao}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Card: contexto (gastos fixos + link) */}
      <section className="glass-elevated rounded-xl p-5">
        <header className="flex items-center gap-2 mb-3">
          <PiggyBank className="w-4 h-4 text-emerald-300" />
          <p className="label-eyebrow">Cálculo da meta</p>
        </header>
        <div className="space-y-2 text-sm text-zinc-300">
          <p className="tabular-nums">
            Gastos fixos mensais:{' '}
            <span className="text-zinc-100 font-medium">
              {formatBRL(resumo.gastos_fixos_mensal)}
            </span>{' '}
            <span className="text-zinc-500 text-xs">
              ({resumo.compromissos_ativos}{' '}
              {resumo.compromissos_ativos === 1 ? 'compromisso' : 'compromissos'} ativos)
            </span>
          </p>
          <p className="tabular-nums">
            Cobertura desejada:{' '}
            <span className="text-zinc-100 font-medium">6 meses</span>
          </p>
          <p className="tabular-nums">
            Meta da reserva:{' '}
            <span className="text-zinc-100 font-medium">
              {formatBRL(resumo.meta_reserva)}
            </span>
          </p>
        </div>
        <Link
          href="/financeiro/compromissos"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200"
        >
          Editar gastos fixos <ExternalLink className="w-3 h-3" />
        </Link>
      </section>

      {/* Histórico de depósitos */}
      {resumo.depositos_recentes.length > 0 && (
        <section className="glass-elevated rounded-xl p-5">
          <header className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-emerald-300" />
            <p className="label-eyebrow">
              Histórico ({resumo.depositos_recentes.length})
            </p>
          </header>
          <ul className="space-y-1.5">
            {resumo.depositos_recentes.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-zinc-500 tabular-nums w-20 shrink-0">
                    {formatDateBR(d.occurred_at.slice(0, 10))}
                  </span>
                  <span className="tabular-nums text-emerald-200 font-medium shrink-0">
                    {formatBRL(Number(d.valor))}
                  </span>
                  {d.descricao && (
                    <span className="text-xs text-zinc-400 truncate">
                      {d.descricao}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remover(d.id)}
                  disabled={removendoId === d.id}
                  className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300 disabled:opacity-50 shrink-0"
                  title="Remover"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  help,
  accent,
}: {
  label: string;
  value: string;
  help?: string;
  accent?: 'emerald' | 'amber';
}) {
  const corValor =
    accent === 'emerald'
      ? 'text-emerald-300'
      : accent === 'amber'
        ? 'text-amber-300'
        : 'text-zinc-100';
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`text-base sm:text-lg font-bold num-tabular mt-0.5 ${corValor}`}>
        {value}
      </p>
      {help && <p className="text-[10px] text-zinc-600 mt-0.5">{help}</p>}
    </div>
  );
}
