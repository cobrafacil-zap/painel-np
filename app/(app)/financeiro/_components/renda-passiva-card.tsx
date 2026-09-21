'use client';

/**
 * Página "Planejamento de Renda Passiva" (#feature renda-passiva).
 *
 * Sub-rota de /financeiro. Não auto-calcula com base na receita —
 * user digita o que GANHA, sistema subtrai gastos fixos e sugere
 * quanto CABE investir (% conservador/moderado/agressivo).
 *
 * Cada vez que o user informa um DEPÓSITO a mais, a barra de progresso
 * avança (calculada como soma_depósito / capital_necessário_do_cenário).
 *
 * Estado em localStorage.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  TrendingUp,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ExternalLink,
  Calendar,
  Wallet,
  PiggyBank,
  Plus,
  Trash2,
  Target,
} from 'lucide-react';
import { formatBRL } from '@/lib/utils';
import {
  CENARIOS,
  simularRendaPassiva,
  formatarPrazo,
  type LinhaCenario,
  type Deposito,
} from '@/lib/financeiro/renda-passiva';

const STORAGE_KEY = 'painel-np:renda-passiva:v3';

interface EstadoSalvo {
  rendaAlvo: number;
  receitaMensal: number; // quanto o user GANHA
  pctRecomendado: number; // 10/20/30 → conservador/moderado/agressivo
  manualAporte: number | null; // override do aporte sugerido
  cenarioFoco: string; // 'conservador' | ... (qual cenário mostra a barra)
}

const ESTADO_DEFAULT: EstadoSalvo = {
  rendaAlvo: 3000,
  receitaMensal: 0,
  pctRecomendado: 20,
  manualAporte: null,
  cenarioFoco: 'moderado',
};

interface ResumoAPI {
  receita_media_3m: number;
  gastos_fixos_estimado: number;
  sobrinha_essencial: number;
  total_depositado: number;
  depositos_recentes: Deposito[];
  samples_receita: number;
  compromissos_ativos: number;
}

export default function RendaPassivaPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoSalvo>(ESTADO_DEFAULT);
  const [resumo, setResumo] = useState<ResumoAPI | null>(null);
  const [carregado, setCarregado] = useState(false);
  // ref pra saber se é o primeiro carregamento (auto-popular receita só na primeira vez)
  const primeiroLoad = useRef(true);

  async function load() {
    try {
      const r = await fetch('/api/financeiro/renda-passiva');
      const j: ResumoAPI = await r.json();
      setResumo(j);
      // Auto-popular receita só na primeira vez, se user não preencheu
      if (primeiroLoad.current) {
        primeiroLoad.current = false;
        setEstado((e) => ({
          ...e,
          receitaMensal: e.receitaMensal > 0 ? e.receitaMensal : (j.receita_media_3m || 0),
        }));
      }
    } catch {
      // ignore
    } finally {
      setCarregado(true);
    }
  }

  useEffect(() => {
    // Carrega do localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          setEstado((e) => ({ ...e, ...parsed }));
          primeiroLoad.current = false; // já tem estado do localStorage, não auto-popular
        }
      }
    } catch {
      // ignore
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste estado (exceto depósito recente, que vem da API)
  useEffect(() => {
    if (!carregado) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    } catch {
      // ignore
    }
  }, [estado, carregado]);

  // Recarrega quando o user volta pra página (após nav do /financeiro)
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gastosFixosAuto = resumo?.gastos_fixos_estimado ?? 0;
  const sobrinhaCalculada = Math.max(0, estado.receitaMensal - gastosFixosAuto);
  const aporteSugerido = useMemo(
    () => Math.round(sobrinhaCalculada * (estado.pctRecomendado / 100) * 100) / 100,
    [sobrinhaCalculada, estado.pctRecomendado],
  );
  const aporteEfetivo =
    estado.manualAporte != null && estado.manualAporte >= 0
      ? estado.manualAporte
      : aporteSugerido;

  const linhas: LinhaCenario[] = useMemo(
    () =>
      simularRendaPassiva({
        rendaMensalDesejada: estado.rendaAlvo,
        aporteMensal: aporteEfetivo,
      }),
    [estado.rendaAlvo, aporteEfetivo],
  );

  const cenarioFoco = useMemo(
    () => CENARIOS.find((c) => c.id === estado.cenarioFoco) ?? CENARIOS[1],
    [estado.cenarioFoco],
  );
  const linhaFoco = useMemo(
    () => linhas.find((l) => l.cenario.id === cenarioFoco.id) ?? linhas[1],
    [linhas, cenarioFoco],
  );

  const totalDepositado = resumo?.total_depositado ?? 0;
  const capitalAlvoFoco = linhaFoco.capital_necessario;
  const pctFoco =
    capitalAlvoFoco > 0 ? Math.min(100, (totalDepositado / capitalAlvoFoco) * 100) : 0;
  const faltaFoco = Math.max(0, capitalAlvoFoco - totalDepositado);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => router.push('/financeiro')}
            className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block"
          >
            ← voltar
          </button>
          <p className="label-eyebrow">Planejamento</p>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight mt-1 break-words">
            Quanto preciso pra parar de trabalhar?
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1.5 max-w-2xl">
            Você diz quanto ganha, eu calculo quanto cabe investir sem
            prejudicar o resto. Cada cenário mostra o capital necessário
            pra viver de renda. <span className="text-zinc-400">Deposita?</span>
            A barra sobe.
          </p>
        </div>
      </header>

      {/* Inputs da "receita do user" → "aporte sugerido" */}
      <section className="glass-elevated rounded-xl p-5">
        <p className="label-eyebrow">Quanto você ganha</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <div>
            <label className="block text-xs">
              <span className="text-zinc-400">Sua receita mensal</span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-zinc-500">R$</span>
                <input
                  type="number"
                  value={estado.receitaMensal || ''}
                  onChange={(e) =>
                    setEstado({ ...estado, receitaMensal: Number(e.target.value) || 0 })
                  }
                  placeholder={resumo?.receita_media_3m ? String(resumo.receita_media_3m) : '7000'}
                  min={0}
                  step={100}
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
                />
              </div>
              {resumo?.receita_media_3m ? (
                <p className="text-[10px] text-zinc-600 mt-1">
                  Detectado automaticamente:{' '}
                  <span className="num-tabular">{formatBRL(resumo.receita_media_3m)}</span>{' '}
                  (média 3 meses)
                </p>
              ) : (
                <p className="text-[10px] text-zinc-600 mt-1">
                  Sem receita registrada. Digite manualmente.
                </p>
              )}
            </label>
          </div>

          <div>
            <label className="block text-xs">
              <span className="text-zinc-400 flex items-center gap-1.5">
                Gastos fixos mensais
                {gastosFixosAuto > 0 && (
                  <span className="text-[9px] uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 px-1 py-0.5 rounded">
                    auto
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-zinc-500">R$</span>
                <p className="flex-1 text-lg font-semibold num-tabular text-zinc-100">
                  {gastosFixosAuto > 0 ? formatBRL(gastosFixosAuto) : '—'}
                </p>
                <Link
                  href="/financeiro/compromissos"
                  className="shrink-0 text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                  title="Cadastrar/editar em Compromissos"
                >
                  editar
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">
                {resumo?.compromissos_ativos ? (
                  <>
                    De {resumo.compromissos_ativos} compromisso
                    {resumo.compromissos_ativos !== 1 ? 's' : ''} ativo
                    {resumo.compromissos_ativos !== 1 ? 's' : ''} (tipo &ldquo;pagar&rdquo;,
                    com recorrência). Cadastre em{' '}
                    <Link
                      href="/financeiro/compromissos"
                      className="text-zinc-400 hover:text-zinc-200 underline"
                    >
                      Compromissos
                    </Link>{' '}
                    se quiser adicionar mais.
                  </>
                ) : (
                  <>
                    Sem compromissos cadastrados. Cadastre em{' '}
                    <Link
                      href="/financeiro/compromissos"
                      className="text-zinc-400 hover:text-zinc-200 underline"
                    >
                      Compromissos
                    </Link>{' '}
                    pra alimentar essa conta.
                  </>
                )}
              </p>
            </label>
          </div>

          <div>
            <label className="block text-xs">
              <span className="text-zinc-400">&ldquo;Sobrinha&rdquo; essencial</span>
              <p className="mt-1 text-lg font-semibold num-tabular text-zinc-100">
                {formatBRL(sobrinhaCalculada)}
              </p>
              <p className="text-[10px] text-zinc-600 mt-1">
                = receita − gastos fixos (o que sobra antes de variável)
              </p>
            </label>
          </div>
        </div>

        {/* Slider de % recomendado */}
        <div className="border-t border-white/[0.06] mt-5 pt-4">
          <p className="text-xs text-zinc-400 mb-2">
            Quanto da &ldquo;sobrinha&rdquo; você quer investir?
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { pct: 10, label: 'Conservador', cor: 'amber' },
              { pct: 20, label: 'Moderado', cor: 'emerald' },
              { pct: 30, label: 'Agressivo', cor: 'red' },
            ].map((p) => {
              const ativo = estado.pctRecomendado === p.pct;
              return (
                <button
                  key={p.pct}
                  type="button"
                  onClick={() =>
                    setEstado({ ...estado, pctRecomendado: p.pct, manualAporte: null })
                  }
                  className={`px-3 py-2 rounded-md text-xs border transition-colors ${
                    ativo
                      ? p.cor === 'emerald'
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                        : p.cor === 'amber'
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                          : 'bg-red-500/20 border-red-500/40 text-red-200'
                      : 'bg-white/[0.04] border-white/[0.06] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span className="block font-semibold text-base">{p.pct}%</span>
                  <span className="block text-[10px] mt-0.5">{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Aporte: sugerido + manual */}
        <div className="border-t border-white/[0.06] mt-4 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Aporte sugerido</p>
            <p className="text-2xl font-bold num-tabular text-emerald-300 flex items-center gap-1.5">
              <Wallet className="w-4 h-4" />
              {formatBRL(aporteSugerido)}
              <span className="text-xs font-normal text-zinc-500">/mês</span>
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {estado.pctRecomendado}% da sobrinha
            </p>
          </div>
          <div>
            <label className="block text-xs">
              <span className="text-zinc-400">Ou sobrescreva aqui</span>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-zinc-500">R$</span>
                <input
                  type="number"
                  value={estado.manualAporte ?? ''}
                  onChange={(e) =>
                    setEstado({
                      ...estado,
                      manualAporte:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  placeholder={String(aporteSugerido)}
                  min={0}
                  step={50}
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
                />
                {estado.manualAporte != null && (
                  <button
                    type="button"
                    onClick={() => setEstado({ ...estado, manualAporte: null })}
                    className="shrink-0 text-zinc-500 hover:text-zinc-300"
                    title="Voltar ao sugerido"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Renda alvo */}
      <section className="glass-elevated rounded-xl p-5">
        <p className="label-eyebrow">Meta de renda passiva</p>
        <div className="flex items-end gap-3 mt-3 flex-wrap">
          <label className="text-xs flex-1 min-w-[180px]">
            <span className="text-zinc-400">
              Quanto você quer ganhar POR MÊS sem trabalhar?
            </span>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-zinc-500">R$</span>
              <input
                type="number"
                value={estado.rendaAlvo || ''}
                onChange={(e) =>
                  setEstado({ ...estado, rendaAlvo: Number(e.target.value) || 0 })
                }
                placeholder="3000"
                min={0}
                step={100}
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
              />
              <span className="text-sm text-zinc-500">/mês</span>
            </div>
          </label>
          <p className="text-[11px] text-zinc-500 max-w-md">
            Ex: R$ 5.000/mês cobrindo aluguel, comida, lazer, sem depender
            de trabalho ativo.
          </p>
        </div>
      </section>

      {/* Cenários - cards expansíveis */}
      <CenariosSecao
        linhas={linhas}
        cenarioFoco={cenarioFoco.id}
        onChangeFoco={(id) => setEstado({ ...estado, cenarioFoco: id })}
        totalDepositado={totalDepositado}
      />

      {/* Barra de progresso do cenário focado */}
      <ProgressoSecao
        cenario={cenarioFoco}
        capitalAlvo={capitalAlvoFoco}
        totalDepositado={totalDepositado}
        pct={pctFoco}
        falta={faltaFoco}
        onDepositar={load}
      />

      {/* Histórico de depósitos */}
      <HistoricoDepositos
        depositos={resumo?.depositos_recentes ?? []}
        total={resumo?.total_depositado ?? 0}
        onChange={() => load()}
      />

      {/* Disclaimer */}
      <p className="text-[10px] text-zinc-600 leading-relaxed px-2">
        Cálculos usam juros compostos. Taxas são estimativas líquidas
        (após IR). Não é recomendação de investimento. Os &ldquo;depósitos&rdquo; são
        registros manuais — você me diz quanto investiu do seu bolso e eu
        uso pra calcular a barra de progresso. Não há integração com
        corretora.
      </p>
    </div>
  );
}

function CenariosSecao({
  linhas,
  cenarioFoco,
  onChangeFoco,
  totalDepositado,
}: {
  linhas: LinhaCenario[];
  cenarioFoco: string;
  onChangeFoco: (id: string) => void;
  totalDepositado: number;
}) {
  return (
    <section className="glass-elevated rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
        <p className="label-eyebrow">Cenários</p>
        <p className="text-base font-semibold mt-1">
          Em quanto tempo você chega lá?
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="text-[10px] text-zinc-500 uppercase tracking-wide border-b border-white/[0.06]">
              <th className="text-left py-2 px-3 font-medium">Cenário</th>
              <th className="text-right py-2 px-2 font-medium">a.m.</th>
              <th className="text-right py-2 px-2 font-medium hidden sm:table-cell">
                Capital HOJE
              </th>
              <th className="text-right py-2 px-2 font-medium">Tempo c/ aporte</th>
              <th className="text-right py-2 pl-3 pr-3 font-medium hidden sm:table-cell">
                Já depositado
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const foco = l.cenario.id === cenarioFoco;
              const pct =
                l.capital_necessario > 0
                  ? Math.min(100, (totalDepositado / l.capital_necessario) * 100)
                  : 0;
              return (
                <tr
                  key={l.cenario.id}
                  onClick={() => onChangeFoco(l.cenario.id)}
                  className={`border-b border-white/[0.04] last:border-b-0 cursor-pointer transition-colors ${
                    foco
                      ? 'bg-emerald-500/[0.06]'
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      {foco && <Target className="w-3 h-3 text-emerald-300" />}
                      <p className="font-medium text-zinc-100">{l.cenario.label}</p>
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">
                      {l.cenario.descricao}
                    </p>
                  </td>
                  <td className="text-right py-3 px-2 num-tabular text-zinc-300">
                    {(l.cenario.taxa_mensal * 100).toFixed(1).replace('.', ',')}%
                  </td>
                  <td className="text-right py-3 px-2 num-tabular text-zinc-200 font-semibold hidden sm:table-cell">
                    {formatBRL(Math.round(l.capital_necessario))}
                  </td>
                  <td className="text-right py-3 px-2">
                    {l.meses_ate_atingir != null ? (
                      <span className="inline-flex items-center gap-1 text-zinc-200 num-tabular">
                        <Calendar className="w-3 h-3 text-zinc-500" />
                        {formatarPrazo(l.meses_ate_atingir)}
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-[10px]">sem aporte</span>
                    )}
                  </td>
                  <td className="text-right py-3 pr-3 hidden sm:table-cell">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-500 num-tabular w-9">
                        {Math.round(pct)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-zinc-600 px-5 py-3 border-t border-white/[0.06]">
        Clica num cenário pra ver a barra detalhada abaixo.
      </p>
    </section>
  );
}

function ProgressoSecao({
  cenario,
  capitalAlvo,
  totalDepositado,
  pct,
  falta,
  onDepositar,
}: {
  cenario: { id: string; label: string; descricao: string };
  capitalAlvo: number;
  totalDepositado: number;
  pct: number;
  falta: number;
  onDepositar: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function depositar() {
    const v = Number(valor);
    if (!v || v <= 0) {
      setErro('valor inválido');
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      const r = await fetch('/api/financeiro/renda-passiva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valor: v,
          cenario: cenario.id,
          descricao: descricao.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErro(j.error ?? 'erro ao salvar');
        return;
      }
      setValor('');
      setDescricao('');
      onDepositar();
    } finally {
      setSaving(false);
    }
  }

  const corBarra =
    pct >= 100
      ? 'from-emerald-400 to-emerald-600'
      : pct >= 50
        ? 'from-emerald-400 to-emerald-500'
        : pct >= 20
          ? 'from-amber-400 to-amber-500'
          : 'from-red-400 to-red-500';

  return (
    <section className="glass-elevated rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <PiggyBank className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="label-eyebrow">Progresso do cenário</p>
              <span className="text-[9px] uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                {cenario.label}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-semibold mt-0.5 truncate">
              {pct >= 100
                ? '🎉 Meta atingida! Você já pode viver de renda.'
                : `Faltam ${formatBRL(falta)} pra esse cenário`}
            </h2>
          </div>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/[0.06]">
          {/* Barra */}
          <div className="pt-4">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs text-zinc-400">
                {formatBRL(totalDepositado)} de{' '}
                <span className="num-tabular text-zinc-200 font-semibold">
                  {formatBRL(Math.round(capitalAlvo))}
                </span>
              </p>
              <p className="text-xs num-tabular font-semibold text-zinc-100">
                {Math.round(pct)}%
              </p>
            </div>
            <div className="h-3 rounded-full bg-white/[0.04] overflow-hidden border border-white/[0.06]">
              <div
                className={`h-full bg-gradient-to-r ${corBarra} transition-all duration-500`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-600 mt-2">
              {cenario.descricao}
            </p>
          </div>

          {/* Input de depósito */}
          <div className="border-t border-white/[0.06] pt-4">
            <p className="text-xs text-zinc-400 mb-2">
              Depositei mais no investimento:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-sm text-zinc-500">R$</span>
                <input
                  type="number"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="500"
                  step={50}
                  min={0}
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm num-tabular focus:outline-none focus:border-emerald-400/40"
                  disabled={saving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') depositar();
                  }}
                />
              </div>
              <input
                type="text"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="nota (opcional)"
                className="bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-sm flex-1"
                disabled={saving}
              />
              <button
                type="button"
                onClick={depositar}
                disabled={saving}
                className="px-4 py-1.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 rounded-md text-sm hover:bg-emerald-500/30 disabled:opacity-50 shrink-0 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                {saving ? 'Salvando…' : 'Depositar'}
              </button>
            </div>
            {erro && <p className="text-xs text-red-300 mt-2">{erro}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function HistoricoDepositos({
  depositos,
  total,
  onChange,
}: {
  depositos: Deposito[];
  total: number;
  onChange: () => void;
}) {
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  async function remover(id: string) {
    setRemovendoId(id);
    try {
      const r = await fetch(`/api/financeiro/renda-passiva/${id}`, { method: 'DELETE' });
      if (r.ok) onChange();
    } finally {
      setRemovendoId(null);
    }
  }

  return (
    <section className="glass-elevated rounded-xl p-5">
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-700/40 border border-white/[0.06] flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div>
            <p className="label-eyebrow">Histórico</p>
            <h2 className="text-sm font-semibold mt-0.5">
              Depósitos · total{' '}
              <span className="text-emerald-300 num-tabular">{formatBRL(total)}</span>
            </h2>
          </div>
        </div>
      </header>

      {depositos.length === 0 ? (
        <p className="text-xs text-zinc-500 text-center py-4">
          Sem depósitos ainda. Deposita ali em cima quando investir.
        </p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {depositos.map((d) => {
            const data = new Date(d.occurred_at).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <li
                key={d.id}
                className="flex items-center gap-3 text-xs py-2 px-3 rounded-md bg-white/[0.03] border border-white/[0.04]"
              >
                <PiggyBank className="w-4 h-4 text-emerald-500/70 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-200 num-tabular">
                    + {formatBRL(d.valor)}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {data} · <span className="capitalize">{d.cenario}</span>
                    {d.descricao ? ` · ${d.descricao}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remover(d.id)}
                  disabled={removendoId === d.id}
                  className="shrink-0 text-zinc-500 hover:text-red-300 disabled:opacity-50"
                  title="Remover"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
