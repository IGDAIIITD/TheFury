// The one-paste SQL_EDITOR_SETUP.sql must be current and must bootstrap a
// working project on its own.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { as, check, done, REPO, signUp } from './harness.mjs'
import { buildSetupSql } from './build-setup-sql.mjs'

console.log('\n# SQL_EDITOR_SETUP.sql')
const file = readFileSync(join(REPO, 'supabase/SQL_EDITOR_SETUP.sql'), 'utf8').replace(/\r\n/g, '\n')
check('matches migrations + seed (regenerate with build-setup-sql.mjs)', file === buildSetupSql())

const db = await PGlite.create({ extensions: { pgcrypto } })
await db.exec(readFileSync(new URL('./shim.sql', import.meta.url), 'utf8'))
let applied = true
try {
  await db.exec(file)
} catch (e) {
  applied = false
  console.log('   ', e.message)
}
check('applies cleanly to a fresh database', applied)

const uid = await signUp(db, 'fresh@campus.edu', { display_name: 'Fresh' })
const deck = await db.query(`select sum(dc.quantity)::int as n from public.decks d join public.deck_cards dc on dc.deck_id = d.id where d.player_id = $1`, [uid])
check('fresh signup receives the 60-card starter deck', deck.rows[0].n === 60)
const r = await as(db, 'anon', null, `select public.apply_claim('X', '${uid}')`)
check('service-only RPCs are locked down', !r.ok && /permission denied/.test(r.error), r.error)

done()
