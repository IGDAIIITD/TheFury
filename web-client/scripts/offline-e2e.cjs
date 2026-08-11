/* eslint-disable no-console */
/*
 * Offline PWA E2E driver: loads the built app through the Deno proxy, logs in
 * through the UI, warms the offline caches, then flips the network to offline
 * over CDP and verifies the app shell + data still render (SW precache +
 * NetworkFirst API cache + IndexedDB).
 *
 * Prereqs (from web-client/):
 *   npm run build                 -> dist/ with sw.js + manifest
 *   deno run -A serve.mjs -- PORT=17171 (or default 17170)
 *   backend running + DB seeded with the login account
 *
 * Run:
 *   node scripts/offline-e2e.cjs
 *
 * Env:
 *   BASE          frontend origin (default http://localhost:17171)
 *   CHROME_PATH   Chrome/Edge/Chromium executable
 *   E2E_EMAIL     login email (default testbattle@campus.edu)
 *   E2E_PASSWORD  login password (default password123)
 */
const { chromium } = require('playwright-core')

const BASE = process.env.BASE || 'http://localhost:17171'
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const EMAIL = process.env.E2E_EMAIL || 'testbattle@campus.edu'
const PW = process.env.E2E_PASSWORD || 'password123'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const log = (m) => console.log('[offline-e2e]', m)

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const session = await context.newCDPSession(page)

  try {
    log(`target ${BASE} via ${CHROME}`)

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => navigator.serviceWorker.ready)
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.evaluate(() => navigator.serviceWorker.ready)
    }
    check(
      'service worker controls the page',
      await page.evaluate(() => !!navigator.serviceWorker.controller),
    )

    await page.getByPlaceholder('you@campus.edu').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PW)
    await page.getByRole('button', { name: 'Log in' }).click()
    try {
      await page.waitForURL('**/collection', { timeout: 15000 })
    } catch (err) {
      const url = page.url()
      const errText = await page.locator('.auth-card .error').textContent().catch(() => '')
      console.error('[offline-e2e] login debug: url=', url, 'errorText=', errText)
      throw err
    }
    check('login lands on /collection', page.url().includes('/collection'))

    await page.waitForSelector('.card-tile', { timeout: 15000 })
    check('collection renders online', (await page.locator('.card-tile').count()) > 0)
    await sleep(1500)

    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.profile-header', { timeout: 15000 })
    await sleep(1500)

    await page.goto(`${BASE}/leaderboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.lb-row', { timeout: 15000 })
    check(
      'leaderboard renders online',
      (await page.locator('.lb-row:not(.lb-head)').count()) > 0,
    )
    await sleep(1500)

    await session.send('Network.enable')
    await session.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    })
    await sleep(300)
    log('network emulated OFFLINE')

    await page.goto(`${BASE}/leaderboard`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForSelector('.lb-row', { timeout: 20000 }).catch(() => {})
    const rowsOffline = await page.locator('.lb-row:not(.lb-head)').count()
    check('offline deep reload renders leaderboard rows', rowsOffline > 0, `rows=${rowsOffline}`)
    check(
      'offline leaderboard has no error',
      (await page.getByText('Failed to load leaderboard.').count()) === 0,
    )

    await page.locator('a.nav-link', { hasText: 'Collection' }).first().click()
    await page.waitForURL('**/collection', { timeout: 10000 }).catch(() => {})
    await page.waitForSelector('.card-tile', { timeout: 20000 }).catch(() => {})
    const tiles = await page.locator('.card-tile').count()
    check('offline collection renders from cache', tiles > 0, `tiles=${tiles}`)
    check(
      'offline collection has no error',
      (await page.getByText('Failed to load collection.').count()) === 0,
    )

    await page.locator('a.nav-link', { hasText: 'Profile' }).first().click()
    await page.waitForURL('**/profile', { timeout: 10000 }).catch(() => {})
    await page.waitForSelector('.profile-header', { timeout: 20000 }).catch(() => {})
    check(
      'offline profile renders from cache',
      (await page.locator('.profile-header').count()) > 0,
    )
    check('offline profile shows cohort line', (await page.getByText(/B\.Tech/).count()) > 0)
    check(
      'offline profile has no error',
      (await page.getByText('Failed to load profile.').count()) === 0,
    )
  } catch (err) {
    failures++
    console.error('[offline-e2e] ERROR:', err && err.message ? err.message : err)
  } finally {
    try {
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
    } catch {
      /* ignore */
    }
    await browser.close()
  }

  console.log(`\noffline e2e ${failures === 0 ? 'PASSED' : 'FAILED'} (${failures} failure(s))`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
