import { requireUser } from '@/lib/supabase/server';
import { listAudios } from '@/lib/audio-storage';
import { PageHeader } from '../_components/page-header';
import { AudiosList, type AudioItem } from './_components/audios-list';

/**
 * Página de áudios do WhatsApp (#overhaul audio).
 *
 * Server component que busca os primeiros 20 áudios do user autenticado.
 * A busca textual + paginação ficam no client island `AudiosList`,
 * que faz fetch em `/api/audios`.
 */
export default async function AudiosPage() {
  let userId: string;
  try {
    const { userId: id } = await requireUser();
    userId = id;
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader title="Áudios" subtitle="Sua memória de áudios do WhatsApp" />
        <p className="text-sm text-zinc-500">Faça login para ver seus áudios.</p>
      </div>
    );
  }

  const { items, total } = await listAudios({
    userId,
    limit: 20,
    offset: 0,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Áudios"
        subtitle={`${total} áudio${total === 1 ? '' : 's'} na memória. Busca em PT-BR com stemming.`}
      />
      <AudiosList initialItems={items as AudioItem[]} initialTotal={total} />
    </div>
  );
}
