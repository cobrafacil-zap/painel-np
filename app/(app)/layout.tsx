import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser, createClient } from '@/lib/supabase/server';
import { LogoutButton } from './_components/logout-button';
import { Wallet, LayoutDashboard, MessageCircle, Tags, ListChecks, ScrollText, ListTodo } from 'lucide-react';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, email } = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, evolution_instance_name, evolution_status')
    .eq('id', userId)
    .single();

  // Onboarding: usuário sem instância Evolution vai pra /onboarding/whatsapp.
  // Mas não redireciona se já está lá (evita loop).
  const hdrs = await headers();
  const pathname = hdrs.get('x-invoke-path') ?? hdrs.get('next-url') ?? hdrs.get('x-pathname') ?? '';
  const isOnOnboarding = pathname.includes('/onboarding');

  if (!profile?.evolution_instance_name && !isOnOnboarding) {
    redirect('/onboarding/whatsapp');
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-border bg-bg-soft p-4 flex flex-col gap-1">
        <div className="mb-6">
          <h1 className="font-semibold">Painel NP</h1>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">
            {profile?.full_name || email}
          </p>
          {profile?.evolution_instance_name && (
            <p className="text-[10px] text-zinc-600 mt-0.5 truncate" title={profile.evolution_instance_name}>
              📱 {profile.evolution_instance_name}
            </p>
          )}
        </div>

        <NavLink href="/painel" icon={<LayoutDashboard className="w-4 h-4" />}>
          Visão geral
        </NavLink>

        <NavLink href="/financeiro" icon={<Wallet className="w-4 h-4" />}>
          Financeiro
        </NavLink>
        <NavSubLink href="/financeiro/lancamentos" icon={<ListChecks className="w-3.5 h-3.5" />}>
          Lançamentos
        </NavSubLink>
        <NavSubLink href="/financeiro/compromissos" icon={<ScrollText className="w-3.5 h-3.5" />}>
          Compromissos
        </NavSubLink>
        <NavSubLink href="/financeiro/categorias" icon={<Tags className="w-3.5 h-3.5" />}>
          Categorias
        </NavSubLink>

        <NavLink href="/tarefas" icon={<ListTodo className="w-4 h-4" />}>
          Tarefas
        </NavLink>

        <NavLink href="/painel/whatsapp" icon={<MessageCircle className="w-4 h-4" />}>
          WhatsApp
        </NavLink>

        <div className="mt-auto pt-4 border-t border-border">
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 md:p-8 min-w-0">{children}</main>
    </div>
  );
}

function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-zinc-300 hover:bg-bg-elevated hover:text-white"
    >
      {icon}
      {children}
    </Link>
  );
}

function NavSubLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-md text-xs text-zinc-400 hover:bg-bg-elevated hover:text-zinc-200"
    >
      {icon}
      {children}
    </Link>
  );
}
