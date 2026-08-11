/* eslint-disable no-console */
/*
 * Campus Forge ecosystem E2E driver: exercises the Phase 10 hardening and
 * analytics surface on a live backend — auth header hygiene (no-store), admin
 * role gating, rate limiting, signed QR claim tokens (mint -> claim -> tamper
 * rejection), legacy bare-core claim resolution, and the player-facing
 * analytics endpoints (popular decks, active buildings, buildings visited).
 *
 * Run from web-client/ (node >= 18 has global fetch):
 *   node scripts/ecosystem-e2e.cjs
 *
 * Prereqs: backend running; DB seeded with admin@campus.edu and
 * testbattle@campus.edu (password123) plus the demo catalog. State-agnostic:
 * every minted token is unique, so re-runs are safe.
 *
 * Env:
 *   BASE   API base, default http://localhost:17172
 */

const BASE = process.env.BASE || 'http://localhost:17172'
const PW = 'password123'
const ADMIN = { email: 'admin@campus.edu' }
const PLAYER = { email: 'testbattle@campus.edu' }
const SIGNED_RE = /^V1\.[A-Z2-9]{12}\.[0-9A-F]{64}$/

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

async function rawApi(path, method, token, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data, headers: res.headers }
}

async function api(path, method, token, body) {
  const { status, data } = await rawApi(path, method, token, body)
  if (status < 200 || status >= 300) {
    const err = new Error(`${method || 'GET'} ${path} -> ${status}: ${JSON.stringify(data)}`)
    err.status = status
    err.body = data
    throw err
  }
  return data
}

async function login(email) {
  return api('/auth/login', 'POST', null, { email, password: PW })
}

async function main() {
  console.log(`[ecosystem-e2e] base=${BASE}`)

  // ---- auth header hygiene ----
  const loginRes = await rawApi('/auth/login', 'POST', null, { email: ADMIN.email, password: PW })
  check('login succeeds', loginRes.status === 200, `(status=${loginRes.status})`)
  check(
    'login response carries Cache-Control: no-store',
    (loginRes.headers.get('cache-control') || '').toLowerCase().includes('no-store'),
    `(cache-control=${loginRes.headers.get('cache-control')})`,
  )
  const adminToken = loginRes.data.token
  const playerLogin = await login(PLAYER.email)
  const playerToken = playerLogin.token

  // ---- authz / authn gates ----
  const adminGate = await rawApi('/admin/events', 'GET', playerToken)
  check('player on /admin/** -> 403', adminGate.status === 403, `(status=${adminGate.status})`)
  const anonGate = await rawApi('/analytics/decks', 'GET', null)
  check('anonymous analytics -> 401', anonGate.status === 401, `(status=${anonGate.status})`)
  const badTokenGate = await rawApi('/leaderboard', 'GET', 'garbage.token.value')
  check('garbage bearer token -> 401', badTokenGate.status === 401, `(status=${badTokenGate.status})`)

  // ---- analytics ----
  const decks = await api('/analytics/decks?limit=5', 'GET', playerToken)
  const buildings = await api('/analytics/buildings?limit=5', 'GET', playerToken)
  check('popular decks is an array', Array.isArray(decks))
  check('active buildings is an array', Array.isArray(buildings))
  if (buildings.length > 0) {
    check('building entries carry counts', buildings.every((b) => typeof b.building === 'string' && b.claimCount > 0))
  }
  const stats = await api('/players/me/stats', 'GET', playerToken)
  check('stats include buildingsVisited', Array.isArray(stats.buildingsVisited))

  // ---- signed QR tokens ----
  const cards = await api('/cards', 'GET', playerToken)
  const target =
    cards.find((c) => c.ownershipType === 'UNLIMITED' && c.forgeName !== 'Forest' && c.forgeName !== 'Mountain') ||
    cards.find((c) => c.ownershipType === 'UNLIMITED')
  const minted = await api('/admin/claims', 'POST', adminToken, {
    cardId: target.id,
    quantity: 1,
    building: 'Ecosystem Hall',
  })
  const signed = minted[0].token
  check('minted token is a signed V1 payload', SIGNED_RE.test(signed), `(${signed.slice(0, 20)}…)`)
  const core = signed.split('.')[1]

  const claimRes = await rawApi('/claim', 'POST', playerToken, { token: signed })
  check('signed token claims successfully', claimRes.status === 200, `(status=${claimRes.status})`)
  check('claim result echoes the signed token', claimRes.data?.token === signed)

  const tampered = signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A')
  const tamperRes = await rawApi('/claim', 'POST', playerToken, { token: tampered })
  check('tampered signature -> 400', tamperRes.status === 400, `(status=${tamperRes.status})`)

  const forged = `V1.${core}.${'A'.repeat(64)}`
  const forgedRes = await rawApi('/claim', 'POST', playerToken, { token: forged })
  check('forged signature -> 400', forgedRes.status === 400, `(status=${forgedRes.status})`)

  const coreRes = await rawApi('/claim', 'POST', playerToken, { token: core })
  check('bare core resolves to the same claim', coreRes.status === 200, `(status=${coreRes.status})`)

  const legacyRes = await rawApi('/claim', 'POST', playerToken, { token: 'ZZZZZZZZZZZZ' })
  check('unknown bare-core (legacy) token -> 404', legacyRes.status === 404, `(status=${legacyRes.status})`)

  // ---- rate limiting (kept last: drains the per-IP auth bucket) ----
  let limited = 0
  let sawRetryAfter = false
  for (let i = 0; i < 30; i++) {
    const res = await rawApi('/auth/login', 'POST', null, { email: ADMIN.email, password: PW })
    if (res.status === 429) {
      limited++
      if (res.headers.get('retry-after')) sawRetryAfter = true
    }
  }
  check('auth burst is rate limited (some 429s)', limited > 0, `(429s=${limited})`)
  check('429 responses carry Retry-After', sawRetryAfter)

  console.log(`\n[ecosystem-e2e] ${passes} passed, ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[ecosystem-e2e] fatal:', err.message)
  process.exit(1)
})
