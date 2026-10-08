#!/usr/bin/env node
// Parse the scraped postgraduate lists (M.Tech tables + PhD profile cards copied from the
// institute site) into roster rows and optionally upload them to the `students` table
// (migration 22).
//
//   node scripts/import-postgrad.mjs <mtech.html> <phd.html> [--out <file.json>] [--upload]
//
// M.Tech: <tr><td>S.No.</td><td>MT26001</td><td>Name</td><td>Program</td></tr> per batch.
//         Rolls are MT + year + number, so the batch comes from the roll itself; the
//         admission flavour in Program (Gate / Non-Gate / Research) folds into the
//         department CSE | ECE | CB, the only spellings is_cohort_valid() accepts for MTECH.
// PhD:    one card per student: data-course, <h3>name</h3>, then "Since <Mon> YY",
//         research area, email. PhDs have no roll number on the site, so their IIITD
//         address is the roster id (students_roll_no_check) - and, because it is real,
//         profiles.student_id stays NULL for them (see migration 22).
// Output: JSON array of { roll_no, name, program, batch, degree_level } next to the M.Tech
//         input. The roster is personal data: it lives in Supabase, never in git.
// Upload: upserts in batches through PostgREST with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//         from the root .env (service role only; players can't read the table).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cleanName, uploadAll } from './lib/roster.mjs'

const args = process.argv.slice(2)
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
const [mtechFile, phdFile] = positional
if (!mtechFile || !phdFile) {
  console.error('usage: node scripts/import-postgrad.mjs <mtech.html> <phd.html> [--out <file.json>] [--upload]')
  process.exit(1)
}
const outIdx = args.indexOf('--out')
const out = outIdx >= 0 ? args[outIdx + 1] : join(dirname(resolve(mtechFile)), 'postgrad.roster.json')
const upload = args.includes('--upload')

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ')

function parseMtech(html) {
  const rows = new Map()
  const problems = []
  // Commented-out tables are lists the site no longer shows (roll/name only, no program).
  const clean = html.replace(/<!--[\s\S]*?-->/g, '')
  const rowRe = /<tr>\s*<td>[^<]*<\/td>\s*<td>(MT\d{5})<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi
  for (const row of clean.matchAll(rowRe)) {
    const roll = row[1].toUpperCase()
    const name = cleanName(stripTags(row[2]))
    const program = /(?:^|[\s-])(CSE|ECE|CB)(?:$|[\s-])/i.exec(stripTags(row[3]).trim())?.[1]?.toUpperCase()
    const batch = 2000 + Number(roll.slice(2, 4))
    if (!name) { problems.push(`no name for ${roll}`); continue }
    if (!program) { problems.push(`unknown program "${row[3].trim()}" for ${roll}`); continue }
    if (batch < 2000 || batch > 2100) { problems.push(`bad batch for ${roll}`); continue }
    // The same roll can appear in two batches; the first listing wins (as for B.Tech).
    if (rows.has(roll)) { problems.push(`${roll} listed twice; keeping ${rows.get(roll).batch}`); continue }
    rows.set(roll, { roll_no: roll, name, program, batch, degree_level: 'MTECH' })
  }
  return { rows: [...rows.values()], problems }
}

const PHD_COURSES = new Set(['CSE', 'CB', 'ECE', 'SSH', 'MATHEMATICS', 'HCD'])
// The site mistypes four addresses; they are the login id, so fix them on the way in.
const EMAIL_FIXES = new Map([
  ['iitd.ac.in', 'iiitd.ac.in'],
  ['iiit.ac.in', 'iiitd.ac.in'],
  ['iiitd.ac.ain', 'iiitd.ac.in'],
])

function parsePhd(html) {
  const rows = new Map()
  const problems = []
  const cardRe = /data-course="([^"]*)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>\s*<div class="text-center mb-4">\s*((?:\s*<p class="mb-2">[\s\S]*?<\/p>)*)/g
  for (const card of html.matchAll(cardRe)) {
    const course = card[1].trim().toUpperCase()
    const name = cleanName(card[2])
    const paragraphs = [...card[3].matchAll(/<p class="mb-2">([\s\S]*?)<\/p>/g)].map((p) => p[1].trim())
    const since = paragraphs.find((p) => /\b(?:since|sine)\b/i.test(p)) ?? ''
    const email = (paragraphs.find((p) => p.includes('@')) ?? '').toLowerCase().replace(/\s+/g, '')
    const year = /\b(?:since|sine)\s+\S+\s+(\d{2,4})\b/i.exec(since)?.[1]
    const batch = year ? (year.length === 2 ? 2000 + Number(year) : Number(year)) : NaN
    if (!name) { problems.push(`no name for ${email || course}`); continue }
    if (!PHD_COURSES.has(course)) { problems.push(`unknown course "${card[1]}" for ${name}`); continue }
    if (!year || batch < 2000 || batch > 2100) { problems.push(`no start year for ${name} ("${since}")`); continue }
    const [local, domain] = email.split('@')
    if (!local || !domain) { problems.push(`no email for ${name}`); continue }
    const fixed = EMAIL_FIXES.get(domain) ?? domain
    if (fixed !== domain) {
      console.log(`[fix] ${domain} -> ${fixed} (${name})`)
    }
    const id = `${local}@${fixed}`
    if (!/^[^@\s]+@iiitd\.ac\.in$/.test(id)) { problems.push(`"${id}" is not an IIITD address (${name})`); continue }
    if (rows.has(id)) { problems.push(`${id} listed twice; keeping ${rows.get(id).name}`); continue }
    rows.set(id, { roll_no: id, name, program: course, batch, degree_level: 'PHD' })
  }
  return { rows: [...rows.values()], problems }
}

const mtech = parseMtech(readFileSync(mtechFile, 'utf8'))
const phd = parsePhd(readFileSync(phdFile, 'utf8'))
const students = [...mtech.rows, ...phd.rows]
for (const p of [...mtech.problems, ...phd.problems]) console.warn(`[skip] ${p}`)

const summary = { degree: {}, program: {}, batch: {} }
for (const s of students) {
  summary.degree[s.degree_level] = (summary.degree[s.degree_level] ?? 0) + 1
  summary.program[`${s.degree_level}/${s.program}`] = (summary.program[`${s.degree_level}/${s.program}`] ?? 0) + 1
  summary.batch[s.batch] = (summary.batch[s.batch] ?? 0) + 1
}
console.log(`${students.length} postgraduate students`)
console.log('by degree:', summary.degree)
console.log('by program:', summary.program)
console.log('by batch:', summary.batch)
writeFileSync(out, JSON.stringify(students, null, 1) + '\n')
console.log(`wrote ${out}`)
if (upload) await uploadAll(students)
