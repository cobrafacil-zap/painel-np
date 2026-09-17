'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wifi, WifiOff, MessageCircle, AlertTriangle, Copy, Check, Save, Webhook, RefreshCw } from 'lucide-react';

interface Group { id: string; subject: string; size: number }
interface Status { instanceName: string; state: 'open' | 'close' | 'connecting' | 'unknown' }
interface StatusResponse {
  needsProvisioning: boolean;
  instanceName: string | null;
  status: Status | null;
  qr: string | null;
  ownerJid: string | null;
}

export default function WhatsAppPage() {
  const router = useRouter();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedJid, setSelectedJid] = useState<string>('');
  const [savedJid, setSavedJid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [setupWebhookLoading, setSetupWebhookLoading] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inicial: carrega status + grupo salvo
  useEffect(() => {
    initialLoad();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inicia polling quando estado não é 'open' e não está provisionando
  useEffect(() => {
    const state = data?.status?.state;
    if (state && state !== 'open' && !provisioning) {
      startPolling();
    } else if (state === 'open') {
      stopPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status?.state, provisioning]);

  async function initialLoad() {
    setLoading(true);
    setError(null);
    try {
      await refreshStatus();
      await refreshGroups();
      const me = await fetch('/api/me/whatsapp-group').then((r) => r.json()).catch(() => null);
      if (me?.whatsapp_group_jid) {
        setSavedJid(me.whatsapp_group_jid);
        setSelectedJid(me.whatsapp_group_jid);
      }
    } catch (e: any) {
      setError(e?.message ?? 'erro');
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus() {
    const r = await fetch('/api/evolution/status').then((r) => r.json()).catch(() => null);
    // IMPORTANTE: mesmo com `error` setado, ainda pode ter payload útil
    // (ex: 404 da Evolution retorna {error, instanceName, status, needsRecreate}).
    // Sempre atualiza data se vier payload, e adiciona error como aviso.
    if (r) {
      setData(r as StatusResponse);
    }
    if (r?.error) {
      setError(r.error);
    }
  }

  async function refreshGroups() {
    const r = await fetch('/api/evolution/grupos').then((r) => r.json()).catch(() => null);
    if (r?.groups) setGroups(r.groups);
  }

  function startPolling() {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(() => {
      refreshStatus();
      if (data?.status?.state === 'open') refreshGroups();
    }, 3000);
  }

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function provisionar() {
    setProvisioning(true);
    setError(null);
    try {
      const r = await fetch('/api/evolution/provisionar', { method: 'POST' }).then((r) => r.json());
      if (!r?.ok) {
        setError(r?.error ?? 'Falha ao provisionar');
        setProvisioning(false);
        return;
      }
      await refreshStatus();
      startPolling();
    } catch (e: any) {
      setError(e?.message ?? 'erro');
    } finally {
      setProvisioning(false);
    }
  }

  async function saveJid() {
    if (!selectedJid) return;
    setSaving(true);
    const res = await fetch('/api/evolution/set-group-jid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_jid: selectedJid }),
    });
    setSaving(false);
    if (res.ok) {
      const j = await res.json();
      setSavedJid(j.whatsapp_group_jid);
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'erro ao salvar');
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function setupWebhook() {
    setSetupWebhookLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/evolution/setup-webhook', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'erro ao configurar');
      setWebhookConfigured(true);
      setError(`✅ Webhook configurado: ${j.webhook}`);
    } catch (e: any) {
      setError(`Webhook: ${e?.message ?? 'erro'}`);
    } finally {
      setSetupWebhookLoading(false);
    }
  }

  async function resetarInstancia() {
    if (!confirm('Isso vai apagar sua instância atual e gerar uma nova. Você vai precisar escanear o QR de novo no WhatsApp. Continuar?')) {
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch('/api/evolution/reset', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'erro ao resetar');
      // Sucesso: manda pro onboarding que vai reprovisionar do zero
      router.push('/onboarding/whatsapp');
    } catch (e: any) {
      setError(`Reset: ${e?.message ?? 'erro'}`);
    } finally {
      setResetting(false);
    }
  }

  async function refreshQR() {
    setRefreshingQR(true);
    setError(null);
    try {
      const r = await fetch('/api/evolution/refresh-qr', { method: 'POST' }).then((r) => r.json());
      if (!r?.ok || !r?.qr) throw new Error(r?.error ?? 'QR não veio');
      setData((prev) => prev ? { ...prev, qr: r.qr } : prev);
    } catch (e: any) {
      setError(`QR: ${e?.message ?? 'erro'}`);
    } finally {
      setRefreshingQR(false);
    }
  }

  const isOpen = data?.status?.state === 'open';
  const showQR = !!data?.qr && !isOpen;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-emerald-400" />
          WhatsApp
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Conecte seu WhatsApp via Evolution API e escolha o grupo dedicado para o painel.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Status da instância</h2>
          <button onClick={initialLoad} className="btn-ghost text-xs inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Atualizar
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : data?.needsProvisioning ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">
              Você ainda não tem uma instância Evolution. Vamos criar uma agora.
            </p>
            <button
              onClick={provisionar}
              disabled={provisioning}
              className="btn-primary inline-flex items-center gap-2"
            >
              {provisioning ? 'Criando…' : 'Criar minha instância Evolution'}
            </button>
          </div>
        ) : data?.status ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span
                className={
                  data.status.state === 'open'
                    ? 'badge bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : data.status.state === 'connecting'
                    ? 'badge bg-amber-500/10 text-amber-300 border border-amber-500/30'
                    : 'badge bg-red-500/10 text-red-300 border border-red-500/30'
                }
              >
                {data.status.state === 'open' ? <><Wifi className="w-3 h-3" /> Conectada</> :
                 data.status.state === 'connecting' ? <><Wifi className="w-3 h-3" /> Conectando…</> :
                 <><WifiOff className="w-3 h-3" /> Desconectada</>}
              </span>
              <code className="text-xs text-zinc-500">{data.instanceName}</code>
            </div>

            {data.ownerJid && isOpen && (
              <p className="text-xs text-zinc-500">
                Número conectado: <code className="text-emerald-300">{data.ownerJid}</code>
              </p>
            )}

            {showQR && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-300">
                  Escaneie este QR no WhatsApp → Configurações → Aparelhos conectados:
                </p>
                <img
                  src={data.qr!}
                  alt="QR Code"
                  className="w-64 h-64 mx-auto bg-white p-2 rounded-lg"
                />
                <p className="text-xs text-zinc-500 text-center">
                  Atualizando a cada 3 segundos…
                </p>
                <button
                  onClick={refreshQR}
                  disabled={refreshingQR}
                  className="btn-ghost text-xs inline-flex items-center gap-1 mx-auto"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingQR ? 'animate-spin' : ''}`} />
                  {refreshingQR ? 'Atualizando…' : 'Atualizar QR agora'}
                </button>
              </div>
            )}

            {!showQR && !isOpen && (
              <p className="text-sm text-zinc-500">
                Aguardando QR Code… (a página atualiza automaticamente)
              </p>
            )}

            {isOpen && (
              <p className="text-sm text-emerald-300">
                ✅ Conectado. Agora escolha abaixo o grupo que será o canal do painel.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Indefinido</p>
        )}
      </div>

      {isOpen && (
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold">Grupo dedicado</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Crie um grupo no WhatsApp (ex: &quot;💰 Painel NP&quot;) com só você, e selecione abaixo.
              O painel só responde a mensagens deste grupo.
            </p>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nenhum grupo detectado. Crie/entre no grupo no WhatsApp e clique em Atualizar.
            </p>
          ) : (
            <>
              <div>
                <label>Selecione o grupo</label>
                <select
                  value={selectedJid}
                  onChange={(e) => setSelectedJid(e.target.value)}
                  className="w-full"
                >
                  <option value="">— escolha um grupo —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.subject} ({g.size} membros)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={saveJid}
                  disabled={!selectedJid || saving}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>

                {savedJid && (
                  <button
                    onClick={() => copy(savedJid)}
                    className="btn-ghost inline-flex items-center gap-2"
                    title="Copiar JID"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copiado' : 'Copiar JID'}
                  </button>
                )}
              </div>

              {savedJid && (
                <p className="text-xs text-zinc-500">
                  JID salvo: <code className="text-emerald-300">{savedJid}</code>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {savedJid && isOpen && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold">Webhook</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Se o painel parou de responder, reconfigure a Evolution pra entregar mensagens aqui.
              Normalmente já vem configurado desde o provisionamento.
            </p>
          </div>
          <button
            onClick={setupWebhook}
            disabled={setupWebhookLoading || webhookConfigured}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Webhook className="w-4 h-4" />
            {webhookConfigured ? '✅ Webhook configurado' : setupWebhookLoading ? 'Configurando…' : 'Configurar webhook agora'}
          </button>
        </div>
      )}

      {data?.instanceName && (
        <div className="card space-y-3 border border-red-500/20">
          <div>
            <h2 className="font-semibold text-red-300">⚠️ Em caso de problema</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Se sua instância não conecta, deu 404, ou ficou travada em &quot;connecting&quot;,
              resete e crie uma nova. Você vai precisar escanear o QR de novo.
            </p>
          </div>
          <button
            onClick={resetarInstancia}
            disabled={resetting}
            className="btn-ghost text-red-300 hover:text-red-200 inline-flex items-center gap-2"
          >
            {resetting ? 'Resetando…' : '🔄 Resetar e gerar nova instância'}
          </button>
        </div>
      )}
    </div>
  );
}
