#!/usr/bin/env node
// Run SQL against the hosted project through the Supabase Management API (the hosted DB
// has no supabase_migrations table, so `supabase db push` can't be used and multi-statement
// files - migrations, `do $$` bodies - are applied this way instead).
//
//   node scripts/db-query.mjs <file.sql> [more.sql ...]     apply the file(s) in order
//   node scripts/db-query.mjs -e "select 1"                 run an ad-hoc query
//
// SUPABASE_ACCESS_TOKEN comes from the root .env (gitignored). Results are printed as
// JSON; read-only queries are what this is for - schema changes should be migrations.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env */ }

const { SUPABASE_URL, SUPABASE_ACCESS_TOKEN } = env
if (!SUPABASE_URL || !SUPABASE_ACCESS_TOKEN) {
  console.error('need SUPABASE_URL and SUPABASE_ACCESS_TOKEN in the root .env')
  process.exit(1)
}
const PROJECT_REF = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/db-query.mjs <file.sql> ... | -e "<sql>"')
  process.exit(1)
}
const queries = args[0] === '-e'
  ? [args.slice(1).join(' ')]
  : args.map((f) => readFileSync(resolve(f), 'utf8'))

for (const query of queries) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${text}`)
    process.exit(1)
  }
  console.log(text)
}
