'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Wallet,
  LayoutDashboard,
  MessageCircle,
  ListTodo,
  X,
  Heart,
} from 'lucide-react';
import { LogoutButton } from '../_components/logout-button';
import { cn } from '@/lib/utils';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  profile: {
    full_name: string | null;
    email: string | null;
    evolution_instance_name: string | null;
  };
}

const NAV = [
  { href: '/painel', label: 'Visão geral', icon: LayoutDashboard },
];

const TAREFAS = [{ href: '/tarefas', label: 'Tarefas', icon: ListTodo }];
const WHATSAPP = [{ href: '/painel/whatsapp', label: 'WhatsApp', icon: MessageCircle }];

export function Sidebar({ open, onClose, profile }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Backdrop mobile */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden="true"
      />

      {/* Sidebar — drawer no mobile, fixa no desktop */}
      <aside
        className={cn(
          'fixed md:static inset-y-0 left-0 z-50 md:z-auto',
          'w-72 md:w-60 shrink-0',
          'bg-bg-soft md:bg-bg-soft',
          'border-r border-border p-4 flex flex-col gap-1',
          'transition-transform duration-200 ease-out',
          // Mobile: quando fechada, esconde totalmente (visibility + opacity)
          // pra iOS Safari não tentar scroll horizontal no "vazio" à esquerda.
          // Desktop: sempre visível (`md:visible md:opacity-100`).
          open
            ? 'translate-x-0 visible opacity-100'
            : '-translate-x-full md:translate-x-0 invisible opacity-0 md:visible md:opacity-100',
          'md:translate-x-0'
        )}
        aria-hidden={!open}
      >
        {/* Header (com botão X no mobile) */}
        <div className="mb-6 flex items-start justify-between">
          <div className="min-w-0">
            <h1 className="font-semibold tracking-tight">Painel NP</h1>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {profile.full_name || profile.email}
            </p>
            {profile.evolution_instance_name && (
              <p
                className="text-[10px] text-zinc-600 mt-0.5 truncate"
                title={profile.evolution_instance_name}
              >
                📱 {profile.evolution_instance_name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="md:hidden shrink-0 p-1.5 rounded-md hover:bg-white/[0.06] text-zinc-400"
            aria-label="Fechar menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visão geral */}
        <SidebarLink
          href="/painel"
          icon={<LayoutDashboard className="w-4 h-4" />}
          active={pathname === '/painel'}
          onClick={onClose}
        >
          Visão geral
        </SidebarLink>

        {/* Financeiro — sem sub-itens no menu. Quando user tá em
            /financeiro/* (lancamentos, compromissos, categorias), o link
            também fica ativo. A navegação interna é feita via atalhos
            dentro da própria landing. */}
        <SidebarLink
          href="/financeiro"
          icon={<Wallet className="w-4 h-4" />}
          active={pathname.startsWith('/financeiro')}
          onClick={onClose}
        >
          Financeiro
        </SidebarLink>

        {/* Tarefas */}
        <SidebarLink
          href="/tarefas"
          icon={<ListTodo className="w-4 h-4" />}
          active={pathname.startsWith('/tarefas')}
          onClick={onClose}
        >
          Tarefas
        </SidebarLink>

        {/* Cuidados pessoais */}
        <SidebarLink
          href="/cuidados-pessoais"
          icon={<Heart className="w-4 h-4" />}
          active={pathname.startsWith('/cuidados-pessoais')}
          onClick={onClose}
        >
          Cuidados pessoais
        </SidebarLink>

        {/* WhatsApp */}
        <SidebarLink
          href="/painel/whatsapp"
          icon={<MessageCircle className="w-4 h-4" />}
          active={pathname.startsWith('/painel/whatsapp')}
          onClick={onClose}
        >
          WhatsApp
        </SidebarLink>

        <div className="mt-auto pt-4 border-t border-border">
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}

function SidebarLink({
  href,
  icon,
  children,
  active,
  indent,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
  indent?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md transition-all',
        indent ? 'pl-9 pr-3 py-1.5 text-xs' : 'px-3 py-2 text-sm',
        active
          ? 'bg-accent-400/10 text-accent-300 border border-accent-400/20'
          : 'text-zinc-300 hover:bg-bg-elevated hover:text-zinc-100 border border-transparent'
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
