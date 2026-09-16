'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button onClick={logout} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white w-full px-3 py-2">
      <LogOut className="w-4 h-4" />
      Sair
    </button>
  );
}
