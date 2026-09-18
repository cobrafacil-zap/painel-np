import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser, createClient } from '@/lib/supabase/server';
import { AppShell } from './_components/app-shell';

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
    <AppShell
      profile={{
        full_name: profile?.full_name ?? null,
        email: email ?? null,
        evolution_instance_name: profile?.evolution_instance_name ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
