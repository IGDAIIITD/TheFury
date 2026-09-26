// PGlite harness: Supabase platform shim + repo migrations + seed, and helpers to
// run SQL as anon / authenticated / service_role. No Docker needed.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIG = join(REPO, 'supabase/migrations')

/** seed.sql (base catalog) then supabase/seed_sets/*.sql (imported sets), in order. */
export function seedFiles() {
  const setsDir = join(REPO, 'supabase/seed_sets')
  const sets = existsSync(setsDir) ? readdirSync(setsDir).filter((f) => f.endsWith('.sql')).sort() : []
  return [join(REPO, 'supabase/seed.sql'), ...sets.map((f) => join(setsDir, f))]
}

export async function boot({ upTo = null, seed = true, skip = [] } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(readFileSync(new URL('./shim.sql', import.meta.url), 'utf8'))
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    if (upTo && f > upTo) break
    if (skip.some((s) => f.includes(s))) continue
    try {
      await db.exec(readFileSync(join(MIG, f), 'utf8'))
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e.message}`)
    }
  }
  if (seed) {
    for (const file of seedFiles()) await db.exec(readFileSync(file, 'utf8'))
  }
  return db
}

/**
 * Sign up a user the way GoTrue does (insert into auth.users fires handle_new_user).
 * `appMeta` is app_metadata, which only the admin API (service role) can set.
 */
export async function signUp(db, email, meta = {}, appMeta = {}) {
  const id = crypto.randomUUID()
  await db.query(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4)`, [id, email, meta, appMeta])
  return id
}

/** Run fn inside a transaction as an API role (anon/authenticated/service_role). Always rolls back role. */
export async function as(db, role, uid, sql, params = []) {
  await db.exec('begin')
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [uid ?? '', role])
    await db.exec(`set local role ${role}`)
    const res = await db.query(sql, params)
    await db.exec('commit')
    return { ok: true, rows: res.rows, affected: res.affectedRows }
  } catch (e) {
    await db.exec('rollback')
    return { ok: false, error: e.message, code: e.code }
  }
}

let failures = 0
export function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name} ${detail}`)
  }
}
export function done() {
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED')
  process.exit(failures ? 1 : 0)
}
