import { formatCountdown, remainingMs, timeAgo } from './time'

const NOW = Date.parse('2026-09-26T12:00:00Z')

test('timeAgo buckets', () => {
  expect(timeAgo('2026-09-26T11:59:40Z', NOW)).toBe('just now')
  expect(timeAgo('2026-09-26T11:55:00Z', NOW)).toBe('5m ago')
  expect(timeAgo('2026-09-26T09:00:00Z', NOW)).toBe('3h ago')
  expect(timeAgo('2026-09-24T12:00:00Z', NOW)).toBe('2d ago')
  expect(timeAgo('not a date', NOW)).toBe('')
})

test('countdown helpers', () => {
  expect(formatCountdown(120_000)).toBe('2:00')
  expect(formatCountdown(83_000)).toBe('1:23')
  expect(formatCountdown(400)).toBe('0:01')
  expect(formatCountdown(0)).toBe('0:00')
  expect(remainingMs(NOW - 5, NOW)).toBe(0)
  expect(remainingMs(NOW + 5, NOW)).toBe(5)
})
