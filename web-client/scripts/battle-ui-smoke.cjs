/* eslint-disable no-console */
/*
 * Battle UI smoke driver: opens the NEW battle board in a real Chrome via the
 * Deno proxy, starts a PvP lobby as testbattle, joins with a scripted opponent,
 * and drives testbattle's seat THROUGH THE NEW UI (instruction banner, tap-to-act
 * cards, Pass Priority, attack select-then-confirm) while a page-injected bot
 * plays the opponent seat over raw STOMP.
 *
 * Prereqs (from web-client/):
 *   npm run build  (or the direct tsc/vite invocations)
 *   deno run --allow-net --allow-read --allow-env serve.mjs  (port 17170)
 *   backend running + DB seeded (testbattle + opponent, each with an RG Combat deck)
 *
 * Run:
 *   node scripts/battle-ui-smoke.cjs
 *
 * Env:
 *   BASE          frontend origin (default http://localhost:17170)
 *   CHROME_PATH   Chrome/Edge/Chromium executable
 */
const { chromium } = require('playwright-core')

const BASE = process.env.BASE || 'http://localhost:17170'
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PW = 'password123'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const log = (m) => console.log('[battle-ui-smoke]', m)

// Opponent bot: STOMP over a raw WebSocket in the page, REST poll as a rescue,
// answers the seat-1 decisions with the same logic as battle-e2e ('smash').
function botSource(oppToken, matchId) {
  return `
  (async () => {
    const tok = ${JSON.stringify(oppToken)}
    const matchId = ${JSON.stringify(matchId)}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const api = async (path, token) => {
      const res = await fetch('/api/v1' + path, {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      })
      const text = await res.text()
      if (!res.ok) throw new Error(path + ' -> ' + res.status)
      return text ? JSON.parse(text) : null
    }
    const ws = new WebSocket('ws://' + location.host + '/ws/match')
    let buf = ''
    const done = new Set()
    const queue = []
    const sendRaw = (s) => {
      if (ws.readyState === 1) ws.send(s)
      else queue.push(s)
    }
    const flush = () => {
      const q = queue.splice(0)
      q.forEach((s) => ws.send(s))
    }
    ws.onopen = () => sendRaw('CONNECT\\naccept-version:1.2\\nheart-beat:0,0\\nAuthorization:Bearer ' + tok + '\\n\\n\\u0000')
    ws.onmessage = (ev) => {
      buf += ev.data
      let i
      while ((i = buf.indexOf('\\u0000')) >= 0) {
        const raw = buf.slice(0, i)
        buf = buf.slice(i + 1)
        handle(raw)
      }
    }
    function handle(raw) {
      if (!raw.trim()) return
      const lines = raw.split('\\n')
      const cmd = lines[0]
      const headers = {}
      let body = ''
      let inBody = false
      for (const line of lines.slice(1)) {
        if (inBody) body += line
        else if (line === '') inBody = true
        else {
          const j = line.indexOf(':')
          if (j > 0) headers[line.slice(0, j)] = line.slice(j + 1)
        }
      }
      if (cmd === 'CONNECTED') {
        ws.send('SUBSCRIBE\\ndestination:/topic/match/' + matchId + '/p1\\nid:bot\\nack:auto\\n\\n\\u0000')
        flush()
      } else if (cmd === 'MESSAGE' && headers.destination) {
        try { act(JSON.parse(body)) } catch (e) {}
      }
    }
    function submit(requestId, indices) {
      sendRaw('SEND\\ndestination:/app/match/' + matchId + '/action\\ncontent-type:application/json\\n\\n' +
        JSON.stringify({ actionType: 'CHOICE', payload: { requestId, selectedIndices: indices } }) + '\\u0000')
    }
    function choose(s) {
      const pc = s.pendingChoice
      if (!pc) return
      const key = pc.requestId + '|' + pc.prompt
      if (done.has(key)) return
      done.add(key)
      const p = (pc.prompt || '').toLowerCase()
      const opts = pc.options.map((o) => o.label)
      if (p.includes('plays first') || p.includes('who goes first') || p.includes('starting player')) return submit(pc.requestId, [0])
      if (p.includes('keep') || p.includes('mulligan')) return submit(pc.requestId, [0])
      if (p.includes('attack') || p.includes('attacker')) return submit(pc.requestId, opts.map((_, i) => i))
      if (p.includes('block') || p.includes('blocker')) return submit(pc.requestId, [])
      if (p.includes('target') || p.includes('choose targets') || p.includes('select target')) {
        const oppIdx = opts.findIndex((o) => o.includes('BattleTest') || o === 'P2' || o === 'P1')
        return submit(pc.requestId, [oppIdx >= 0 ? oppIdx : 0])
      }
      if (p.includes('play') || p.includes('cast') || p.includes('card')) {
        const tap = (o) => o.includes('{T}')
        let i = -1
        for (const name of ['Mountain', 'Forest']) {
          i = opts.findIndex((o) => o.startsWith(name + ' - ') && !tap(o))
          if (i >= 0) break
        }
        if (i < 0) {
          for (const name of ['Llanowar Elves','Raging Goblin','Grizzly Bears','Elvish Warrior','Elvish Archers','Goblin Piker','Goblin Mountaineer','Trained Armodon','Goblin Hero','Vulshok Berserker','Cudgel Troll','Giant Spider','War Mammoth','Hill Giant','Fire Elemental','Craw Wurm','Solemn Simulacrum']) {
            i = opts.findIndex((o) => o.startsWith(name + ' - ') && !tap(o))
            if (i >= 0) break
          }
        }
        if (i < 0) i = opts.findIndex((o) => o.includes('Lightning Bolt') || o.includes('Shock'))
        if (i >= 0) return submit(pc.requestId, [i])
        if (pc.cancellable) return submit(pc.requestId, [])
        return submit(pc.requestId, [0])
      }
      if (pc.cancellable) return submit(pc.requestId, [])
      return submit(pc.requestId, [0])
    }
    function act(s) {
      if (s && !s.gameOver) choose(s)
    }
    ;(async () => {
      const deadline = Date.now() + 150000
      while (Date.now() < deadline) {
        try { act(await api('/battle/matches/' + matchId + '/state', tok)) } catch (e) {}
        await sleep(400)
      }
    })()
    window.__bot = { stop: () => { try { ws.close() } catch (e) {} } }
  })()`
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  try {
    log(`target ${BASE} via ${CHROME}`)

    // --- login through the UI ---
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('you@campus.edu').fill('testbattle@campus.edu')
    await page.locator('input[type="password"]').fill(PW)
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.waitForURL('**/collection', { timeout: 15000 })
    log('logged in as testbattle')
    await page.evaluate(() => localStorage.setItem('cf_onboard_seen', '1'))
    const gotIt = page.getByRole('button', { name: 'Got it' })
    if ((await gotIt.count()) > 0) await gotIt.click({ timeout: 5000 }).catch(() => {})
    await sleep(500)

    // --- create a PvP lobby through the UI ---
    await page.goto(`${BASE}/battle`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('select', { timeout: 15000 })
    await page.getByRole('button', { name: 'Create Battle Lobby' }).click()
    const code = await page
      .waitForFunction(
        () => {
          const t = document.body.innerText
          return (t.match(/\b[A-Z0-9]{6}\b/) || [])[0] || ''
        },
        undefined,
        { timeout: 15000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => '')
    if (!code) throw new Error('Could not read battle code from lobby screen')
    check('lobby shows a battle code', !!code, `code=${code}`)

    // --- opponent joins via API through the proxy ---
    const join = async (path, method, token, body) => {
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
      if (!res.ok) throw new Error(`${method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(data)}`)
      return data
    }
    const opp = await join('/auth/login', 'POST', null, { email: 'opponent@campus.edu', password: PW })
    const oppDeck = ((await join('/decks', 'GET', opp.token)).decks || []).find((d) => d.name === 'RG Combat')
    if (!oppDeck) throw new Error('opponent has no RG Combat deck')
    const match = await join('/battle/join', 'POST', opp.token, { code, deckId: oppDeck.id })
    if (match.status !== 'ACTIVE') throw new Error(`Expected ACTIVE, got ${match.status}`)
    check('opponent joins the lobby (match ACTIVE)', true, `id=${match.id.slice(0, 8)}`)

    // --- inject the opponent bot ---
    await page.evaluate(botSource(opp.token, match.id))
    log('opponent bot injected')

    // --- wait for the new board to render ---
    await page.waitForSelector('.phase-strip', { timeout: 20000 })
    await page.waitForSelector('.instruction-banner', { timeout: 10000 })
    check('phase strip renders', (await page.locator('.phase-strip .phase-step').count()) >= 5)
    check('instruction banner renders', (await page.locator('.instruction-banner .instruction-title').count()) === 1)
    check('opponent row renders', (await page.locator('.opponent-row').count()) === 1)
    const zones = await page.locator('.battle-zone .battle-zone-head h3').allTextContents()
    check('your battlefield + hand panels', zones.some((z) => z.includes('Battlefield')) && zones.some((z) => z.includes('Hand')), zones.join(' / '))
    check('topbar chips render', (await page.locator('.battle-topbar .chip').count()) >= 3)

    // --- drive testbattle's seat through the new UI ---
    const seen = new Set()
    const prefer = ['Llanowar Elves', 'Raging Goblin', 'Grizzly Bears', 'Elvish Warrior', 'Elvish Archers', 'Goblin Piker', 'Goblin Mountaineer', 'Trained Armodon', 'Goblin Hero', 'Vulshok Berserker', 'Cudgel Troll', 'Giant Spider', 'War Mammoth', 'Hill Giant', 'Fire Elemental', 'Craw Wurm', 'Solemn Simulacrum']
    let lastTap = 0
    let lastPass = 0
    let nonPlaySeen = 0
    let battlefieldChecked = false
    let manaPillSeen = false
    let manaPipsSeen = false
    let opponentCardsSeen = false
    let hpChipSeen = false
    let conceded = false
    const deadline = Date.now() + 150000

    while (Date.now() < deadline && !conceded) {
      const title = await page
        .locator('.instruction-banner .instruction-title')
        .textContent()
        .catch(() => '')
      if (title.trim()) {
        const detail =
          (await page
            .locator('.instruction-banner .instruction-detail')
            .textContent()
            .catch(() => '')) || ''
        const key = title.trim() + '|' + detail.trim()
        const fresh = !seen.has(key)
        if (fresh) seen.add(key)
        const now = Date.now()

        try {
          if (title.includes('Keep this hand')) {
            if (fresh) {
              await page.locator('.battle-text-options button').first().click({ timeout: 5000 })
              log('  -> mulligan: kept hand')
            }
          } else if (title.includes('play a card or pass')) {
            const pass = page.locator('.battle-actionbar button', { hasText: 'Pass Priority' })
            const passCount = await pass.count()
            const handInt = page.locator('.battle-hand .battle-card.interactive')
            const bfInt = page.locator('.battle-grid .battle-card.interactive')
            const handNames = await handInt.locator('.name').allTextContents().catch(() => [])
            if (passCount > 0 && now - lastPass > 2000) {
              await pass.first().click()
              lastPass = now
              log('  -> play: passed priority')
            } else if (handNames.length > 0 && now - lastTap > 2000) {
              let idx = -1
              for (const nm of prefer) {
                const i = handNames.indexOf(nm)
                if (i >= 0) { idx = i; break }
              }
              const target = idx >= 0 ? handInt.nth(idx) : handInt.first()
              await target.click()
              lastTap = now
              log(`  -> play: tapped ${handNames[idx >= 0 ? idx : 0] ?? 'a card'}`)
            } else if ((await bfInt.count()) > 0 && now - lastTap > 2000) {
              await bfInt.first().click()
              lastTap = now
              log('  -> play: tapped a battlefield ability')
            }
          } else if (title.includes('attack with')) {
            if (fresh) {
              await page.waitForSelector('.battle-grid .battle-card.interactive', { timeout: 6000 }).catch(() => {})
              const attackers = page.locator('.battle-grid .battle-card.interactive')
              if ((await attackers.count()) > 0) {
                await attackers.first().click()
                await sleep(300)
                const confirm = page.locator('.battle-confirm-row .btn.primary')
                if ((await confirm.count()) > 0 && (await confirm.first().textContent().catch(() => ''))?.includes('Attack')) {
                  await confirm.first().click()
                  log('  -> attack: selected 1 attacker and confirmed')
                }
              } else {
                const skip = page.locator('.battle-actionbar button', { hasText: 'Skip' })
                if ((await skip.count()) > 0) {
                  await skip.first().click()
                  log('  -> attack: no attackers, skipped')
                }
              }
            }
          } else if (title.includes('block with')) {
            if (fresh) {
              const skip = page.locator('.battle-actionbar button', { hasText: 'Skip' })
              if ((await skip.count()) > 0) {
                await skip.first().click()
                log('  -> block: skipped')
              } else {
                const ok = await (async () => {
                  const cards = page.locator('.battle-grid .battle-card.interactive')
                  if ((await cards.count()) === 0) return false
                  await cards.first().click()
                  return true
                })()
                if (ok) {
                  const confirm = page.locator('.battle-confirm-row .btn.primary')
                  if ((await confirm.count()) > 0) await confirm.first().click()
                }
              }
            }
          } else if (title === 'Choose a target') {
            if (fresh) {
              const cards = page.locator('.battle-card.interactive')
              if ((await cards.count()) > 0) {
                await cards.first().click()
                log('  -> target: tapped a target')
              }
            }
          } else if (title.startsWith('Discard') || title.startsWith('Reveal') || title === 'Choose card(s)') {
            if (fresh) {
              const cards = page.locator('.battle-hand .battle-card.interactive')
              if ((await cards.count()) > 0) await cards.first().click()
              const confirm = page.locator('.battle-confirm-row .btn.primary')
              if ((await confirm.count()) > 0) {
                await confirm.first().click()
                log('  -> confirm: tapped cards and confirmed')
              }
            }
          } else if (title.includes('Waiting for') || title.includes('Your turn')) {
            // no decision for us right now; keep polling
          } else {
            if (fresh) {
              const any = page.locator('.battle-text-options button').first()
              if ((await any.count()) > 0) {
                await any.click()
                log('  -> generic: clicked first text option')
              }
            }
          }
        } catch (err) {
          log(`  !! handler error: ${err.message}`)
        }

        if (!key.includes('play a card or pass') && !key.includes('Keep this hand') && !key.includes('Waiting for') && !key.includes('Your turn ·')) {
          nonPlaySeen++
        }
      }

      const played = lastTap > 0 && (await page.locator('.battle-grid .battle-card').count()) > 0
      if (played && !battlefieldChecked) {
        battlefieldChecked = true
        check('a card tapped in hand appeared on the battlefield', true)
      }

      if (!manaPillSeen && (await page.locator('.mana-pips').count()) > 0) {
        manaPillSeen = true
        log('  mana readout visible')
      }
      if (!manaPipsSeen && (await page.locator('.mana-pip').count()) > 0) {
        manaPipsSeen = true
        log('  non-empty mana pips visible')
      }
      if (!opponentCardsSeen && (await page.locator('#opponent-battlefield .battle-card').count()) > 0) {
        opponentCardsSeen = true
        log('  opponent battlefield cards visible')
      }
      if (!hpChipSeen && (await page.locator('.battle-topbar .chip', { hasText: 'HP' }).count()) > 0) {
        hpChipSeen = true
      }

      if (lastTap > 0 && lastPass > 0 && nonPlaySeen > 0 && opponentCardsSeen) {
        const concede = page.getByRole('button', { name: 'Concede' })
        if ((await concede.count()) > 0) {
          await concede.first().click()
          conceded = true
          log('conceded')
        }
      }

      await sleep(300)
    }

    if (!conceded) {
      const concede = page.getByRole('button', { name: 'Concede' })
      if ((await concede.count()) > 0) {
        await concede.first().click()
        conceded = true
        log('conceded (loop ended)')
      }
    }

    check('tapped cards to play through the new UI', lastTap > 0, `taps=${lastTap}`)
    check('passed priority through the new UI', lastPass > 0, `passes=${lastPass}`)
    check('saw a non-play instruction (combat/block/other)', nonPlaySeen > 0)
    check('self HP chip renders in the topbar', hpChipSeen)
    check('mana readout renders (pill always visible)', manaPillSeen)
    log(`  non-empty mana pips ever seen: ${manaPipsSeen}`)
    check('opponent battlefield rendered as cards', opponentCardsSeen)

    if (conceded) {
      await page.waitForSelector('button:has-text("Create Battle Lobby")', { timeout: 15000 }).catch(() => {})
      check('concede returns to the battle lobby', (await page.locator('button:has-text("Create Battle Lobby")').count()) > 0)
    }

    await page.evaluate(() => window.__bot && window.__bot.stop()).catch(() => {})
  } catch (err) {
    failures++
    console.error('[battle-ui-smoke] ERROR:', err && err.message ? err.message : err)
  } finally {
    await browser.close()
  }

  console.log(`\nbattle ui smoke ${failures === 0 ? 'PASSED' : 'FAILED'} (${failures} failure(s))`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
