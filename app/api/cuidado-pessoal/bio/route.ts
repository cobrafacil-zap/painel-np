/**
 * API de bio do profile (#feature cuidado pessoal).
 *
 * GET  → retorna altura/peso/idade/sexo
 * POST → atualiza os 4 campos (validação: idade 10-120, peso 30-300kg, altura 100-250cm)
 *
 * Quando o user atualiza a bio, recalcula automaticamente as metas
 * nutricionais se já tiver metas salvas e elas eram 'auto'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  calcularEAplicarMetasAuto,
  getMetasNutricao,
} from '@/lib/nutricao/metas';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('altura_cm, peso_kg, idade, sexo')
    .eq('id', user.id)
    .single();

  return NextResponse.json({
    bio: {
      altura_cm: profile?.altura_cm ?? null,
      peso_kg: profile?.peso_kg ?? null,
      idade: profile?.idade ?? null,
      sexo: profile?.sexo ?? null,
    },
  });
}

interface PostBody {
  altura_cm?: number | null;
  peso_kg?: number | null;
  idade?: number | null;
  sexo?: 'M' | 'F' | null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Validação
  if (body.altura_cm != null && (body.altura_cm < 100 || body.altura_cm > 250)) {
    return NextResponse.json({ error: 'altura_invalida' }, { status: 400 });
  }
  if (body.peso_kg != null && (body.peso_kg < 30 || body.peso_kg > 300)) {
    return NextResponse.json({ error: 'peso_invalido' }, { status: 400 });
  }
  if (body.idade != null && (body.idade < 10 || body.idade > 120)) {
    return NextResponse.json({ error: 'idade_invalida' }, { status: 400 });
  }
  if (body.sexo != null && !['M', 'F'].includes(body.sexo)) {
    return NextResponse.json({ error: 'sexo_invalido' }, { status: 400 });
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      altura_cm: body.altura_cm ?? null,
      peso_kg: body.peso_kg ?? null,
      idade: body.idade ?? null,
      sexo: body.sexo ?? null,
    })
    .eq('id', user.id);

  if (error) {
    console.error('[bio_save]', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  // Se tinha metas auto antes e bio ficou completa, recalcula.
  let metasRecalculadas: Awaited<ReturnType<typeof calcularEAplicarMetasAuto>> = null;
  const metasAtuais = await getMetasNutricao(user.id);
  if (
    metasAtuais.origem === 'auto' &&
    body.altura_cm != null &&
    body.peso_kg != null &&
    body.idade != null &&
    body.sexo != null
  ) {
    metasRecalculadas = await calcularEAplicarMetasAuto(user.id);
  }

  return NextResponse.json({
    ok: true,
    metas_recalculadas: !!metasRecalculadas,
  });
}
