#!/usr/bin/env node
// Parse the IIITD student list (an HTML fragment copied from the institute site) into a clean
// roster and optionally upload it to the `students` table (migration 18).
//
//   node scripts/import-students.mjs <student-list.html> [--out <file.json>] [--upload]
//
// Input:  one <h3>B.Tech. <year></h3> + <table> per batch, rows
//         <tr><td>S. No.</td><td>Roll No.</td><td>Student Name</td><td>Program</td></tr>
// Output: JSON array of { roll_no, name, program, batch, degree_level } (default: next to the
//         input as students.json). The roster is personal data: keep it out of git.
// Upload: upserts in batches through PostgREST with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//         from the root .env (service role only; players can't read the table).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const input = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out')
if (!input) {
  console.error('usage: node scripts/import-students.mjs <student-list.html> [--out <file.json>] [--upload]')
  process.exit(1)
}
const outIdx = args.indexOf('--out')
const out = outIdx >= 0 ? args[outIdx + 1] : join(dirname(resolve(input)), 'students.json')
const upload = args.includes('--upload')

// Catalog spellings -> the cohort codes is_cohort_valid() accepts.
const PROGRAMS = { CSE: 'CSE', CSAI: 'CSAI', CSAM: 'CSAM', CSB: 'CSB', CSD: 'CSD', CSSS: 'CSSS', ECE: 'ECE', EVE: 'EVE', CSECON: 'CSECON' }

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')

/**
 * "Aayushi  ." -> "Aayushi"; collapses the double spaces the site uses between names and
 * title-cases the older batches, which are listed in capitals ("NIKHIL" -> "Nikhil").
 */
function cleanName(raw) {
  const words = decode(raw).split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  const shouting = words.every((w) => w === w.toUpperCase())
  return words
    .map((w) => (shouting ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(' ')
    .trim()
}

function parse(html) {
  const students = new Map()
  const problems = []
  // Split into batches at each heading; rows before the first heading are ignored.
  // Commented-out rows are students the site no longer lists; drop them.
  const sections = html.replace(/<!--[\s\S]*?-->/g, '').split(/<h3>/i).slice(1)
  for (const section of sections) {
    const heading = section.slice(0, section.indexOf('</h3>'))
    const m = /(B\.?\s*Tech|M\.?\s*Tech)\.?\s*(\d{4})/i.exec(heading)
    if (!m) {
      problems.push(`unrecognised heading: ${heading.trim()}`)
      continue
    }
    const degree = /^m/i.test(m[1]) ? 'MTECH' : 'BTECH'
    const batch = Number(m[2])
    for (const row of section.matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi)) {
      const roll = row[2].trim()
      const name = cleanName(row[3])
      const program = PROGRAMS[row[4].trim().toUpperCase()]
      if (!/^\d{7}$/.test(roll)) { problems.push(`bad roll "${roll}" (${name})`); continue }
      if (!name) { problems.push(`no name for ${roll}`); continue }
      if (!program) { problems.push(`unknown program "${row[4]}" for ${roll}`); continue }
      // Students who repeat a year appear in two batches; the newest (listed first) wins.
      if (students.has(roll)) { problems.push(`${roll} also listed in ${batch}; keeping ${students.get(roll).batch}`); continue }
      students.set(roll, { roll_no: roll, name, program, batch, degree_level: degree })
    }
  }
  return { students: [...students.values()], problems }
}

function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
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

async function uploadAll(students) {
  const env = loadEnv()
  const url = env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (root .env)')
  const BATCH = 500
  for (let i = 0; i < students.length; i += BATCH) {
    const chunk = students.slice(i, i + BATCH)
    const res = await fetch(`${url}/rest/v1/students?on_conflict=roll_no`, {
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
    console.log(`uploaded ${Math.min(i + BATCH, students.length)}/${students.length}`)
  }
}

const { students, problems } = parse(readFileSync(input, 'utf8'))
for (const p of problems) console.warn(`[skip] ${p}`)
const byBatch = {}
for (const s of students) byBatch[s.batch] = (byBatch[s.batch] ?? 0) + 1
console.log(`${students.length} students`, byBatch)
writeFileSync(out, JSON.stringify(students, null, 1) + '\n')
console.log(`wrote ${out}`)
if (upload) await uploadAll(students)
