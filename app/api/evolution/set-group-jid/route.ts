import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({
  group_jid: z.string().regex(/@g\.us$/, 'JID inválido (deve terminar com @g.us)'),
});

export async function POST(req: NextRequest) {
  const { userId } = await requireUser();
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'JID inválido', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ whatsapp_group_jid: parsed.data.group_jid })
    .eq('id', userId)
    .select('whatsapp_group_jid')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, whatsapp_group_jid: data?.whatsapp_group_jid });
}
