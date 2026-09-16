import Link from 'next/link';
import { requireUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './_components/logout-button';
import { Wallet, LayoutDashboard, MessageCircle } from 'lucide-react';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, email } = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single();

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-border bg-bg-soft p-4 flex flex-col gap-1">
        <div className="mb-6">
          <h1 className="font-semibold">Painel NP</h1>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">
            {profile?.full_name || email}
          </p>
        </div>

        <NavLink href="/painel" icon={<LayoutDashboard className="w-4 h-4" />}>
          Visão geral
        </NavLink>
        <NavLink href="/financeiro" icon={<Wallet className="w-4 h-4" />}>
          Financeiro
        </NavLink>
        <NavLink href="/painel/whatsapp" icon={<MessageCircle className="w-4 h-4" />}>
          WhatsApp
        </NavLink>

        <div className="mt-auto pt-4 border-t border-border">
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 p-6">{children}</main>
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
