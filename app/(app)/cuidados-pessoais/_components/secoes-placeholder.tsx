'use client';

/**
 * Placeholders de Sono e Treino (#feature cuidado pessoal).
 *
 * POR QUE componente client: ícone Lucide é uma função/componente React
 * e Server Components não podem passar funções como props pra Client
 * Components (React 19 / Next 15 RSC). Mover os 2 placeholders pra cá
 * elimina o erro "Functions cannot be passed directly to Client
 * Components" no SSR de /cuidados-pessoais.
 */

import { Moon, Dumbbell } from 'lucide-react';
import { SecaoPlaceholder } from './secao-placeholder';

export function SecoesPlaceholder() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <SecaoPlaceholder
        icon={Moon}
        titulo="Sono"
        descricao="Registrar horas dormidas, qualidade percebida e consistência. Liberação prevista pra próxima fase."
      />
      <SecaoPlaceholder
        icon={Dumbbell}
        titulo="Treino"
        descricao="Cadastrar atividades físicas (musculação, cardio, esporte) com duração e sensação de esforço. Liberação prevista pra próxima fase."
      />
    </div>
  );
}
