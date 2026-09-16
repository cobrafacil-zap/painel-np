import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('whatsapp_group_jid')
    .eq('id', userId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ whatsapp_group_jid: data?.whatsapp_group_jid ?? null });
}
