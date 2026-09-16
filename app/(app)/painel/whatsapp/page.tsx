'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, MessageCircle, AlertTriangle, Copy, Check, Save, Webhook } from 'lucide-react';

interface Group { id: string; subject: string; size: number }
interface Status { instanceName: string; state: 'open' | 'close' | 'connecting' | 'unknown' }

export default function WhatsAppPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedJid, setSelectedJid] = useState<string>('');
  const [savedJid, setSavedJid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [setupWebhookLoading, setSetupWebhookLoading] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshAll();
  }, []);

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      const s = await fetch('/api/evolution/status').then((r) => r.json()).catch(() => null);
      if (s?.status) {
        setStatus(s.status);
      } else if (s?.error) {
        setError(`Status: ${s.error}`);
      }

      const g = await fetch('/api/evolution/grupos').then((r) => r.json()).catch(() => null);
      if (g?.groups) setGroups(g.groups);
      if (g?.error && !g?.groups) setError((prev) => prev ?? `Grupos: ${g.error}`);

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
          <button onClick={refreshAll} className="btn-ghost text-xs">Atualizar</button>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : status ? (
          <div className="flex items-center gap-3">
            <span
              className={
                status.state === 'open'
                  ? 'badge bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                  : status.state === 'connecting'
                  ? 'badge bg-amber-500/10 text-amber-300 border border-amber-500/30'
                  : 'badge bg-red-500/10 text-red-300 border border-red-500/30'
              }
            >
              {status.state === 'open' ? <><Wifi className="w-3 h-3" /> Conectada</> :
               status.state === 'connecting' ? <><Wifi className="w-3 h-3" /> Conectando…</> :
               <><WifiOff className="w-3 h-3" /> Desconectada</>}
            </span>
            <code className="text-xs text-zinc-500">{status.instanceName}</code>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Indefinido</p>
        )}

        {qrBase64 && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-300">Escaneie este QR no WhatsApp → Aparelhos conectados:</p>
            <img src={qrBase64} alt="QR Code" className="w-64 h-64 mx-auto bg-white p-2 rounded-lg" />
          </div>
        )}

        {status?.state === 'open' && !qrBase64 && (
          <p className="text-sm text-emerald-300">✅ Conectado. Agora escolha abaixo o grupo que será o canal do painel.</p>
        )}
      </div>

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
            Nenhum grupo detectado. Conecte a Evolution primeiro, depois crie/entre no grupo e clique em Atualizar.
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

      {savedJid && (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold">Webhook</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Configure a Evolution para entregar mensagens do seu grupo aqui.
              Clique uma vez — fica gravado na Evolution até você mudar a URL.
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
    </div>
  );
}
