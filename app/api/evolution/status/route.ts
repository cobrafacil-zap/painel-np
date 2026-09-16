import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import {
  evolutionInstanceStatus,
  evolutionQRCode,
  EvolutionNotConfiguredError,
} from '@/lib/evolution';

export async function GET() {
  await requireUser();
  try {
    const status = await evolutionInstanceStatus();
    const qr =
      status.state !== 'open' ? await evolutionQRCode().catch(() => null) : null;
    return NextResponse.json({ status, qr });
  } catch (e: any) {
    if (e instanceof EvolutionNotConfiguredError) {
      return NextResponse.json({ error: e.message, code: 'NOT_CONFIGURED' }, { status: 501 });
    }
    return NextResponse.json({ error: e?.message ?? 'erro' }, { status: 500 });
  }
}
