import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';

const updateSchema = z.object({
  label: z.string().min(1).max(40).optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();

  // Verifica se a categoria é do user antes de editar
  const { data: existing } = await supabase
    .from('categories')
    .select('id, is_system, slug')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });

  // System categories: só permite editar label/icon/color (não slug)
  // User categories: pode editar tudo
  const { data, error } = await supabase
    .from('categories')
    .update(parsed.data)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;

  const supabase = await createClient();

  // Não permite apagar system categories
  const { data: existing } = await supabase
    .from('categories')
    .select('id, is_system, slug')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
  if (existing.is_system) {
    return NextResponse.json(
      { error: 'Categorias do sistema não podem ser apagadas (só renomeadas).' },
      { status: 400 }
    );
  }

  const { error } = await supabase.from('categories').delete().eq('id', id).eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
