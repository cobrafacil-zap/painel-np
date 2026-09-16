import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/supabase/server';

const createSchema = z.object({
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1).max(40),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
});

export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .eq('module_id', 'financeiro')
    .order('is_system', { ascending: false })
    .order('label');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: userId,
      module_id: 'financeiro',
      ...parsed.data,
      is_system: false,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data }, { status: 201 });
}
