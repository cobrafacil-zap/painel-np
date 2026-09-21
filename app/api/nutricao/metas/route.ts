/**
 * API de metas nutricionais (#feature alimentação).
 *
 * GET  → retorna metas atuais + flag se profile tem bio completa
 * POST → salva metas manuais ou recalcula via Harris-Benedict
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getMetasNutricao,
  setMetasNutricao,
  calcularEAplicarMetasAuto,
  profileTemBio,
  type MetasNutricao,
} from '@/lib/nutricao/metas';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [metas, temBio] = await Promise.all([
    getMetasNutricao(user.id),
    profileTemBio(user.id),
  ]);

  return NextResponse.json({
    metas,
    tem_bio: temBio,
  });
}

interface PostBody {
  modo: 'manual' | 'auto';
  metas?: {
    meta_kcal: number;
    meta_protein_g: number;
    meta_carb_g: number;
    meta_fat_g: number;
  };
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

  if (body.modo === 'auto') {
    const aplicadas = await calcularEAplicarMetasAuto(user.id);
    if (!aplicadas) {
      return NextResponse.json(
        { error: 'bio_incompleta', message: 'Preencha altura, peso, idade e sexo no perfil antes de calcular automaticamente.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, metas: aplicadas });
  }

  if (body.modo === 'manual') {
    if (!body.metas) {
      return NextResponse.json({ error: 'metas_required' }, { status: 400 });
    }
    const { meta_kcal, meta_protein_g, meta_carb_g, meta_fat_g } = body.metas;
    if ([meta_kcal, meta_protein_g, meta_carb_g, meta_fat_g].some((v) => v == null || v < 0)) {
      return NextResponse.json({ error: 'valores_invalidos' }, { status: 400 });
    }
    const ok = await setMetasNutricao(user.id, {
      meta_kcal,
      meta_protein_g,
      meta_carb_g,
      meta_fat_g,
    });
    if (!ok) return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    const atualizadas: MetasNutricao = {
      userId: user.id,
      meta_kcal,
      meta_protein_g,
      meta_carb_g,
      meta_fat_g,
      origem: 'manual',
    };
    return NextResponse.json({ ok: true, metas: atualizadas });
  }

  return NextResponse.json({ error: 'modo_invalido' }, { status: 400 });
}
