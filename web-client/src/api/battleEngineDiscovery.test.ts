import { afterEach, beforeEach, expect, test, vi } from 'vitest'

type ChangeHandler = (payload: { new: { value?: unknown } | null }) => void

const state = vi.hoisted(() => ({
  row: null as { value: string | null } | null,
  handler: null as ChangeHandler | null,
}))

vi.mock('./supabaseClient', () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: state.row, error: null }),
  }
  const channel = {
    on: (_type: string, _filter: unknown, cb: ChangeHandler) => {
      state.handler = cb
      return channel
    },
    subscribe: () => channel,
  }
  return {
    supabase: {
      from: () => query,
      channel: () => channel,
      removeChannel: vi.fn(),
    },
  }
})

import { battleEngineConfigured, battleEngineOrigin, setRuntimeBattleEngineOrigin } from './battleConfig'
import { discoverBattleEngine } from './battleEngineDiscovery'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv('VITE_BATTLE_ENGINE_URL', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  setRuntimeBattleEngineOrigin('')
  state.row = null
  state.handler = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('uses the published URL once the engine answers', async () => {
  state.row = { value: 'https://abc-def.trycloudflare.com/' }
  fetchMock.mockResolvedValue({ ok: true })
  const onChange = vi.fn()

  discoverBattleEngine(onChange)

  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
  expect(fetchMock).toHaveBeenCalledWith('https://abc-def.trycloudflare.com/api/v1/battle/features', expect.anything())
  expect(battleEngineOrigin()).toBe('https://abc-def.trycloudflare.com')
  expect(battleEngineConfigured()).toBe(true)
})

test('keeps battles hidden when the published engine is down', async () => {
  state.row = { value: 'https://stale.trycloudflare.com' }
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  const onChange = vi.fn()

  discoverBattleEngine(onChange)

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
  expect(onChange).not.toHaveBeenCalled()
  expect(battleEngineConfigured()).toBe(false)
})

test('follows realtime updates: new URL, then cleared on engine shutdown', async () => {
  fetchMock.mockResolvedValue({ ok: true })
  const onChange = vi.fn()
  discoverBattleEngine(onChange)
  await vi.waitFor(() => expect(state.handler).not.toBeNull())

  state.handler!({ new: { value: 'https://new-url.trycloudflare.com' } })
  await vi.waitFor(() => expect(battleEngineOrigin()).toBe('https://new-url.trycloudflare.com'))

  state.handler!({ new: { value: null } })
  await vi.waitFor(() => expect(battleEngineConfigured()).toBe(false))
  expect(onChange).toHaveBeenCalledTimes(2)
})

test('ignores values that are not http(s) URLs', async () => {
  state.row = { value: 'javascript:alert(1)' }
  const onChange = vi.fn()
  discoverBattleEngine(onChange)
  await new Promise((r) => setTimeout(r, 10))
  expect(fetchMock).not.toHaveBeenCalled()
  expect(battleEngineConfigured()).toBe(false)
})

test('a build-time URL wins and skips discovery', () => {
  vi.stubEnv('VITE_BATTLE_ENGINE_URL', 'http://localhost:17175')
  const onChange = vi.fn()
  discoverBattleEngine(onChange)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(battleEngineOrigin()).toBe('http://localhost:17175')
})
