import { ownershipRule, ownershipStatus } from './ownership'

const lockedCommon = { ownershipType: 'UNLIMITED' as const, requiresUnlock: true }
const starter = { ownershipType: 'UNLIMITED' as const, requiresUnlock: false }
const uncommon = { ownershipType: 'UNLOCK' as const, requiresUnlock: false }
const mythic = { ownershipType: 'UNIQUE' as const, requiresUnlock: false }

test('every missing card says how to get it', () => {
  expect(ownershipStatus(lockedCommon, null)).toEqual({ owned: false, label: 'Missing · scan once, unlock forever' })
  expect(ownershipStatus(uncommon, null)).toEqual({ owned: false, label: 'Missing · scan to collect (up to 4)' })
  expect(ownershipStatus(mythic, null)).toEqual({ owned: false, label: 'Missing · one of a kind, first scan wins' })
  // a missing label is never a bare "Missing"
  for (const c of [lockedCommon, starter, uncommon, mythic]) {
    expect(ownershipStatus(c, null).label).toMatch(/^Missing · /)
  }
})

test('owned labels by type', () => {
  expect(ownershipStatus(lockedCommon, 2147483647).label).toBe('Unlimited copies')
  expect(ownershipStatus(starter, 2147483647).label).toBe('Unlimited copies')
  expect(ownershipStatus(uncommon, 2).label).toBe('Owned 2 of 4 · scan another code for more')
  expect(ownershipStatus(uncommon, 4).label).toBe('Owned 4 of 4')
  expect(ownershipStatus(mythic, 1).label).toBe('Owned (one of a kind)')
})

test('rule line per type', () => {
  expect(ownershipRule(lockedCommon)).toBe('Scan once, unlock forever')
  expect(ownershipRule(starter)).toBe('Free for everyone')
  expect(ownershipRule(uncommon)).toBe('Scan a code per copy (up to 4)')
  expect(ownershipRule(mythic)).toBe('One of a kind: first scan wins')
})
