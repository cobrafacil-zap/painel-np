#!/usr/bin/env node
/**
 * Fix de categorias do financeiro:
 *   1. Lançamentos com categoria 'droga' → 'outros'
 *   2. Remove a categoria 'droga' (qualquer user)
 *   3. Garante 'Crediário' e 'Cartão de crédito' como categorias pra cada user
 *
 * Uso: node scripts/fix-categorias.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const env = readFileSync(resolve(root, '.env.local'), 'utf8');
const val = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const url = val('NEXT_PUBLIC_SUPABASE_URL');
const key = val('SUPABASE_SERVICE_ROLE_KEY');

if (!url || !key) {
  console.error('❌ Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// 1) Lançamentos com categoria 'droga' → 'outros'
const { data: recs, error: e1 } = await db
  .from('records')
  .update({ category: 'outros' })
  .eq('category', 'droga')
  .select('id');
if (e1) {
  console.error('❌ records:', e1.message);
  process.exit(1);
}
console.log(`✅ Lançamentos realocados pra 'outros': ${recs?.length ?? 0}`);

// 2) Remove a categoria 'droga'
let removidas = 0;
for (const filtro of [{ slug: 'droga' }, { label: 'Droga' }]) {
  let q = db.from('categories').delete();
  q = 'slug' in filtro ? q.eq('slug', filtro.slug) : q.eq('label', filtro.label);
  const { data, error } = await q.select('id');
  if (error) {
    console.error('❌ categories:', error.message);
    process.exit(1);
  }
  removidas += data?.length ?? 0;
}
console.log(`✅ Categoria 'Droga' removida: ${removidas} registro(s)`);

// 3) Crediário + Cartão de crédito pra cada user que já tem categorias
const { data: donos, error: e3 } = await db.from('categories').select('user_id');
if (e3) {
  console.error('❌ users:', e3.message);
  process.exit(1);
}
const userIds = [...new Set((donos ?? []).map((d) => d.user_id))];
let criadas = 0;
for (const user_id of userIds) {
  const { error } = await db.from('categories').upsert(
    [
      { user_id, module_id: 'financeiro', slug: 'crediario', label: 'Crediário', icon: 'CreditCard', color: '#0ea5e9', is_system: true },
      { user_id, module_id: 'financeiro', slug: 'cartao_credito', label: 'Cartão de crédito', icon: 'CreditCard', color: '#6366f1', is_system: true },
      { user_id, module_id: 'financeiro', slug: 'presentes', label: 'Presentes', icon: 'Gift', color: '#f43f5e', is_system: true },
    ],
    { onConflict: 'user_id,module_id,slug', ignoreDuplicates: true },
  );
  if (error) {
    console.error('❌ upsert categorias:', error.message);
    process.exit(1);
  }
  criadas += 3;
}
console.log(`✅ 'Crediário' + 'Cartão de crédito' garantidas pra ${userIds.length} user(s) (${criadas} slots)`);
console.log('\n--- Pronto ---');
