import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDateBR(iso: string): string {
  // 'YYYY-MM-DD' → 'DD/MM/YYYY'
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function todayISO(): string {
  // Retorna YYYY-MM-DD no fuso de São Paulo (America/Sao_Paulo, UTC-3).
  // Evita o bug clássico de `toISOString().slice(0,10)` que sempre
  // usa UTC — depois das 21h BRT já seria "amanhã" em UTC, fazendo
  // o relatório das 23h pegar registros do dia errado.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

export function monthISO(date = new Date()): string {
  return date.toISOString().slice(0, 7); // 'YYYY-MM'
}

export function startOfMonthISO(date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

export function endOfMonthISO(date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}
