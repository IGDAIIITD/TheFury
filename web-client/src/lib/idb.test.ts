import { expect, test } from 'vitest'
import { CACHE_KEYS, cacheGet, cacheSet } from './idb'

test('cacheGet returns null when IndexedDB is unavailable', async () => {
  await expect(cacheGet('nope')).resolves.toBeNull()
})

test('cacheSet resolves without throwing when IndexedDB is unavailable', async () => {
  await expect(cacheSet('key', { any: ['value'] })).resolves.toBeUndefined()
})

test('leaderboard cache key includes metric and scope', () => {
  expect(CACHE_KEYS.leaderboard('level')).toBe('leaderboard:level:all')
  expect(CACHE_KEYS.leaderboard('winrate', 'BTECH')).toBe('leaderboard:winrate:BTECH')
})
