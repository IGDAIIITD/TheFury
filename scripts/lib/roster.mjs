// Shared helpers for the roster importers (`import-students.mjs`, `import-postgrad.mjs`).
// The roster is personal data: JSON output lives next to the scraped input (gitignored) and
// only ever reaches Supabase through the service role.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')

/**
 * "Aayushi  ." -> "Aayushi"; collapses the double spaces the site uses between names and
 * title-cases the older batches, which are listed in capitals ("NIKHIL" -> "Nikhil").
 */
export function cleanName(raw) {
  const words = decode(raw).split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  const shouting = words.every((w) => w === w.toUpperCase())
  return words
    .map((w) => (shouting ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(' ')
    .trim()
}

/** Root .env as a plain object; process.env wins when already set. */
export function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
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

/** Upsert rows through PostgREST in batches (service role). */
export async function uploadAll(rows, table = 'students', conflict = 'roll_no') {
  const env = loadEnv()
  const url = env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (root .env)')
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) throw new Error(`upload failed at row ${i}: ${res.status} ${await res.text()}`)
    console.log(`uploaded ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }
}
