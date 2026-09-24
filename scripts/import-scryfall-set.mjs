#!/usr/bin/env node
// Import a whole Magic set into the Campus Forge catalog.
//
//   node scripts/import-scryfall-set.mjs <set-code> [--upload-art]
//   e.g. node scripts/import-scryfall-set.mjs m19 --upload-art
//
// 1. Fetches every booster card of the set from Scryfall (basic lands excluded).
// 2. Keeps only cards the Forge engine knows (Name: lines under
//    forge-engine/forge-gui/res/cardsfolder); anything else would be skipped
//    silently when a deck is loaded for battle, so it is reported and dropped.
// 3. Writes supabase/seed_sets/<set>.sql: an idempotent catalog insert. Cards
//    whose name is already in the catalog are skipped, so existing ownership
//    types are never changed. Ownership by rarity:
//        common → UNLIMITED, locked until the player scans it once (requires_unlock)
//        uncommon/rare → UNLOCK (one copy per distinct code, max 4) · mythic → UNIQUE
// 4. With --upload-art: downloads each card's art from Scryfall and uploads it
//    to the public `card-art` bucket as <slug>.jpg (skips images already there).
//    Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or repo-root .env).
//
// Card ids are Scryfall print ids and oracle ids are Scryfall oracle ids, so
// re-running the import produces identical rows.

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const [setArg, ...flags] = process.argv.slice(2)
if (!setArg || !/^[a-z0-9]{2,6}$/i.test(setArg)) {
  console.error('usage: node scripts/import-scryfall-set.mjs <set-code> [--upload-art]')
  process.exit(1)
}
const SET = setArg.toLowerCase()
const UPLOAD_ART = flags.includes('--upload-art')
const HEADERS = { 'User-Agent': 'CampusForge/1.0 (campus game catalog import)', Accept: 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const OWNERSHIP = { common: 'UNLIMITED', uncommon: 'UNLOCK', rare: 'UNLOCK', mythic: 'UNIQUE' }
const WEIGHT = { common: 5.0, uncommon: 4.0, rare: 2.0, mythic: 0.1 }
// Where a card's QR codes are hidden on campus, by its first color (existing convention).
const REGION = { W: 'Library', U: 'Building B', B: 'Library', R: 'Gym', G: 'Engineering' }

/** Same slug as web-client/src/lib/scryfall.tsx and scripts/download-card-art.ps1. */
export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const sql = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

function loadEnv() {
  const env = { ...process.env }
  const file = join(REPO, '.env')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
  return env
}

function forgeCardNames() {
  const root = join(REPO, 'forge-engine', 'forge-gui', 'res', 'cardsfolder')
  if (!existsSync(root)) throw new Error(`Forge card data not found at ${root}; run battle-engine/setup-forge.ps1 first`)
  const names = new Set()
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.txt')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/^Name:(.+)$/gm)) names.add(m[1].trim())
      }
    }
  }
  walk(root)
  return names
}

async function fetchSet(set) {
  const cards = []
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`e:${set} is:booster -type:basic`)}&unique=cards&order=set`
  while (url) {
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`)
    const page = await res.json()
    cards.push(...page.data)
    url = page.has_more ? page.next_page : null
    await sleep(120) // Scryfall asks for 50-100 ms between requests
  }
  return cards
}

/** Front face for double-faced cards (Forge and the deck converter use the front name). */
function face(card) {
  const f = card.card_faces?.[0]
  return {
    name: f && card.layout !== 'split' ? f.name : card.name,
    typeLine: f?.type_line ?? card.type_line,
    colors: card.colors ?? f?.colors ?? [],
    image: card.image_uris?.normal ?? f?.image_uris?.normal ?? null,
  }
}

function toRow(card) {
  const f = face(card)
  const rarity = card.rarity
  const colors = ['W', 'U', 'B', 'R', 'G'].filter((c) => f.colors.includes(c)).join('')
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    forge_name: f.name,
    rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1),
    ownership_type: OWNERSHIP[rarity] ?? 'UNLOCK',
    set_code: card.set.toUpperCase(),
    mana_value: Math.round(card.cmc ?? 0),
    types: f.typeLine,
    colors,
    discoverable: OWNERSHIP[rarity] !== 'UNIQUE',
    spawn_region: colors ? REGION[colors[0]] : 'Special',
    weight: WEIGHT[rarity] ?? 4.0,
    commander_eligible: /\bLegendary\b.*\bCreature\b/.test(f.typeLine),
    // imported UNLIMITED cards must be scanned once (only the base 15 are free)
    requires_unlock: (OWNERSHIP[rarity] ?? 'UNLOCK') === 'UNLIMITED',
    image: f.image,
  }
}

function toSeedSql(set, rows) {
  const cols = 'id, oracle_id, forge_name, rarity, ownership_type, set_code, mana_value, types, colors, image_url, discoverable, spawn_region, weight, commander_eligible, requires_unlock'
  const values = rows.map((r) =>
    `    (${[sql(r.id), sql(r.oracle_id), sql(r.forge_name), sql(r.rarity), sql(r.ownership_type), sql(r.set_code),
        r.mana_value, sql(r.types), sql(r.colors), 'null', r.discoverable, sql(r.spawn_region), r.weight.toFixed(1),
        r.commander_eligible, r.requires_unlock].join(', ')})`)
  const counts = rows.reduce((m, r) => ((m[r.ownership_type] = (m[r.ownership_type] ?? 0) + 1), m), {})
  return `-- Campus Forge catalog: ${set.toUpperCase()} (generated by scripts/import-scryfall-set.mjs ${set} — do not edit by hand)
-- ${rows.length} cards (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}); basic lands excluded.
-- Ownership by rarity: common → UNLIMITED (locked until scanned once), uncommon/rare → UNLOCK
-- (one copy per distinct code, max 4), mythic → UNIQUE.
-- Idempotent: cards whose name is already in the catalog are skipped (their ownership is left alone).

insert into public.cards (${cols})
select v.id::uuid, v.oracle_id, v.forge_name, v.rarity, v.ownership_type, v.set_code, v.mana_value, v.types,
       v.colors, v.image_url, v.discoverable, v.spawn_region, v.weight, v.commander_eligible, v.requires_unlock
from (values
${values.join(',\n')}
) as v (${cols})
where not exists (select 1 from public.cards c where lower(c.forge_name) = lower(v.forge_name))
on conflict do nothing;
`
}

async function uploadArt(rows, env) {
  const base = env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('--upload-art needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  let uploaded = 0, skipped = 0, failed = 0
  for (const r of rows) {
    const name = `${slug(r.forge_name)}.jpg`
    const publicUrl = `${base}/storage/v1/object/public/card-art/${name}`
    if ((await fetch(publicUrl, { method: 'HEAD' })).ok) { skipped++; continue }
    if (!r.image) { console.warn(`  no image for ${r.forge_name}`); failed++; continue }
    try {
      const img = await fetch(r.image, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
      if (!img.ok) throw new Error(`download ${img.status}`)
      const body = Buffer.from(await img.arrayBuffer())
      const up = await fetch(`${base}/storage/v1/object/card-art/${name}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body,
      })
      if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`)
      uploaded++
    } catch (e) {
      console.warn(`  art failed for ${r.forge_name}: ${e.message}`)
      failed++
    }
    await sleep(100)
  }
  console.log(`art: ${uploaded} uploaded, ${skipped} already present, ${failed} failed`)
}

const forgeNames = forgeCardNames()
console.log(`Forge knows ${forgeNames.size} card names`)
const all = (await fetchSet(SET)).map(toRow)
const unknown = all.filter((r) => !forgeNames.has(r.forge_name))
const rows = all.filter((r) => forgeNames.has(r.forge_name))
if (unknown.length) console.warn(`skipping ${unknown.length} card(s) Forge doesn't implement: ${unknown.map((r) => r.forge_name).join(', ')}`)

const outDir = join(REPO, 'supabase', 'seed_sets')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `${SET}.sql`)
writeFileSync(out, toSeedSql(SET, rows))
console.log(`wrote ${out}: ${rows.length} cards`)

if (UPLOAD_ART) await uploadArt(rows, loadEnv())
