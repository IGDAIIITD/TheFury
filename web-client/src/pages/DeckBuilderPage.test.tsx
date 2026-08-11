import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import DeckBuilderPage from './DeckBuilderPage'
import * as endpoints from '../api/endpoints'
import type { CardDto, CollectionEntryDto, DeckDto } from '../api/types'

vi.mock('../api/endpoints', () => ({
  browseCards: vi.fn(),
  getCollection: vi.fn(),
  listDecks: vi.fn(),
  getDeck: vi.fn(),
  validateDeck: vi.fn(),
  createDeck: vi.fn(),
  updateDeck: vi.fn(),
  deleteDeck: vi.fn(),
  toggleFavorite: vi.fn(),
}))

const mockedEndpoints = endpoints as {
  browseCards: ReturnType<typeof vi.fn>
  getCollection: ReturnType<typeof vi.fn>
  listDecks: ReturnType<typeof vi.fn>
  getDeck: ReturnType<typeof vi.fn>
  validateDeck: ReturnType<typeof vi.fn>
  createDeck: ReturnType<typeof vi.fn>
  updateDeck: ReturnType<typeof vi.fn>
  deleteDeck: ReturnType<typeof vi.fn>
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
    favorite: false,
  },
]

const decks: DeckDto[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mockedEndpoints.browseCards.mockResolvedValue(cards)
  mockedEndpoints.getCollection.mockResolvedValue(collection)
  mockedEndpoints.listDecks.mockResolvedValue(decks)
  mockedEndpoints.validateDeck.mockResolvedValue({ valid: true, problems: [] })
  mockedEndpoints.createDeck.mockResolvedValue({
    id: 'deck-1',
    name: 'New Deck',
    formatCode: 'STANDARD',
    commanderCardId: null,
    cards: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })
  mockedEndpoints.updateDeck.mockResolvedValue({
    id: 'deck-1',
    name: 'New Deck',
    formatCode: 'STANDARD',
    commanderCardId: null,
    cards: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })
  mockedEndpoints.deleteDeck.mockResolvedValue()
})

test('renders catalog and adds a card to the deck', async () => {
  render(<DeckBuilderPage />)
  expect(await screen.findByText('Island')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Island'))

  await waitFor(() => expect(screen.getByText('Total: 1')).toBeInTheDocument())
  expect(screen.getByText('1 different cards · 1 total')).toBeInTheDocument()
})

test('validates deck using backend endpoint', async () => {
  mockedEndpoints.validateDeck.mockResolvedValue({
    valid: false,
    problems: [
      {
        code: 'NOT_OWNED',
        message: 'You do not own Counterspell',
        cardId: '2',
      },
    ],
  })

  render(<DeckBuilderPage />)
  expect(await screen.findByText('Island')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Validate'))

  await waitFor(() => expect(mockedEndpoints.validateDeck).toHaveBeenCalled())
  expect(await screen.findByText('Deck has problems:')).toBeInTheDocument()
  expect(screen.getByText('NOT_OWNED: You do not own Counterspell')).toBeInTheDocument()
})

test('saves a newly created deck with the current cards', async () => {
  render(<DeckBuilderPage />)
  expect(await screen.findByText('Island')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Island'))
  fireEvent.click(screen.getByText('Save'))

  await waitFor(() => expect(mockedEndpoints.createDeck).toHaveBeenCalledWith({
    name: 'New Deck',
    formatCode: 'STANDARD',
    commanderCardId: null,
    cards: [{ cardId: '1', quantity: 1 }],
  }))
  expect(await screen.findByText('Deck saved.')).toBeInTheDocument()
})
