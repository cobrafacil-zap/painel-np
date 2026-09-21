/**
 * Página "Cuidados pessoais" (#feature cuidado pessoal).
 *
 * Página dedicada (top-level /cuidados-pessoais, não é card no painel).
 * Subcategorias:
 *   - Bio (altura/peso/idade/sexo) — edita profiles
 *   - Alimentação (macros de hoje + lista completa)
 *   - Histórico de refeições (7/14/30 dias)
 *   - Sono (placeholder)
 *   - Treino (placeholder)
 *
 * Edições em `profiles.altura_cm/peso_kg/idade/sexo` recalculam metas
 * nutricionais automaticamente (se origem='auto') via API /bio.
 */

import { createClient } from '@/lib/supabase/server';
import { Heart } from 'lucide-react';
import { BioForm } from './_components/bio-form';
import { AlimentacaoSecao } from './_components/alimentacao-secao';
import { HistoricoRefeicoes } from './_components/historico-refeicoes';
import { SecoesPlaceholder } from './_components/secoes-placeholder';
import { PageHeader } from '../_components/page-header';

export const dynamic = 'force-dynamic';

export default async function CuidadosPessoaisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Bio do profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('altura_cm, peso_kg, idade, sexo')
    .eq('id', user.id)
    .single();

  const bio = {
    altura_cm: profile?.altura_cm ?? null,
    peso_kg: profile?.peso_kg ?? null,
    idade: profile?.idade ?? null,
    sexo: profile?.sexo ?? null,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cuidados pessoais"
        title="Sua saúde do dia a dia"
        subtitle={
          <span className="flex items-center gap-2">
            <Heart className="w-3.5 h-3.5 text-rose-300" />
            Bio, alimentação e o que vem por aí (sono, treino). Tudo num lugar só.
          </span>
        }
      />

      <BioForm initial={bio} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlimentacaoSecao />
        <HistoricoRefeicoes />
      </div>

      <SecoesPlaceholder />
    </div>
  );
}
