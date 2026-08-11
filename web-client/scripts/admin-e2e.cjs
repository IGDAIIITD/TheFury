/* eslint-disable no-console */
/*
 * Admin console E2E driver: logs in the seeded admin account and exercises the
 * Phase 9 admin APIs (events CRUD, spawn minting, player ban/unban/role, audit
 * feed) plus the player-facing events/feed endpoints and the admin-role gate.
 *
 * Run from web-client/ so it can resolve node_modules (it only needs global
 * fetch, so node >= 18 is enough):
 *   node scripts/admin-e2e.cjs
 *
 * Prereqs: backend running; DB seeded with admin@campus.edu / password123
 * (see setup/seed_admin.sql) and the demo catalog/players. The script is
 * state-agnostic: it creates and then deletes its own throwaway event.
 *
 * Env:
 *   BASE   API base, default http://localhost:17172
 */

const BASE = process.env.BASE || 'http://localhost:17172'
const PW = 'password123'
const ADMIN = { email: 'admin@campus.edu' }
const TARGET = { email: 'testbattle@campus.edu' }

let failures = 0
let passes = 0

function check(label, cond, extra = '') {
  if (cond) {
    passes++
    console.log(`  ok   ${label} ${extra}`)
  } else {
    failures++
    console.log(`  FAIL ${label} ${extra}`)
  }
}

async function api(path, method, token, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = new Error(`${method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
    err.status = res.status
    err.body = data
    throw err
  }
  return data
}

async function login(email) {
  return api('/auth/login', 'POST', null, { email, password: PW })
}

function iso(hoursFromNow) {
  const d = new Date(Date.now() + hoursFromNow * 3600_000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

async function main() {
  console.log(`[admin-e2e] base=${BASE}`)

  // ---- admin login + role gate ----
  const adminLogin = await login(ADMIN.email)
  const adminToken = adminLogin.token
  check('admin logs in with ROLE_ADMIN', adminLogin.player.role === 'ROLE_ADMIN')

  const playerLogin = await login(TARGET.email)
  const playerToken = playerLogin.token
  try {
    await api('/admin/events', 'GET', playerToken)
    check('non-admin is blocked from admin endpoints', false)
  } catch (err) {
    check('non-admin is blocked from admin endpoints', err.status === 403, `(status=${err.status})`)
  }

  // ---- events CRUD ----
  const evName = `E2E Event ${Date.now()}`
  const created = await api('/admin/events', 'POST', adminToken, {
    name: evName,
    allowedSets: ['M19', 'UNLIMITED'],
    bonusMultiplier: 2.5,
    startTime: iso(-1),
    endTime: iso(24),
  })
  check('admin creates an event', created.id && created.bonusMultiplier === 2.5, `(id=${created.id})`)

  const updated = await api(`/admin/events/${created.id}`, 'PUT', adminToken, {
    name: evName,
    allowedSets: ['M19'],
    bonusMultiplier: 3,
    startTime: iso(-1),
    endTime: iso(24),
  })
  check('admin updates the event', updated.bonusMultiplier === 3 && updated.allowedSets.join() === 'M19')

  const active = await api('/events/active', 'GET', adminToken)
  check('live event appears in /events/active', active.some((e) => e.id === created.id))

  // ---- spawn minting ----
  const cards = await api('/cards', 'GET', adminToken)
  const target = cards.find((c) => c.ownershipType === 'UNLIMITED' && c.forgeName !== 'Forest' && c.forgeName !== 'Mountain') || cards.find((c) => c.ownershipType === 'UNLIMITED')
  const claims = await api('/admin/claims', 'POST', adminToken, {
    cardId: target.id,
    quantity: 2,
    building: 'E2E Hall',
    eventId: created.id,
  })
  check('admin mints spawn tokens', claims.length === 2, `(count=${claims.length})`)
  check('spawn is tagged with the event', claims.every((c) => c.eventId === created.id && c.eventName === evName))
  const spawnToken = claims[0].token
  check('spawn token is a non-empty qr token', typeof spawnToken === 'string' && spawnToken.length > 0)

  // ---- audit feed reflects event + spawn activity ----
  const audit = await api('/admin/audit', 'GET', adminToken)
  check('audit shows the event lifecycle entry', audit.some((e) => e.message.includes(evName)))
  check('audit shows the spawn entry', audit.some((e) => e.message.includes('spawned 2 token(s)') && e.message.includes(target.forgeName)))

  // ---- player ban / unban / role ----
  const search = await api('/admin/players?q=testbattle', 'GET', adminToken)
  const targetPlayer = search.find((p) => p.email === TARGET.email)
  check('player search finds the target', !!targetPlayer, `(id=${targetPlayer?.id})`)

  const banned = await api(`/admin/players/${targetPlayer.id}/ban`, 'POST', adminToken)
  check('admin bans the player', banned.banned === true)
  try {
    await login(TARGET.email)
    check('banned player cannot log in', false)
  } catch (err) {
    check('banned player cannot log in', err.status === 403, `(status=${err.status})`)
  }

  const unbanned = await api(`/admin/players/${targetPlayer.id}/unban`, 'POST', adminToken)
  check('admin unbans the player', unbanned.banned === false)

  const promoted = await api(`/admin/players/${targetPlayer.id}/role`, 'POST', adminToken, { role: 'ROLE_ADMIN' })
  check('admin promotes the player', promoted.role === 'ROLE_ADMIN')
  const demoted = await api(`/admin/players/${targetPlayer.id}/role`, 'POST', adminToken, { role: 'ROLE_PLAYER' })
  check('admin demotes the player back', demoted.role === 'ROLE_PLAYER')

  // ---- player-facing feed + events ----
  const feed = await api('/feed', 'GET', playerToken)
  check('player feed endpoint returns entries', Array.isArray(feed))

  // ---- cleanup: delete the throwaway event ----
  await api(`/admin/events/${created.id}`, 'DELETE', adminToken)
  const afterDelete = await api('/events', 'GET', adminToken)
  check('event deleted', !afterDelete.some((e) => e.id === created.id))

  console.log(`\n[admin-e2e] ${passes} passed, ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[admin-e2e] fatal:', err.message)
  process.exit(1)
})
