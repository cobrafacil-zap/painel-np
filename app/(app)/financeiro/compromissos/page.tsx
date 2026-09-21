'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, AlertTriangle, Calendar, X, Pencil, ChevronLeft, ChevronRight, CircleDot } from 'lucide-react';
import { formatBRL, formatDateBR } from '@/lib/utils';

type Parcela = {
  id: string;
  compromisso_id: string;
  numero: number;
  valor: number;
  data_vencimento: string;
  pago: boolean;
  pago_em: string | null;
};

type Compromisso = {
  id: string;
  tipo: 'pagar' | 'receber';
  descricao: string;
  valor_total: number;
  valor_pago: number;
  data_vencimento: string | null;
  pago: boolean;
  pago_em: string | null;
  total_parcelas: number;
  parcela_atual: number;
  recorrencia: string;
  created_at: string;
  parcelas?: Parcela[];
};

/** Helpers de mês no formato YYYY-MM (evita timezone issues usando strings) */
const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MESES_PT_ABREV = MESES_PT.map((m) => m.slice(0, 3) + '.');

function hojeYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMes(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const data = new Date(y, m - 1 + delta, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function formatMes(yyyymm: string, abrev: boolean): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return `${abrev ? MESES_PT_ABREV[m - 1] : MESES_PT[m - 1]} ${y}`;
}

/** Devolve true se a data ISO (YYYY-MM-DD) cai no mês YYYY-MM */
function dataEstaNoMes(dataIso: string, yyyymm: string): boolean {
  return dataIso.startsWith(yyyymm);
}

export default function CompromissosPage() {
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Compromisso | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'pagar' | 'receber'>('todos');
  const [mesRef, setMesRef] = useState<string>(hojeYYYYMM());
  const [mostrarTodos, setMostrarTodos] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/financeiro/compromissos')
      .then((r) => r.json())
      .then(({ compromissos }) => {
        setCompromissos((compromissos ?? []) as Compromisso[]);
        setLoading(false);
      });
  }, [refreshKey]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function pagarParcela(parcelaId: string) {
    const res = await fetch(`/api/financeiro/compromissos/${parcelaId}/pagar`, { method: 'POST' });
    if (res.ok) {
      flash('✅ Parcela marcada como paga.');
      setRefreshKey((k) => k + 1);
    } else flash('⚠️ Erro ao marcar como paga.');
  }

  async function deletar(id: string) {
    if (!confirm('Apagar este compromisso e todas as parcelas?')) return;
    const res = await fetch(`/api/financeiro/compromissos/${id}`, { method: 'DELETE' });
    if (res.ok) {
      flash('🗑️ Compromisso apagado.');
      setRefreshKey((k) => k + 1);
    } else flash('⚠️ Erro ao apagar.');
  }

  const filtrados = useMemo(() => {
    let lista = compromissos;
    // 1. Filtro por mês (só se NÃO for "todos")
    if (!mostrarTodos) {
      lista = lista.filter((c) => {
        // Compromisso avulso: tem data_vencimento no mês
        if (!c.parcelas || c.parcelas.length === 0) {
          return c.data_vencimento ? dataEstaNoMes(c.data_vencimento, mesRef) : false;
        }
        // Compromisso parcelado: aparece se ALGUMA parcela cai no mês
        return c.parcelas.some((p) => dataEstaNoMes(p.data_vencimento, mesRef));
      });
    }
    // 2. Filtro por tipo (pagar/receber/todos)
    if (filtro !== 'todos') {
      lista = lista.filter((c) => c.tipo === filtro);
    }
    return lista;
  }, [compromissos, filtro, mesRef, mostrarTodos]);

  const totalPagar = useMemo(() => {
    let soma = 0;
    for (const c of compromissos) {
      if (c.tipo !== 'pagar' || c.pago) continue;
      if (mostrarTodos) {
        // soma o saldo devedor inteiro
        soma += Number(c.valor_total) - Number(c.valor_pago);
      } else {
        // soma só parcelas que vencem no mês selecionado (ou avulso com data no mês)
        if (!c.parcelas || c.parcelas.length === 0) {
          if (c.data_vencimento && dataEstaNoMes(c.data_vencimento, mesRef)) {
            soma += Number(c.valor_total) - Number(c.valor_pago);
          }
        } else {
          for (const p of c.parcelas) {
            if (!p.pago && dataEstaNoMes(p.data_vencimento, mesRef)) {
              soma += Number(p.valor);
            }
          }
        }
      }
    }
    return soma;
  }, [compromissos, mesRef, mostrarTodos]);

  const totalReceber = useMemo(() => {
    let soma = 0;
    for (const c of compromissos) {
      if (c.tipo !== 'receber' || c.pago) continue;
      if (mostrarTodos) {
        soma += Number(c.valor_total) - Number(c.valor_pago);
      } else {
        if (!c.parcelas || c.parcelas.length === 0) {
          if (c.data_vencimento && dataEstaNoMes(c.data_vencimento, mesRef)) {
            soma += Number(c.valor_total) - Number(c.valor_pago);
          }
        } else {
          for (const p of c.parcelas) {
            if (!p.pago && dataEstaNoMes(p.data_vencimento, mesRef)) {
              soma += Number(p.valor);
            }
          }
        }
      }
    }
    return soma;
  }, [compromissos, mesRef, mostrarTodos]);

  const ehMesAtual = mesRef === hojeYYYYMM();

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Compromissos</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Dívidas, empréstimos, contas parceladas. Manda no WhatsApp tipo &ldquo;peguei 800 com minha mãe, 4x de 200&rdquo;.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Novo compromisso
        </button>
      </header>

      {/* Seletor de mês */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center bg-bg-elevated rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => { setMesRef((m) => shiftMes(m, -1)); setMostrarTodos(false); }}
            className="p-2 hover:bg-bg-card text-zinc-400 hover:text-zinc-200"
            title="Mês anterior"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-3 py-1.5 min-w-[140px] text-center text-sm font-medium tabular-nums">
            {mostrarTodos ? 'Todos os meses' : formatMes(mesRef, !ehMesAtual)}
            {!mostrarTodos && ehMesAtual && (
              <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
                <CircleDot className="w-3 h-3" /> hoje
              </span>
            )}
          </div>
          <button
            onClick={() => { setMesRef((m) => shiftMes(m, 1)); setMostrarTodos(false); }}
            className="p-2 hover:bg-bg-card text-zinc-400 hover:text-zinc-200"
            title="Mês seguinte"
            aria-label="Mês seguinte"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {!ehMesAtual && (
          <button
            onClick={() => { setMesRef(hojeYYYYMM()); setMostrarTodos(false); }}
            className="px-3 py-1.5 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
          >
            Hoje
          </button>
        )}

        <button
          onClick={() => setMostrarTodos((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs ${
            mostrarTodos
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-bg-elevated text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {mostrarTodos ? 'Todos ✓' : 'Todos os meses'}
        </button>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label={`💸 A pagar${mostrarTodos ? '' : ` — ${formatMes(mesRef, true)}`}`}
          value={totalPagar}
          color="red"
        />
        <SummaryCard
          label={`💰 A receber${mostrarTodos ? '' : ` — ${formatMes(mesRef, true)}`}`}
          value={totalReceber}
          color="emerald"
        />
        <SummaryCard
          label="📊 Saldo"
          value={totalReceber - totalPagar}
          color={totalReceber - totalPagar >= 0 ? 'emerald' : 'red'}
        />
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {(['todos', 'pagar', 'receber'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-lg text-xs capitalize ${
              filtro === f
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-bg-elevated text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-3 relative">
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : filtrados.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-zinc-400">
              Nenhum compromisso{' '}
              {filtro !== 'todos' && `do tipo "${filtro}"`}
              {!mostrarTodos && filtro === 'todos' && ` em ${formatMes(mesRef, false)}`}
              {!mostrarTodos && filtro !== 'todos' && ` em ${formatMes(mesRef, false)}`}
              .
            </p>
            <p className="text-xs text-zinc-500 mt-2">Manda no WhatsApp ou clica em &ldquo;Novo compromisso&rdquo;.</p>
          </div>
        ) : (
          filtrados.map((c) => (
            <CompromissoCard
              key={c.id}
              c={c}
              onPagarParcela={pagarParcela}
              onDelete={() => deletar(c.id)}
              onEdit={() => setEditing(c)}
              mesRef={mesRef}
              mostrarTodos={mostrarTodos}
            />
          ))
        )}

        {toast && (
          <div className="fixed bottom-6 right-6 bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm shadow-lg z-50">
            {toast}
          </div>
        )}
      </div>

      {showNew && (
        <CompromissoModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            flash('✅ Compromisso criado.');
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editing && (
        <CompromissoModal
          compromisso={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            flash('✅ Atualizado.');
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: 'red' | 'emerald' }) {
  const cor = color === 'red' ? 'text-red-300' : 'text-emerald-300';
  return (
    <div className="card">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${cor}`}>{formatBRL(value)}</p>
    </div>
  );
}

function CompromissoCard({
  c,
  onPagarParcela,
  onDelete,
  onEdit,
  mesRef,
  mostrarTodos,
}: {
  c: Compromisso;
  onPagarParcela: (id: string) => void;
  onDelete: () => void;
  onEdit: () => void;
  mesRef: string;
  mostrarTodos: boolean;
}) {
  const restante = Number(c.valor_total) - Number(c.valor_pago);
  const isPagar = c.tipo === 'pagar';
  const cor = isPagar ? 'text-red-300' : 'text-emerald-300';
  const isParcelado = c.total_parcelas > 1;

  // Quando filtrando por mês, mostra só as parcelas do mês
  const parcelasVisiveis = c.parcelas?.filter((p) =>
    mostrarTodos ? true : dataEstaNoMes(p.data_vencimento, mesRef)
  ) ?? [];

  return (
    <div className={`card ${c.pago ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-lg ${cor}`}>
              {isPagar ? '🔴' : '🟢'}
            </span>
            <h3 className={`font-medium ${c.pago ? 'line-through' : ''}`}>
              {c.descricao}
            </h3>
            {c.pago && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> quitado
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            <span>
              {isPagar ? 'A pagar' : 'A receber'}:{' '}
              <span className={`tabular-nums ${cor} font-medium`}>
                {formatBRL(restante)}
              </span>
              {Number(c.valor_pago) > 0 && (
                <span className="ml-1">
                  de {formatBRL(Number(c.valor_total))}
                </span>
              )}
            </span>
            {isParcelado && (
              <span>
                • {c.parcela_atual - 1}/{c.total_parcelas} pagas
                {!mostrarTodos && parcelasVisiveis.length > 0 && (
                  <span className="ml-1 text-zinc-600">
                    ({parcelasVisiveis.length} no mês)
                  </span>
                )}
              </span>
            )}
            {c.data_vencimento && !isParcelado && (
              <span>• vence {formatDateBR(c.data_vencimento)}</span>
            )}
          </div>
        </div>

        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-bg-elevated text-zinc-400 hover:text-zinc-200"
            title="Editar"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-300"
            title="Apagar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lista de parcelas (se parcelado) — mostra só as do mês visível */}
      {isParcelado && parcelasVisiveis.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {parcelasVisiveis.map((p) => (
            <ParcelaRow key={p.id} p={p} totalParcelas={c.total_parcelas} onPagar={() => onPagarParcela(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ParcelaRow({ p, totalParcelas, onPagar }: { p: Parcela; totalParcelas: number; onPagar: () => void }) {
  const dias = diasAte(p.data_vencimento);
  const vencida = dias < 0 && !p.pago;
  const hoje = dias === 0 && !p.pago;

  return (
    <div
      className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${
        p.pago ? 'bg-emerald-500/5 line-through text-zinc-500' :
        vencida ? 'bg-red-500/10' :
        hoje ? 'bg-amber-500/10' : 'bg-bg-elevated/40'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 tabular-nums w-12">
          {p.numero}/{totalParcelas}
        </span>
        <span className="tabular-nums">{formatBRL(Number(p.valor))}</span>
        <span className="text-xs text-zinc-400 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {formatDateBR(p.data_vencimento)}
          {vencida && (
            <span className="text-red-300 ml-1">
              <AlertTriangle className="w-3 h-3 inline" /> {Math.abs(dias)}d atrasada
            </span>
          )}
          {hoje && <span className="text-amber-300 ml-1">HOJE</span>}
        </span>
      </div>
      {!p.pago && (
        <button
          onClick={onPagar}
          className="text-xs px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
        >
          Pagar
        </button>
      )}
      {p.pago && p.pago_em && (
        <span className="text-xs text-emerald-400">✓ {formatDateBR(p.pago_em.slice(0, 10))}</span>
      )}
    </div>
  );
}

function diasAte(dataIso: string): number {
  const alvo = new Date(dataIso + 'T00:00:00');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function CompromissoModal({
  compromisso,
  onClose,
  onSaved,
}: {
  compromisso?: Compromisso;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState<'pagar' | 'receber'>(compromisso?.tipo ?? 'pagar');
  const [descricao, setDescricao] = useState(compromisso?.descricao ?? '');
  const [valorTotal, setValorTotal] = useState(compromisso ? String(compromisso.valor_total) : '');
  const [totalParcelas, setTotalParcelas] = useState(compromisso?.total_parcelas || 1);
  const [recorrencia, setRecorrencia] = useState(compromisso?.recorrencia ?? 'mensal');
  const [dataVenc, setDataVenc] = useState(compromisso?.data_vencimento ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    const v = parseFloat(valorTotal.replace(',', '.'));
    if (!descricao.trim() || !v || v <= 0) {
      setSaveError('Preencha descrição e valor maior que zero.');
      return;
    }
    setSaveError(null);
    setSaving(true);
    const payload = {
      tipo,
      descricao: descricao.trim(),
      valor_total: v,
      total_parcelas: totalParcelas,
      recorrencia,
      data_vencimento: dataVenc || null,
    };
    const url = compromisso ? `/api/financeiro/compromissos/${compromisso.id}` : '/api/financeiro/compromissos';
    const method = compromisso ? 'PATCH' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg =
          errBody.reply ?? errBody.error ?? errBody.message ?? `Erro ${res.status} ao salvar.`;
        setSaveError(typeof msg === 'string' ? msg : JSON.stringify(msg));
        setSaving(false);
        return;
      }
      onSaved();
    } catch (e: any) {
      setSaveError(`Erro de rede: ${e?.message ?? 'desconhecido'}`);
    } finally {
      setSaving(false);
    }
  }

  const valorParcela = valorTotal && totalParcelas > 1 ? parseFloat(valorTotal) / totalParcelas : 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div className="card max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">
          {compromisso ? 'Editar compromisso' : 'Novo compromisso'}
        </h3>

        <div className="flex gap-2">
          <button
            onClick={() => setTipo('pagar')}
            className={`flex-1 py-2 rounded-lg text-sm ${
              tipo === 'pagar' ? 'bg-red-500/20 text-red-300' : 'bg-bg-elevated text-zinc-400'
            }`}
          >
            💸 Eu devo
          </button>
          <button
            onClick={() => setTipo('receber')}
            className={`flex-1 py-2 rounded-lg text-sm ${
              tipo === 'receber' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-bg-elevated text-zinc-400'
            }`}
          >
            💰 Me devem
          </button>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Descrição</label>
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex: Empréstimo da mãe"
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Valor total (R$)</label>
          <input
            type="number"
            step="0.01"
            value={valorTotal}
            onChange={(e) => setValorTotal(e.target.value)}
            placeholder="800.00"
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm tabular-nums"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Parcelas</label>
            <input
              type="number"
              min="1"
              max="48"
              value={totalParcelas}
              onChange={(e) => setTotalParcelas(Math.max(1, parseInt(e.target.value || '1', 10)))}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Recorrência</label>
            <select
              value={recorrencia}
              onChange={(e) => setRecorrencia(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
            >
              <option value="unica">única</option>
              <option value="semanal">semanal</option>
              <option value="mensal">mensal</option>
              <option value="anual">anual</option>
            </select>
          </div>
        </div>

        {totalParcelas > 1 && valorTotal && (
          <p className="text-xs text-zinc-400">
            = {totalParcelas}x de <span className="text-zinc-200 tabular-nums">{formatBRL(valorParcela)}</span>
          </p>
        )}

        {saveError && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
            ❌ {saveError}
          </div>
        )}

        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Vencimento 1ª parcela (opcional)
          </label>
          <input
            type="date"
            value={dataVenc}
            onChange={(e) => setDataVenc(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-bg-elevated">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : compromisso ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}
