/* eslint-disable no-console */
/*
 * Trade E2E driver: logs in the two seeded demo users, exercises the full
 * unique-card trade lifecycle over the REST API, then proves the atomic
 * accept race (two concurrent accepts of the same card => exactly one wins).
 *
 * Run from web-client/ so it can resolve node_modules:
 *   node scripts/trade-e2e.cjs
 *
 * Prereqs: backend running; DB seeded with testbattle@campus.edu /
 * opponent@campus.edu (pw password123), each owning unique cards
 * (see setup/seed_unique_cards.sql). The script is state-agnostic: it
 * picks cards per current ownership, so it survives earlier trades.
 *
 * Env:
 *   BASE   API base, default http://localhost:17172
 */

const BASE = process.env.BASE || 'http://localhost:17172'
const PW = 'password123'

const A = { email: 'testbattle@campus.edu', name: 'BattleTest' }
const B = { email: 'opponent@campus.edu', name: 'Opponent' }

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
  const res = await api('/auth/login', 'POST', null, { email, password: PW })
  return res.token
}

async function uniques(token) {
  return api('/collection/unique', 'GET', token)
}

function uuidOf(cards, forgeName) {
  const c = cards.find((c) => c.forgeName === forgeName)
  return c ? c.physicalUuid : null
}

async function main() {
  console.log(`[trade-e2e] base=${BASE}`)
  const tokenA = await login(A.email)
  const tokenB = await login(B.email)
  check('both demo users log in', !!tokenA && !!tokenB)

  let mineA = await uniques(tokenA)
  let mineB = await uniques(tokenB)
  check(`A owns ${mineA.length} unique cards`, mineA.length >= 2)
  check(`B owns ${mineB.length} unique cards`, mineB.length >= 2)

  const aName = mineA[0].forgeName
  const bName = mineB[0].forgeName
  const aUuid = mineA[0].physicalUuid
  const bUuid = mineB[0].physicalUuid

  // ---- happy path: A offers a card for B's card, B accepts ----
  const created = await api('/trades', 'POST', tokenA, {
    receiverId: (await api('/auth/me', 'GET', tokenB)).id,
    offeredPhysicalUuids: [aUuid],
    requestedPhysicalUuids: [bUuid],
  })
  check('trade created as PENDING', created.status === 'PENDING', `(id=${created.id})`)

  const incoming = await api('/trades/incoming', 'GET', tokenB)
  check('B sees the incoming offer', incoming.some((t) => t.id === created.id && t.status === 'PENDING'))

  const accepted = await api(`/trades/${created.id}/accept`, 'POST', tokenB)
  check('B accepts -> ACCEPTED', accepted.status === 'ACCEPTED')

  const afterA = await uniques(tokenA)
  const afterB = await uniques(tokenB)
  check(`A now owns ${bName}`, afterA.some((c) => c.physicalUuid === bUuid))
  check(`B now owns ${aName}`, afterB.some((c) => c.physicalUuid === aUuid))
  const histA = afterA.find((c) => c.physicalUuid === bUuid)
  check('history records the trade', (histA?.history || '').includes('via trade'), `(${histA?.history?.split('\n').pop() || ''})`)

  // ---- decline path ----
  const dCreated = await api('/trades', 'POST', tokenA, {
    receiverId: (await api('/auth/me', 'GET', tokenB)).id,
    offeredPhysicalUuids: [uuidOf(afterA, aName) || afterA[1].physicalUuid],
    requestedPhysicalUuids: [uuidOf(afterB, bName) || afterB[1].physicalUuid],
  })
  const declined = await api(`/trades/${dCreated.id}/decline`, 'POST', tokenB)
  check('B declines -> DECLINED', declined.status === 'DECLINED')

  // ---- race: two concurrent accepts of the same card, exactly one wins ----
  mineA = await uniques(tokenA)
  mineB = await uniques(tokenB)
  const raceA = mineA[0].physicalUuid
  const raceB = mineB[0].physicalUuid
  const beforeHist = (mineA.find((c) => c.physicalUuid === raceA)?.history || '')
  const beforeTrades = (beforeHist.match(/via trade/g) || []).length
  const r1 = await api('/trades', 'POST', tokenA, {
    receiverId: (await api('/auth/me', 'GET', tokenB)).id,
    offeredPhysicalUuids: [raceA],
    requestedPhysicalUuids: [raceB],
  })
  const r2 = await api('/trades', 'POST', tokenA, {
    receiverId: (await api('/auth/me', 'GET', tokenB)).id,
    offeredPhysicalUuids: [raceA],
    requestedPhysicalUuids: [raceB],
  })
  check('two competing trades created (both PENDING)', r1.status === 'PENDING' && r2.status === 'PENDING')

  const results = await Promise.allSettled([
    api(`/trades/${r1.id}/accept`, 'POST', tokenB),
    api(`/trades/${r2.id}/accept`, 'POST', tokenB),
  ])
  const okCount = results.filter((r) => r.status === 'fulfilled' && r.value.status === 'ACCEPTED').length
  const conflictCount = results.filter(
    (r) => r.status === 'rejected' && (r.reason.status === 409 || r.reason.status === 410),
  ).length
  check('exactly one accept wins the race', okCount === 1, `(ok=${okCount}, conflict=${conflictCount})`)

  const finalA = await uniques(tokenA)
  const finalB = await uniques(tokenB)
  check('raced card ended up with B exactly once', finalB.some((c) => c.physicalUuid === raceA))
  check('raced card no longer with A', !finalA.some((c) => c.physicalUuid === raceA))
  const racedCard = finalB.find((c) => c.physicalUuid === raceA)
  const tradeMarks = (racedCard?.history || '').match(/via trade/g)
  check('ownership history appended exactly once', tradeMarks && tradeMarks.length === beforeTrades + 1)

  console.log(`\n[trade-e2e] ${passes} passed, ${failures} failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[trade-e2e] fatal:', err.message)
  process.exit(1)
})
