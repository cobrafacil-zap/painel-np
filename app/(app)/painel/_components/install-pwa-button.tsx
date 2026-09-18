'use client';

import { useEffect, useState } from 'react';
import { Smartphone, X, Share, Plus, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

type Platform = 'ios' | 'android' | 'desktop' | null;

function detectarPlataforma(): Platform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function jaInstalado(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari
  if ((navigator as any).standalone === true) return true;
  // Android Chrome / desktop
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return false;
}

const STORAGE_KEY = 'pwa-install-dismissed-at';
const STORAGE_VALOR_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias

export function InstallPWAButton() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [instalado, setInstalado] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [androidEvent, setAndroidEvent] = useState<any>(null);
  const [showAndroidModal, setShowAndroidModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPlatform(detectarPlataforma());
    setInstalado(jaInstalado());

    // Captura beforeinstallprompt (Android/Chrome)
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setAndroidEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // Detecta app instalado depois
    const onInstalled = () => {
      setInstalado(true);
      setAndroidEvent(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Não mostra se instalado, em desktop, ou se usuário dispensou há < 14d
  if (!mounted || instalado) return null;
  if (platform === 'desktop') return null;

  const dismissed = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (dismissed && Date.now() - Number(dismissed) < STORAGE_VALOR_MS) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {}
    setShowIOSModal(false);
    setShowAndroidModal(false);
  };

  const onClick = async () => {
    if (platform === 'ios') {
      setShowIOSModal(true);
      return;
    }
    if (platform === 'android' && androidEvent) {
      try {
        androidEvent.prompt();
        const { outcome } = await androidEvent.userChoice;
        if (outcome === 'accepted') {
          setInstalado(true);
        } else {
          dismiss();
        }
      } catch {
        // caiu em erro, abre instruções
        setShowAndroidModal(true);
      }
    } else if (platform === 'android') {
      setShowAndroidModal(true);
    }
  };

  return (
    <>
      <button
        onClick={onClick}
        className="group inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/10 hover:border-emerald-500/50 text-emerald-300 text-sm transition-all"
      >
        <Smartphone className="w-4 h-4" />
        Instalar app
      </button>

      {/* iOS — instruções visuais */}
      <Modal open={showIOSModal} onClose={() => setShowIOSModal(false)} title="Adicionar à tela inicial">
        <div className="space-y-4 text-sm text-zinc-300">
          <p className="text-zinc-400">
            Pra ter o Painel NP sempre à mão no seu iPhone:
          </p>
          <ol className="space-y-3">
            <li className="flex gap-3 items-start">
              <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center text-xs font-bold">
                1
              </span>
              <div>
                <p className="text-zinc-200 font-medium">
                  Toque no botão de compartilhar
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 inline-flex items-center gap-1">
                  <Share className="w-3 h-3" /> na barra inferior do Safari
                </p>
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center text-xs font-bold">
                2
              </span>
              <div>
                <p className="text-zinc-200 font-medium">
                  Role e toque em &ldquo;Adicionar à Tela de Início&rdquo;
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> ícone com o sinal de +
                </p>
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <span className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center text-xs font-bold">
                3
              </span>
              <div>
                <p className="text-zinc-200 font-medium">Toque em &ldquo;Adicionar&rdquo;</p>
                <p className="text-xs text-zinc-500 mt-0.5">Pronto. Vai aparecer na sua tela inicial.</p>
              </div>
            </li>
          </ol>
          <button
            onClick={dismiss}
            className="w-full mt-2 px-4 py-2.5 rounded-lg bg-bg-elevated hover:bg-white/[0.06] text-zinc-300 text-sm transition-colors"
          >
            Já instalei / Agora não
          </button>
        </div>
      </Modal>

      {/* Android — fallback de instruções (sem beforeinstallprompt capturado) */}
      <Modal open={showAndroidModal} onClose={() => setShowAndroidModal(false)} title="Instalar app">
        <div className="space-y-3 text-sm text-zinc-300">
          <p className="text-zinc-400">
            No Chrome do Android, abra o menu{' '}
            <span className="text-zinc-200 font-medium">⋮</span> no canto superior
            direito e escolha &ldquo;Instalar app&rdquo; ou &ldquo;Adicionar à tela inicial&rdquo;.
          </p>
          <button
            onClick={dismiss}
            className="w-full mt-2 px-4 py-2.5 rounded-lg bg-bg-elevated hover:bg-white/[0.06] text-zinc-300 text-sm transition-colors"
          >
            Já instalei / Agora não
          </button>
        </div>
      </Modal>
    </>
  );
}
