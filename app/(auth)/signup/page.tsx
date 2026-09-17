'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Dispara provisionamento em background (não bloqueia UX).
    // Se falhar, o onboarding detecta `needsProvisioning` e oferece botão.
    fetch('/api/evolution/provisionar', { method: 'POST' }).catch(() => {});

    router.push('/onboarding/whatsapp');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Criar conta</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Você vai criar seu painel pessoal. Depois é só conectar o WhatsApp.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label>Nome</label>
            <input
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full"
              placeholder="Seu nome"
            />
          </div>

          <div>
            <label>Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label>Senha</label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
              placeholder="mínimo 6 caracteres"
            />
          </div>

          {error && (
            <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Criando…' : 'Criar conta'}
          </button>
        </form>

        <div className="text-xs text-zinc-500 text-center">
          Já tem conta?{' '}
          <Link href="/login" className="text-zinc-300 hover:text-emerald-400">
            Entrar
          </Link>
        </div>
      </div>
    </div>
  );
}
