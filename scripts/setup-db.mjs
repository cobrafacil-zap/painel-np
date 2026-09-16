#!/usr/bin/env node
/**
 * Aplica supabase/schema.sql no projeto Supabase configurado em .env.local.
 * Uso: node scripts/setup-db.mjs
 *
 * Lê o SQL, divide em statements (no `;` final) e executa um a um via REST.
 * Supabase não tem endpoint REST nativo pra DDL arbitrário — então usamos
 * o endpoint /pg/query via psql se disponível; senão imprime o SQL e pede
 * pra colar no SQL Editor.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

require('dotenv').config({ path: resolve(root, '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const sql = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8');

console.log('📄 SQL lido:', sql.length, 'bytes');

// Tenta psql via connection string do Supabase (precisa instalar o Supabase CLI).
const dbUrl = process.env.DATABASE_URL; // opcional
if (dbUrl) {
  try {
    execSync(`psql "${dbUrl}" -f supabase/schema.sql`, { stdio: 'inherit', cwd: root });
    console.log('✅ Schema aplicado via psql');
    process.exit(0);
  } catch (e) {
    console.warn('⚠️ psql falhou, cai no modo manual.');
  }
}

console.log('\n🔗 Não foi possível aplicar automaticamente.');
console.log('Abra o SQL Editor do Supabase e cole o conteúdo de supabase/schema.sql:');
console.log(`   ${url.replace('https://', 'https://supabase.com/dashboard/project/').split('.')[0]}/sql/new\n`);
console.log('--- INÍCIO DO SQL ---');
console.log(sql);
console.log('--- FIM DO SQL ---');
