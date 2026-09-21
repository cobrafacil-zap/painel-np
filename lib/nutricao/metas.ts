/**
 * Metas nutricionais (#feature alimentação).
 *
 * CRUD da tabela `metas_nutricao` (1 row por user) + cálculo automático
 * via Harris-Benedict a partir de `profiles.altura_cm/peso_kg/idade/sexo`.
 *
 * Distribuição de macros padrão (recomendação OMS pra adulto sedentário):
 *   - Proteína: 1.6g/kg (conservador) ou 0.8g/lb (atleta)
 *   - Gordura: 25-30% das kcal
 *   - Carboidrato: o que sobra
 *
 * Mas como `profiles` raramente tem altura/peso preenchido, oferecemos
 * defaults baseados em TMB média (homem 70kg ou mulher 60kg, 30 anos):
 *   - 2000 kcal/dia (mulher) ou 2500 kcal/dia (homem)
 *   - 120g proteína, 250g carb, 70g gordura
 */

import { createServiceClient } from '@/lib/supabase/server';
import { logStage, logError } from '@/lib/log';

export interface MetasNutricao {
  userId: string;
  meta_kcal: number | null;
  meta_protein_g: number | null;
  meta_carb_g: number | null;
  meta_fat_g: number | null;
  origem: 'auto' | 'manual' | 'hibrido';
}

export interface BioProfile {
  altura_cm: number | null;
  peso_kg: number | null;
  idade: number | null;
  sexo: 'M' | 'F' | null;
}

/**
 * TMB via Harris-Benedict revisada (1990, Mifflin-St Jeor variante).
 *   Homens: 10*peso + 6.25*altura - 5*idade + 5
 *   Mulheres: 10*peso + 6.25*altura - 5*idade - 161
 *
 * Para TDEE (gasto total diário), multiplicamos por 1.4 (sedentário) —
 * user pode ajustar manualmente depois.
 */
export function calcularTMB(bio: BioProfile): number | null {
  if (!bio.peso_kg || !bio.altura_cm || !bio.idade || !bio.sexo) return null;

  const tmb =
    bio.sexo === 'M'
      ? 10 * bio.peso_kg + 6.25 * bio.altura_cm - 5 * bio.idade + 5
      : 10 * bio.peso_kg + 6.25 * bio.altura_cm - 5 * bio.idade - 161;

  return Math.round(tmb * 1.4); // TDEE sedentário
}

/**
 * Calcula metas nutricionais baseadas na bio do profile.
 * Retorna null se faltarem dados (altura/peso/idade/sexo).
 */
export function calcularMetasAuto(bio: BioProfile): Omit<MetasNutricao, 'userId' | 'origem'> | null {
  const tdee = calcularTMB(bio);
  if (tdee == null || !bio.peso_kg) return null;

  const meta_kcal = tdee;
  const meta_protein_g = Math.round(bio.peso_kg * 1.6); // 1.6g/kg
  const meta_fat_g = Math.round((tdee * 0.27) / 9); // 27% das kcal em gordura
  const meta_carb_g = Math.round(
    (tdee - meta_protein_g * 4 - meta_fat_g * 9) / 4,
  );

  return {
    meta_kcal,
    meta_protein_g,
    meta_carb_g,
    meta_fat_g,
  };
}

/**
 * Defaults quando não tem bio preenchida (fallback pra primeiro acesso).
 */
export const METAS_DEFAULT: Omit<MetasNutricao, 'userId' | 'origem'> = {
  meta_kcal: 2200,
  meta_protein_g: 120,
  meta_carb_g: 280,
  meta_fat_g: 70,
};

/**
 * Busca metas do user. Se não existir, cria com defaults.
 * Idempotente.
 */
export async function getMetasNutricao(userId: string): Promise<MetasNutricao> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('metas_nutricao')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logError('metas_nutricao_get', error, { userId });
    }

    if (data) {
      return {
        userId,
        meta_kcal: data.meta_kcal,
        meta_protein_g: data.meta_protein_g,
        meta_carb_g: data.meta_carb_g,
        meta_fat_g: data.meta_fat_g,
        origem: data.origem ?? 'manual',
      };
    }

    // Não existe → criar com defaults
    const { data: inserted, error: insertErr } = await supabase
      .from('metas_nutricao')
      .insert({
        user_id: userId,
        ...METAS_DEFAULT,
        origem: 'auto',
      })
      .select('*')
      .single();

    if (insertErr) {
      // Race condition: outro request criou. Tenta de novo.
      if ((insertErr as { code?: string }).code === '23505') {
        return getMetasNutricao(userId);
      }
      logError('metas_nutricao_create', insertErr, { userId });
    }

    return {
      userId,
      meta_kcal: inserted?.meta_kcal ?? METAS_DEFAULT.meta_kcal,
      meta_protein_g: inserted?.meta_protein_g ?? METAS_DEFAULT.meta_protein_g,
      meta_carb_g: inserted?.meta_carb_g ?? METAS_DEFAULT.meta_carb_g,
      meta_fat_g: inserted?.meta_fat_g ?? METAS_DEFAULT.meta_fat_g,
      origem: 'auto',
    };
  } catch (e) {
    logError('metas_nutricao', e, { userId });
    return {
      userId,
      ...METAS_DEFAULT,
      origem: 'auto',
    };
  }
}

/**
 * Atualiza metas manualmente (origem vira 'manual').
 */
export async function setMetasNutricao(
  userId: string,
  metas: Omit<MetasNutricao, 'userId' | 'origem'>,
): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('metas_nutricao')
      .upsert(
        {
          user_id: userId,
          ...metas,
          origem: 'manual',
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      logError('metas_nutricao_set', error, { userId });
      return false;
    }
    return true;
  } catch (e) {
    logError('metas_nutricao_set', e);
    return false;
  }
}

/**
 * Atualiza metas via cálculo automático (origem vira 'auto' ou 'hibrido'
 * se user já tinha algumas manuais). Busca bio do profile primeiro.
 */
export async function calcularEAplicarMetasAuto(userId: string): Promise<MetasNutricao | null> {
  try {
    const supabase = createServiceClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('altura_cm, peso_kg, idade, sexo')
      .eq('id', userId)
      .single();

    if (!profile) return null;

    const bio: BioProfile = {
      altura_cm: profile.altura_cm,
      peso_kg: profile.peso_kg,
      idade: profile.idade,
      sexo: profile.sexo,
    };

    const calculadas = calcularMetasAuto(bio);
    if (!calculadas) return null;

    const { error } = await supabase
      .from('metas_nutricao')
      .upsert(
        {
          user_id: userId,
          ...calculadas,
          origem: 'auto',
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      logError('metas_nutricao_auto', error, { userId });
      return null;
    }

    logStage('metas_nutricao_auto_applied', undefined, {
      userId,
      kcal: calculadas.meta_kcal,
    });

    return { userId, ...calculadas, origem: 'auto' };
  } catch (e) {
    logError('metas_nutricao_auto', e, { userId });
    return null;
  }
}

/**
 * Checa se o profile tem dados suficientes pra calcular auto.
 */
export async function profileTemBio(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('profiles')
    .select('altura_cm, peso_kg, idade, sexo')
    .eq('id', userId)
    .single();
  if (!data) return false;
  return !!(data.altura_cm && data.peso_kg && data.idade && data.sexo);
}
