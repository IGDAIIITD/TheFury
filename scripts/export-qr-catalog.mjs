#!/usr/bin/env node
// Export the printable QR catalog for every card in the live catalog.
//
//   cd scripts && npm ci
//   node export-qr-catalog.mjs [--copies 4] [--out ../card-art] [--include-free] [--with-art] [--no-images] [--offline]
//
// Calls the qr-catalog Edge Function with the service-role key from the root .env, or with an
// admin's access token in QR_EXPORT_TOKEN (either is accepted; the function
// signs the codes with QR_SIGNING_SECRET, which never leaves Supabase, and creates the claim row
// for every code, so the codes work as soon as they are exported). Writes into --out:
//   cards.json        [{ cardName, qrContent }] (plus "copy" when --copies > 1): what to encode
//   cards.csv         the same with copy, rule, ownership type, rarity, token core, oracle id
//   qr/<slug>[-<copy>].png   one QR image per code (600 px, error correction M)
//   print-sheet.html  every code with its card art, name and rule; print it from a browser
//   <slug>.jpg        card art for every card that doesn't have it yet (--with-art)
//
// --offline re-renders qr/ and print-sheet.html from an earlier export's cards.csv (no Supabase calls).
// --copies N (1-4): UNLOCK cards get N distinct codes (a player can own one copy per code, up to 4).
// The 15 free starter cards (basic lands + starter creatures) are skipped unless --include-free:
// everyone already owns them, so scanning them only counts a discovery.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const copies = Number(opt('--copies', '4'))
if (!Number.isInteger(copies) || copies < 1 || copies > 4) {
  console.error('--copies must be 1..4')
  process.exit(1)
}
const out = resolve(opt('--out', join(root, 'card-art')))
const includeFree = flag('--include-free')
const withArt = flag('--with-art')
const images = !flag('--no-images')
const offline = flag('--offline')

function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // no .env: rely on the environment
  }
  return env
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes). */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

const csvEscape = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Same wording as web-client/src/lib/ownership.ts. */
function rule(row, total) {
  if (row.ownershipType === 'UNLIMITED') return row.requiresUnlock === 'true' ? 'Scan once, unlock forever' : 'Free for everyone'
  if (row.ownershipType === 'UNLOCK') return total > 1 ? `Copy ${row.copy} of ${total} · up to 4` : 'Scan a code per copy (up to 4)'
  if (row.ownershipType === 'UNIQUE') return 'One of a kind: first scan wins'
  return ''
}

const env = loadEnv()
const url = env.SUPABASE_URL?.replace(/\/+$/, '')
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (root .env)')
  process.exit(1)
}

let all
if (offline) {
  // Re-render images and the sheet from an earlier export's cards.csv (no network calls).
  const previous = join(out, 'cards.csv')
  if (!existsSync(previous)) {
    console.error(`--offline needs an earlier export: ${previous} not found`)
    process.exit(1)
  }
  all = parseCsv(readFileSync(previous, 'utf8')).map((r) => ({
    ...r,
    requiresUnlock: String(r.rule === 'Scan once, unlock forever'),
  }))
  console.log(`Re-rendering ${all.length} codes from ${previous}`)
} else {
  console.log(`Exporting the QR catalog (${copies} code(s) per UNLOCK card)...`)
  const caller = env.QR_EXPORT_TOKEN || key
  const res = await fetch(`${url}/functions/v1/qr-catalog?format=csv&copies=${copies}`, {
    headers: { apikey: key, Authorization: `Bearer ${caller}` },
  })
  if (!res.ok) {
    console.error(`qr-catalog failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  all = parseCsv(await res.text())
  // Which UNLIMITED cards are free (the base 15) comes straight from the catalog.
  const cardRes = await fetch(`${url}/rest/v1/cards?select=forge_name,requires_unlock`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!cardRes.ok) {
    console.error(`could not read the card catalog: ${cardRes.status}`)
    process.exit(1)
  }
  const locked = new Map((await cardRes.json()).map((c) => [c.forge_name, c.requires_unlock === true]))
  for (const r of all) r.requiresUnlock = String(locked.get(r.cardName) ?? false)
}
const rows = all.filter((r) => includeFree || !(r.ownershipType === 'UNLIMITED' && r.requiresUnlock !== 'true'))
const cards = new Set(rows.map((r) => r.cardName))
const byType = {}
for (const r of rows) byType[r.ownershipType] = (byType[r.ownershipType] ?? 0) + 1
console.log(`${all.length} codes from the catalog; exporting ${rows.length} codes for ${cards.size} cards`, byType)

mkdirSync(out, { recursive: true })
const perCard = {}
for (const r of rows) perCard[r.cardName] = (perCard[r.cardName] ?? 0) + 1

// cards.json: exactly what to encode (same shape as the Edge Function's JSON)
writeFileSync(
  join(out, 'cards.json'),
  JSON.stringify(
    rows.map((r) => (copies > 1 ? { cardName: r.cardName, copy: Number(r.copy), qrContent: r.qrContent } : { cardName: r.cardName, qrContent: r.qrContent })),
    null,
    1,
  ) + '\n',
)
writeFileSync(
  join(out, 'cards.csv'),
  ['cardName,copy,qrContent,rule,ownershipType,rarity,tokenCore,oracleId']
    .concat(rows.map((r) => [r.cardName, r.copy, r.qrContent, rule(r, perCard[r.cardName]), r.ownershipType, r.rarity, r.tokenCore, r.oracleId].map((v) => csvEscape(String(v))).join(',')))
    .join('\n') + '\n',
)

const fileFor = (r) => (perCard[r.cardName] > 1 ? `${slug(r.cardName)}-${r.copy}` : slug(r.cardName))
const artUrl = (name) => `${url}/storage/v1/object/public/card-art/${slug(name)}.jpg`

if (images) {
  mkdirSync(join(out, 'qr'), { recursive: true })
  for (const r of rows) {
    await QRCode.toFile(join(out, 'qr', `${fileFor(r)}.png`), r.qrContent, { errorCorrectionLevel: 'M', margin: 2, width: 600 })
  }
  console.log(`wrote ${rows.length} QR images to ${join(out, 'qr')}`)

  const tiles = []
  for (const r of rows) {
    const svg = await QRCode.toString(r.qrContent, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
    tiles.push(`<figure class="tile ${r.ownershipType.toLowerCase()}">
  <img class="art" src="${slug(r.cardName)}.jpg" alt="" onerror="this.onerror=null;this.src='${artUrl(r.cardName)}'">
  <div class="qr">${svg}</div>
  <figcaption><strong>${esc(r.cardName)}</strong><span>${esc(rule(r, perCard[r.cardName]))}</span></figcaption>
</figure>`)
  }
  writeFileSync(
    join(out, 'print-sheet.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>The Fury · QR catalog</title>
<style>
  @page { size: A4; margin: 10mm; }
  :root { color-scheme: light; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 8px; color: #2b1d14; background: #fff; }
  header { padding: 8px 4px 12px; }
  h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; font-size: 12px; color: #7a6450; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
  .tile { margin: 0; border: 1px solid #d8c3a2; border-radius: 3mm; padding: 3mm; display: grid;
          grid-template-columns: 22mm 1fr; grid-template-rows: auto auto; gap: 2mm; break-inside: avoid; }
  .tile.unique { border: 2px solid #b8892a; }
  .art { width: 22mm; border-radius: 1.5mm; grid-row: span 2; }
  .qr svg { width: 34mm; height: 34mm; display: block; }
  figcaption { grid-column: 1 / -1; font-size: 10px; display: flex; flex-direction: column; gap: 1mm; }
  figcaption strong { font-size: 11px; }
  figcaption span { color: #7a6450; }
</style></head>
<body>
<header><h1>The Fury · QR catalog</h1>
<p>${rows.length} codes · ${cards.size} cards · ${Math.max(...Object.values(perCard))} code(s) per UNLOCK card · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Each code works once per player; unique codes work once in total.</p></header>
<main class="grid">
${tiles.join('\n')}
</main></body></html>
`,
  )
  console.log(`wrote ${join(out, 'print-sheet.html')}`)
}

if (withArt) {
  let fetched = 0
  let missing = 0
  for (const name of cards) {
    const file = join(out, `${slug(name)}.jpg`)
    if (existsSync(file)) continue
    const img = await fetch(artUrl(name))
    if (!img.ok) {
      missing++
      console.warn(`[no art] ${name}`)
      continue
    }
    writeFileSync(file, Buffer.from(await img.arrayBuffer()))
    fetched++
  }
  console.log(`card art: downloaded ${fetched}, missing ${missing}`)
}

console.log(`done: ${join(out, 'cards.json')}`)
