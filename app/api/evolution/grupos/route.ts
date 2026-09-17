import { NextResponse } from 'next/server';
import { requireUser, createClient } from '@/lib/supabase/server';
import { evolutionListarGrupos, EvolutionNotConfiguredError } from '@/lib/evolution';

/**
 * GET /api/evolution/grupos
 *
 * Lista os grupos da instância Evolution do usuário logado.
 */
export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('evolution_instance_name')
    .eq('id', userId)
    .single();

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  if (!profile?.evolution_instance_name) {
    return NextResponse.json(
      { error: 'Instância Evolution não provisionada. Complete o onboarding.' },
      { status: 412 }
    );
  }

  try {
    const grupos = await evolutionListarGrupos(profile.evolution_instance_name);
    return NextResponse.json({ groups: grupos, instanceName: profile.evolution_instance_name });
  } catch (e: any) {
    if (e instanceof EvolutionNotConfiguredError) {
      return NextResponse.json(
        { error: e.message, code: 'NOT_CONFIGURED' },
        { status: 501 }
      );
    }
    return NextResponse.json({ error: e?.message ?? 'erro' }, { status: 500 });
  }
}
