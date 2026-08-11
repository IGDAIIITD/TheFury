import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import CollectionPage from './CollectionPage'
import * as endpoints from '../api/endpoints'
import { CACHE_KEYS } from '../lib/idb'
import type { CardDto, CollectionEntryDto } from '../api/types'

vi.mock('../api/endpoints', () => ({
  browseCards: vi.fn(),
  getCollection: vi.fn(),
  toggleFavorite: vi.fn(),
}))

vi.mock('../lib/idb', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: {
    cards: 'cards',
    collection: 'collection',
    stats: 'stats',
    leaderboard: (metric: string, scope = 'all') => `leaderboard:${metric}:${scope}`,
  },
}))

const idbMock = (await import('../lib/idb')) as {
  cacheGet: ReturnType<typeof vi.fn>
  cacheSet: ReturnType<typeof vi.fn>
}

const mockedEndpoints = endpoints as {
  browseCards: ReturnType<typeof vi.fn>
  getCollection: ReturnType<typeof vi.fn>
  toggleFavorite: ReturnType<typeof vi.fn>
}

const cards: CardDto[] = [
  {
    id: '1',
    oracleId: 'oracle-island',
    forgeName: 'Island',
    rarity: 'Common',
    ownershipType: 'UNLIMITED',
    setCode: 'M19',
    manaValue: 0,
    types: 'Basic Land — Island',
    colors: 'U',
    imageUrl: null,
    discoverable: true,
    spawnRegion: null,
    weight: null,
    commanderEligible: false,
  },
  {
    id: '2',
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
]

const collection: CollectionEntryDto[] = [
  {
    cardId: '2',
    forgeName: 'Counterspell',
    ownershipType: 'UNLOCK',
    quantity: 2,
    discoveredCount: 0,
    favorite: true,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockedEndpoints.browseCards.mockResolvedValue(cards)
  mockedEndpoints.getCollection.mockResolvedValue(collection)
})

test('toggles favorites filter back to all when clicked twice', async () => {
  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  expect(await screen.findByText('Counterspell')).toBeInTheDocument()
  expect(screen.getByText('⭐ Favorites')).toBeInTheDocument()

  fireEvent.click(screen.getByText('⭐ Favorites'))

  await waitFor(() => expect(screen.getByText('Counterspell')).toBeInTheDocument())
  expect(screen.queryByText('Island')).not.toBeInTheDocument()

  fireEvent.click(screen.getByText('⭐ Favorites'))

  await waitFor(() => expect(screen.getByText('Island')).toBeInTheDocument())
  expect(screen.getByText('Counterspell')).toBeInTheDocument()
})

test('toggles owned filter back to all when clicked twice', async () => {
  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  expect(await screen.findByText('Counterspell')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Owned'))

  await waitFor(() => expect(screen.getByText('Counterspell')).toBeInTheDocument())
  expect(screen.queryByText('Island')).not.toBeInTheDocument()

  fireEvent.click(screen.getByText('Owned'))

  await waitFor(() => expect(screen.getByText('Island')).toBeInTheDocument())
  expect(screen.getByText('Counterspell')).toBeInTheDocument()
})

test('toggles missing filter back to all when clicked twice', async () => {
  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  expect(await screen.findByText('Island')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Missing'))

  await waitFor(() => expect(screen.getByText('Island')).toBeInTheDocument())
  expect(screen.queryByText('Counterspell')).not.toBeInTheDocument()

  fireEvent.click(screen.getByText('Missing'))

  await waitFor(() => expect(screen.getByText('Counterspell')).toBeInTheDocument())
  expect(screen.getByText('Island')).toBeInTheDocument()
})

test('filters cards by set', async () => {
  mockedEndpoints.browseCards.mockResolvedValue([
    { ...cards[0], id: '10', setCode: 'M19', rarity: 'Common', forgeName: 'Island' },
    { ...cards[1], id: '11', setCode: 'LEA', rarity: 'Mythic', forgeName: 'Black Lotus' },
  ])
  mockedEndpoints.getCollection.mockResolvedValue([])

  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  await screen.findByText('Island')
  expect(screen.getByText('Black Lotus')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Set LEA'))

  await waitFor(() => expect(screen.getByText('Black Lotus')).toBeInTheDocument())
  expect(screen.queryByText('Island')).not.toBeInTheDocument()
})

test('filters cards by rarity', async () => {
  mockedEndpoints.browseCards.mockResolvedValue([
    { ...cards[0], id: '10', setCode: 'M19', rarity: 'Common', forgeName: 'Island' },
    { ...cards[1], id: '11', setCode: 'LEA', rarity: 'Mythic', forgeName: 'Black Lotus' },
  ])
  mockedEndpoints.getCollection.mockResolvedValue([])

  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  await screen.findByText('Island')

  fireEvent.click(screen.getByText('Mythic'))

  await waitFor(() => expect(screen.getByText('Black Lotus')).toBeInTheDocument())
  expect(screen.queryByText('Island')).not.toBeInTheDocument()
})

test('toggles recently found filter back to all when clicked twice', async () => {
  mockedEndpoints.getCollection.mockResolvedValue([
    {
      cardId: '2',
      forgeName: 'Counterspell',
      ownershipType: 'UNLOCK',
      quantity: 2,
      discoveredCount: 1,
      favorite: false,
    },
  ])

  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  expect(await screen.findByText('Counterspell')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Recently Found'))

  await waitFor(() => expect(screen.getByText('Counterspell')).toBeInTheDocument())
  expect(screen.queryByText('Island')).not.toBeInTheDocument()

  fireEvent.click(screen.getByText('Recently Found'))

  await waitFor(() => expect(screen.getByText('Island')).toBeInTheDocument())
  expect(screen.getByText('Counterspell')).toBeInTheDocument()
})

test('renders cached cards when the network is unavailable', async () => {
  idbMock.cacheGet.mockImplementation(async (key: string) => {
    if (key === CACHE_KEYS.cards) return cards
    if (key === CACHE_KEYS.collection) return collection
    return null
  })
  mockedEndpoints.browseCards.mockRejectedValue(new Error('offline'))
  mockedEndpoints.getCollection.mockRejectedValue(new Error('offline'))

  render(<MemoryRouter><CollectionPage /></MemoryRouter>)

  expect(await screen.findByText('Counterspell')).toBeInTheDocument()
  expect(screen.getByText('Island')).toBeInTheDocument()
  expect(screen.queryByText('Failed to load collection.')).not.toBeInTheDocument()
})
