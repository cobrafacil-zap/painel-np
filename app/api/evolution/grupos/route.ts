import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { evolutionListarGrupos, EvolutionNotConfiguredError } from '@/lib/evolution';

export async function GET() {
  await requireUser();

  try {
    const grupos = await evolutionListarGrupos();
    return NextResponse.json({ groups: grupos });
  } catch (e: any) {
    if (e instanceof EvolutionNotConfiguredError) {
      return NextResponse.json({ error: e.message, code: 'NOT_CONFIGURED' }, { status: 501 });
    }
    return NextResponse.json({ error: e?.message ?? 'erro' }, { status: 500 });
  }
}
