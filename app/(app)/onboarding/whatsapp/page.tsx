'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Wifi, WifiOff, AlertTriangle, RefreshCw } from 'lucide-react';

interface Status { instanceName: string; state: 'open' | 'close' | 'connecting' | 'unknown' }
interface StatusResponse {
  needsProvisioning: boolean;
  instanceName: string | null;
  status: Status | null;
  qr: string | null;
  ownerJid: string | null;
}

export default function OnboardingWhatsAppPage() {
  const router = useRouter();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [refreshingQR, setRefreshingQR] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bootstrap();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inicia polling quando há instance mas não está open
  useEffect(() => {
    if (data?.instanceName && data?.status?.state !== 'open' && !provisioning) {
      startPolling();
    } else if (data?.status?.state === 'open') {
      stopPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status?.state, data?.instanceName, provisioning]);

  async function bootstrap() {
    setLoading(true);
    try {
      const r = await fetch('/api/evolution/status').then((r) => r.json()).catch(() => null);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setData(r as StatusResponse);

      // Se precisa provisionar, faz automaticamente
      if (r?.needsProvisioning) {
        await provisionar();
      }
    } catch (e: any) {
      setError(e?.message ?? 'erro');
    } finally {
      setLoading(false);
    }
  }

  async function provisionar() {
    setProvisioning(true);
    setError(null);
    try {
      const r = await fetch('/api/evolution/provisionar', { method: 'POST' }).then((r) => r.json());
      if (!r?.ok) {
        setError(r?.error ?? 'Falha ao provisionar');
        return;
      }
      await refreshStatus();
      startPolling();
    } catch (e: any) {
      setError(`Provisionar: ${e?.message ?? 'erro'}`);
    } finally {
      setProvisioning(false);
    }
  }

  async function refreshStatus() {
    const r = await fetch('/api/evolution/status').then((r) => r.json()).catch(() => null);
    if (r) setData(r as StatusResponse);
  }

  async function refreshQR() {
    setRefreshingQR(true);
    setError(null);
    try {
      const r = await fetch('/api/evolution/refresh-qr', { method: 'POST' }).then((r) => r.json());
      if (!r?.ok || !r?.qr) throw new Error(r?.error ?? 'QR não veio');
      // Atualiza só o campo qr sem esperar o polling
      setData((prev) => prev ? { ...prev, qr: r.qr } : prev);
    } catch (e: any) {
      setError(`QR: ${e?.message ?? 'erro'}`);
    } finally {
      setRefreshingQR(false);
    }
  }

  function startPolling() {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(refreshStatus, 3000);
  }

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  // Quando conecta, redireciona pro painel após 2s
  useEffect(() => {
    if (data?.status?.state === 'open') {
      const t = setTimeout(() => {
        router.push('/painel/whatsapp');
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [data?.status?.state, router]);

  const isOpen = data?.status?.state === 'open';
  const showQR = !!data?.qr && !isOpen;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-5">
        <div className="text-center space-y-2">
          <MessageCircle className="w-10 h-10 text-emerald-400 mx-auto" />
          <h1 className="text-xl font-semibold">Conecte seu WhatsApp</h1>
          <p className="text-xs text-zinc-500">
            Vamos criar sua instância pessoal e mostrar o QR Code.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>{error}</p>
              <button
                onClick={bootstrap}
                className="text-xs underline mt-1"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8">
            <p className="text-sm text-zinc-400">Verificando…</p>
          </div>
        ) : provisioning ? (
          <div className="text-center py-8 space-y-2">
            <RefreshCw className="w-8 h-8 mx-auto text-emerald-400 animate-spin" />
            <p className="text-sm text-zinc-300">Criando sua instância Evolution…</p>
            <p className="text-xs text-zinc-500">Isso leva alguns segundos.</p>
          </div>
        ) : isOpen ? (
          <div className="text-center py-8 space-y-2">
            <Wifi className="w-10 h-10 mx-auto text-emerald-400" />
            <p className="text-sm text-emerald-300 font-medium">✅ Conectado!</p>
            <p className="text-xs text-zinc-500">Redirecionando pro painel…</p>
          </div>
        ) : data?.instanceName ? (
          <div className="space-y-4 text-center">
            {showQR ? (
              <>
                <p className="text-sm text-zinc-300">
                  Abra o WhatsApp no celular, vá em{' '}
                  <strong>Configurações → Aparelhos conectados → Conectar um aparelho</strong>{' '}
                  e escaneie o QR abaixo.
                </p>
                <img
                  src={data.qr!}
                  alt="QR Code"
                  className="w-64 h-64 mx-auto bg-white p-2 rounded-lg"
                />
                <p className="text-xs text-zinc-500">
                  QR atualiza a cada 3 segundos automaticamente.
                </p>
                <button
                  onClick={refreshQR}
                  disabled={refreshingQR}
                  className="btn-ghost text-xs inline-flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingQR ? 'animate-spin' : ''}`} />
                  {refreshingQR ? 'Atualizando…' : 'Atualizar QR agora'}
                </button>
                <p className="text-xs text-zinc-600">
                  Instância: <code>{data.instanceName}</code>
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <WifiOff className="w-8 h-8 mx-auto text-zinc-500" />
                <p className="text-sm text-zinc-400">Aguardando QR Code…</p>
                <p className="text-xs text-zinc-500">
                  Pode levar alguns segundos pra Evolution gerar.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center space-y-3">
            <p className="text-sm text-zinc-400">
              Vamos começar criando sua instância pessoal.
            </p>
            <button
              onClick={provisionar}
              className="btn-primary inline-flex items-center gap-2"
            >
              Criar minha instância
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
