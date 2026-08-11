/* eslint-disable no-console */
/*
 * Battle E2E driver: logs in two test users, starts a lobby -> join, then
 * plays a real game over raw WebSocket/STOMP until a player wins.
 *
 * Run from web-client/ so it can resolve node_modules:
 *   node scripts/battle-e2e.cjs
 *
 * Set BASE to the frontend host (through the Deno proxy) or the backend port.
 */
const WebSocket = require('faye-websocket').Client

const BASE = process.env.BASE || 'http://192.168.194.106:17170'
const WS_URL = process.env.WS_URL || BASE.replace(/^http/, 'ws') + '/ws/match'
const PW = 'password123'

const A = { email: 'testbattle@campus.edu', name: 'BattleTest' }
const B = { email: 'opponent@campus.edu', name: 'Opponent' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    throw new Error(`${method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
  }
  return data
}

// ---- minimal STOMP client over a raw WebSocket ----
class StompClient {
  constructor(url, headers) {
    this.url = url
    this.headers = headers
    this.buffer = ''
    this.frameHandlers = new Map() // type -> [fn]
    this.topicHandlers = new Map() // destination -> [fn]
    this.connected = new Promise((resolve, reject) => {
      this._resolveConnected = resolve
      this._rejectConnected = reject
    })
  }

  connect() {
    this.ws = new WebSocket(this.url)
    this.ws.on('open', () => {
      this._send(`CONNECT\naccept-version:1.2\nheart-beat:0,0\n${this.headers.join('\n')}\n\n`)
    })
    this.ws.on('message', (event) => this._onData(String(event.data)))
    this.ws.on('error', (err) => this._rejectConnected(err))
    this.ws.on('close', () => {})
    return this.connected
  }

  _send(body) {
    this.ws.send(body + '\u0000')
  }

  on(type, fn) {
    if (!this.frameHandlers.has(type)) this.frameHandlers.set(type, [])
    this.frameHandlers.get(type).push(fn)
  }

  onTopic(dest, fn) {
    if (!this.topicHandlers.has(dest)) this.topicHandlers.set(dest, [])
    this.topicHandlers.get(dest).push(fn)
  }

  subscribe(dest, id) {
    this._send(`SUBSCRIBE\ndestination:${dest}\nid:${id}\nack:auto\n\n`)
  }

  send(dest, body) {
    this._send(`SEND\ndestination:${dest}\ncontent-type:application/json\n\n${body}`)
  }

  _onData(chunk) {
    this.buffer += chunk
    let idx
    while ((idx = this.buffer.indexOf('\u0000')) >= 0) {
      const raw = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      this._handleFrame(raw)
    }
  }

  _handleFrame(raw) {
    if (!raw.trim()) return
    const [cmdLine, ...rest] = raw.split('\n')
    const headers = {}
    let body = ''
    let inBody = false
    for (const line of rest) {
      if (inBody) {
        body += line
      } else if (line === '') {
        inBody = true
      } else {
        const i = line.indexOf(':')
        if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1)
      }
    }
    if (cmdLine === 'CONNECTED') {
      this._resolveConnected()
    }
    const handlers = this.frameHandlers.get(cmdLine)
    if (handlers) for (const fn of handlers) fn(headers, body)
    if (cmdLine === 'MESSAGE' && headers.destination) {
      const subs = this.topicHandlers.get(headers.destination)
      if (subs) for (const fn of subs) fn(JSON.parse(body))
    }
  }

  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

// ---- game decision bot ----
// strategy: 'mirror' = block everything (deck-out wars), 'smash' = never block (damage races)
function chooseFor(state, meName, oppName, submit, strategy) {
  const pc = state.pendingChoice
  if (!pc) return
  const prompt = pc.prompt
  const opts = pc.options.map((o) => o.label)
  const p = prompt.toLowerCase()

  // who plays first -> player 1 (index 0); the joiner (seat 1) is asked
  if (p.includes('plays first') || p.includes('who goes first') || p.includes('starting player')) {
    console.log(`   [${meName}] who plays first -> ${opts[0]}`)
    return submit(pc.requestId, [0])
  }

  // mulligan -> keep
  if (p.includes('keep') || p.includes('mulligan')) {
    console.log(`   [${meName}] mulligan -> keep`)
    return submit(pc.requestId, [0])
  }

  // attackers -> attack with everything
  if (p.includes('attack') || p.includes('attacker')) {
    console.log(`   [${meName}] declare attackers: ${opts.join(', ')}`)
    return submit(pc.requestId, opts.map((_, i) => i))
  }

  // blockers -> block with everything (mirror) or nothing (smash)
  if (p.includes('block') || p.includes('blocker')) {
    if (strategy === 'smash') {
      console.log(`   [${meName}] pass on blockers`)
      return submit(pc.requestId, [])
    }
    console.log(`   [${meName}] declare blockers: ${opts.join(', ')}`)
    return submit(pc.requestId, opts.map((_, i) => i))
  }

  // targeting -> hit the opponent if present, else first option
  if (p.includes('target') || p.includes('choose targets') || p.includes('select target')) {
    const oppIdx = opts.findIndex((o) => o.includes(oppName) || o === 'P2' || o === 'P1')
    const choice = oppIdx >= 0 ? oppIdx : 0
    console.log(`   [${meName}] target -> ${opts[choice]}`)
    return submit(pc.requestId, [choice])
  }

  // a "play" decision -> land plays first (NOT mana-ability activations:
  // a battlefield Mountain appears as "Mountain - {T}: Add {R}." while a hand
  // land play is "Mountain - " with an empty description). Auto-tap handles mana.
  if (p.includes('play') || p.includes('cast') || p.includes('card')) {
    const pick = (names) => opts.findIndex((o) => names.some((n) => o.includes(n)))
    const tap = (o) => o.includes('{T}')
    // land plays from hand (label starts "<land> - " and has no tap text)
    let i = -1
    for (const name of ['Mountain', 'Forest']) {
      i = opts.findIndex((o) => o.startsWith(name + ' - ') && !tap(o))
      if (i >= 0) break
    }
    // creature spells from hand (not their {T} abilities)
    if (i < 0) {
      for (const name of ['Llanowar Elves', 'Raging Goblin', 'Grizzly Bears', 'Elvish Warrior', 'Elvish Archers', 'Goblin Piker', 'Goblin Mountaineer', 'Trained Armodon', 'Goblin Hero', 'Vulshok Berserker', 'Cudgel Troll', 'Giant Spider', 'War Mammoth', 'Hill Giant', 'Fire Elemental', 'Craw Wurm', 'Solemn Simulacrum']) {
        i = opts.findIndex((o) => o.startsWith(name + ' - ') && !tap(o))
        if (i >= 0) break
      }
    }
    // burn spells
    if (i < 0) i = pick(['Lightning Bolt', 'Shock'])
    if (i >= 0) {
      console.log(`   [${meName}] play ${opts[i]}`)
      return submit(pc.requestId, [i])
    }
    if (pc.cancellable) {
      console.log(`   [${meName}] pass (skip)`)
      return submit(pc.requestId, [])
    }
    console.log(`   [${meName}] forced choice, picking first: ${opts[0]}`)
    return submit(pc.requestId, [0])
  }

  // anything else -> prefer pass/skip, else first
  if (pc.cancellable) {
    console.log(`   [${meName}] skip "${prompt}"`)
    return submit(pc.requestId, [])
  }
  console.log(`   [${meName}] default choose first for "${prompt}"`)
  return submit(pc.requestId, [0])
}

async function main() {
  console.log('== Login ==')
  const a = await api('/auth/login', 'POST', null, { email: A.email, password: PW })
  const b = await api('/auth/login', 'POST', null, { email: B.email, password: PW })
  console.log(`   ${A.email} -> ${a.player.displayName} (${a.player.id})`)
  console.log(`   ${B.email} -> ${b.player.displayName} (${b.player.id})`)

  const pickDeck = (decks) => {
    const rg = decks.find((d) => d.name === 'RG Combat')
    return rg || decks[0]
  }
  const da = pickDeck((await api('/decks', 'GET', a.token)).decks)
  const db2 = pickDeck((await api('/decks', 'GET', b.token)).decks)
  console.log(`   decks: A=${da.name}, B=${db2.name}`)

  console.log('== Start battle (lobby -> join) ==')
  const lobby = await api('/battle/lobby', 'POST', a.token, { deckId: da.id })
  console.log(`   lobby ${lobby.id} code=${lobby.battleCode}`)
  const match = await api('/battle/join', 'POST', b.token, { code: lobby.battleCode, deckId: db2.id })
  console.log(`   joined -> status=${match.status} p1=${match.player1Id === a.player.id ? A.name : B.name}`)
  if (match.status !== 'ACTIVE') throw new Error('Expected ACTIVE match')

  console.log('== Connect STOMP (raw WebSocket) ==')
  const meIdx = match.player1Id === a.player.id ? 0 : 1
  const themIdx = 1 - meIdx
  const topics = {}
  const states = {}

  const conn = async (token, index, name, oppName) => {
    const c = new StompClient(WS_URL, [`Authorization:Bearer ${token}`])
    topics[index] = c
    c.onTopic(`/topic/match/${match.id}/p${index}`, (s) => {
      states[index] = s
      act(index, s)
    })
    await c.connect()
    c.subscribe(`/topic/match/${match.id}/p${index}`, `sub-${index}`)
  }

  const submit = (index) => (requestId, indices) => {
    const c = topics[index]
    if (!c) return
    c.send(`/app/match/${match.id}/action`, JSON.stringify({ actionType: 'CHOICE', payload: { requestId, selectedIndices: indices } }))
  }

  let decided = false
  let traceCount = 0
  let startChoiceSeenAt
  const submitted = new Map() // seat index -> Set of "requestId|prompt"
  const act = (index, s) => {
    if (decided || !s) return
    if (s.gameOver) {
      decided = true
      console.log(`\n== GAME OVER ==\n   winner=${s.winnerName} condition=${s.winCondition}`)
      for (const p of s.players || []) {
        console.log(`   ${p.name}: life=${p.life}`)
      }
      const lives = (s.players || []).map((p) => p.life)
      if (lives.length === 2 && lives.every((l) => l === 20)) {
        console.log('   NOTE: no combat damage landed (deck-out win)')
      }
      return
    }
    const pc = s.pendingChoice
    if (pc) {
      const key = `${pc.requestId}|${pc.prompt}`
      const seen = submitted.get(index) || new Set()
      if (!seen.has(key)) {
        seen.add(key)
        submitted.set(index, seen)
        const lp = (pc.prompt || '').toLowerCase()
        if (lp.includes('plays first') || lp.includes('who goes first') || lp.includes('starting player')) {
          if (startChoiceSeenAt === undefined) startChoiceSeenAt = index
        }
        chooseFor(s, index === meIdx ? A.name : B.name, index === meIdx ? B.name : A.name, submit(index), strategy)
      }
    }
    // board trace every 40th state
    const trace = s.players && s.players.length === 2 && (++traceCount % 40 === 0)
    if (trace) {
      const fmt = (p) => `L${p.life} BF=[${(p.battlefield || []).map((c) => `${c.name}${c.tapped ? 'T' : ''}`).join(',')}]`
      console.log(`   [board] turn=${s.turn} phase=${s.phase} ${fmt(s.players[0])} | ${fmt(s.players[1])}`)
    }
  }

  // 'smash' races damage to the face (attacks always, never blocks);
  // 'mirror' plays the deck-out grind (everything blocks).
  const strategy = process.env.STRATEGY || 'smash'
  console.log(`   strategy=${strategy}`)

  await Promise.all([
    conn(a.token, meIdx, A.name, B.name),
    conn(b.token, themIdx, B.name, A.name),
  ])
  console.log('   subscribed to both player topics')

  // Drive the game via WS messages, but poll REST as a rescue so a choice
  // published before we subscribed (or an engine startup stall) cannot
  // deadlock the run. Submissions are deduped by request id.
  const deadline = Date.now() + 150000
  const maxTurn = Number(process.env.MAX_TURN || 0)
  while (!decided && Date.now() < deadline) {
    for (const idx of [meIdx, themIdx]) {
      const tok = idx === meIdx ? a.token : b.token
      try {
        const s = await api(`/battle/matches/${match.id}/state`, 'GET', tok)
        act(idx, s)
        if (maxTurn > 0 && s.turn >= maxTurn) {
          console.log(`\n== EARLY STOP at turn ${s.turn} (MAX_TURN=${maxTurn}) ==`)
          for (const p of s.players || []) {
            console.log(`   ${p.name}: life=${p.life} battlefield=${(p.battlefield || []).map((c) => `${c.name}[${c.power}/${c.toughness}]${c.tapped ? 'T' : ''}`).join(' ') || 'none'}`)
            console.log(`      hand=${(p.hand || []).map((c) => c.name).join(', ') || 'none'}`)
          }
          topics[meIdx].close()
          topics[themIdx].close()
          process.exit(0)
        }
      } catch {
        // transient/lobby-not-ready; keep polling
      }
    }
    await sleep(500)
  }

  if (!decided) {
    console.log('\n== TIMED OUT before a win ==')
    const s = await api(`/battle/matches/${match.id}/state`, 'GET', a.token)
    console.log(`   status=${s.status} turn=${s.turn} phase=${s.phase}`)
    for (const p of s.players || []) {
      console.log(`   ${p.name}: life=${p.life} battlefield=${(p.battlefield || []).map((c) => `${c.name}[${c.power}/${c.toughness}]${c.tapped ? 'T' : ''}${c.attacking ? 'A' : ''}`).join(' ') || 'none'}`)
      console.log(`      hand=${(p.hand || []).map((c) => c.name).join(', ') || 'none'}`)
    }
    if (s.pendingChoice) {
      console.log(`   pendingChoice[${s.pendingChoice.requestId}]: ${s.pendingChoice.prompt} options=${s.pendingChoice.options.map((o) => o.label).join(' | ')}`)
    }
    process.exit(1)
  }

  // Final REST state + match history check
  const finalState = await api(`/battle/matches/${match.id}/state`, 'GET', a.token)
  console.log('\n== REST final state ==')
  console.log(`   gameOver=${finalState.gameOver} winnerName=${finalState.winnerName} winCondition=${finalState.winCondition} status=${finalState.status}`)
  // Determinism check: the player who joined (seat 1) must be the one asked who goes first.
  if (startChoiceSeenAt !== themIdx) {
    throw new Error(`'who plays first' was asked of seat ${startChoiceSeenAt}, expected joiner seat ${themIdx}`)
  }
  console.log(`   who-plays-first asked of joiner seat ${startChoiceSeenAt} (expected ${themIdx}) OK`)
  const hist = await api('/battle/matches', 'GET', a.token)
  const m = hist.find((x) => x.id === match.id)
  console.log(`   history status=${m && m.status} winnerId=${m && m.winnerId}`)
  if (!finalState.gameOver && finalState.status !== 'COMPLETED' && finalState.status !== 'CONCEDED') {
    throw new Error('Game did not reach a terminal state')
  }
  console.log('\nE2E PASS')
  topics[meIdx].close()
  topics[themIdx].close()
  process.exit(0)
}

main().catch((err) => {
  console.error('\nE2E FAIL:', err.message)
  process.exit(1)
})
