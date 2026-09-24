import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import ScanPage from './ScanPage'
import { ClaimApiError } from '../api/qrEndpoints'

vi.mock('../api/qrEndpoints', () => ({
  claimToken: vi.fn(),
  ClaimApiError: class ClaimApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'ClaimApiError'
      this.status = status
    }
  },
}))

import { claimToken } from '../api/qrEndpoints'

const mockedClaimToken = claimToken as ReturnType<typeof vi.fn>

const unlockedResult = {
  card: {
    id: 'card-1',
    oracleId: 'oracle-counterspell',
    forgeName: 'Counterspell',
    rarity: 'Common',
    ownershipType: 'UNLOCK',
    setCode: 'M19',
    manaValue: 2,
    types: 'Instant',
    colors: 'U',
    imageUrl: null,
    discoverable: true,
    spawnRegion: null,
    weight: null,
    commanderEligible: false,
  },
  unlocked: true,
  alreadyOwned: false,
  discoveryCount: 1,
  experienceAwarded: 10,
  token: 'COUNTSPELL01',
  building: 'Building B',
}

const alreadyOwnedResult = {
  ...unlockedResult,
  unlocked: false,
  alreadyOwned: true,
  discoveryCount: 2,
  experienceAwarded: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('shows camera-unavailable fallback and claims a token via manual entry', async () => {
  mockedClaimToken.mockResolvedValue(unlockedResult)

  render(<ScanPage />)

  expect(screen.getByText('Camera not supported on this device.')).toBeInTheDocument()

  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'counterspell01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  await waitFor(() =>
    expect(mockedClaimToken).toHaveBeenCalledWith('COUNTERSPELL01'.toUpperCase()),
  )
  expect(await screen.findByText('Claimed Counterspell')).toBeInTheDocument()
  expect(screen.getByText('+10 XP · discovery #1')).toBeInTheDocument()
  expect(screen.getByText('✦')).toHaveClass('reveal-badge')
  expect(screen.getByText('Claimed Counterspell').parentElement).toHaveClass('reveal-sheet')
})

test('shows already-discovered state for a repeat scan', async () => {
  mockedClaimToken.mockResolvedValue(alreadyOwnedResult)

  render(<ScanPage />)

  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'COUNTSPELL01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  expect(await screen.findByText('Already discovered')).toBeInTheDocument()
})

test('surfaces a 409 conflict error message', async () => {
  mockedClaimToken.mockRejectedValue(new ClaimApiError(409, 'This unique card has already been claimed'))

  render(<ScanPage />)

  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'BLACKLOTUS03' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  expect(await screen.findByText('This unique card has already been claimed')).toBeInTheDocument()
  expect(screen.getByText('Not claimed')).toBeInTheDocument()
})

test('can scan another after a result', async () => {
  mockedClaimToken.mockResolvedValue(unlockedResult)

  render(<ScanPage />)

  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'COUNTSPELL01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  await screen.findByText('Claimed Counterspell')
  fireEvent.click(screen.getByRole('button', { name: 'Scan another' }))

  expect(await screen.findByTestId('manual-token')).toBeInTheDocument()
  expect(screen.getByTestId('manual-token')).toHaveValue('')
})

test('shows which copy a new scan granted', async () => {
  mockedClaimToken.mockResolvedValue({ ...unlockedResult, copiesOwned: 2, maxCopies: 4, discoveryCount: 3 })

  render(<ScanPage />)
  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'COUNTSPELL02' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  expect(await screen.findByText('+10 XP · copy 2 of 4 · discovery #3')).toBeInTheDocument()
})

test('explains that rescanning the same code gives no extra copy', async () => {
  mockedClaimToken.mockResolvedValue({ ...alreadyOwnedResult, reason: 'SAME_CODE', copiesOwned: 1, maxCopies: 4 })

  render(<ScanPage />)
  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'COUNTSPELL01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  expect(
    await screen.findByText('You already scanned this code. Find a different Counterspell code for another copy (1 of 4).'),
  ).toBeInTheDocument()
})

test('says when all copies are collected', async () => {
  mockedClaimToken.mockResolvedValue({ ...alreadyOwnedResult, reason: 'MAX_COPIES', copiesOwned: 4, maxCopies: 4 })

  render(<ScanPage />)
  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'COUNTSPELL05' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  expect(await screen.findByText('You have all 4 copies of Counterspell.')).toBeInTheDocument()
})

test('unlocking a scan-once common says it gives unlimited copies', async () => {
  mockedClaimToken.mockResolvedValue({
    ...unlockedResult,
    card: { ...unlockedResult.card, forgeName: 'Skeleton Archer', ownershipType: 'UNLIMITED', requiresUnlock: true },
  })

  render(<ScanPage />)
  fireEvent.change(screen.getByTestId('manual-token'), { target: { value: 'ARCHERCODE01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

  expect(await screen.findByText('+10 XP · unlimited copies · discovery #1')).toBeInTheDocument()
})
