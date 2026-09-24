import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import TradePage from './TradePage'
import { useAuth } from '../auth/AuthContext'
import * as tradeEndpoints from '../api/tradeEndpoints'
import type { Player, PlayerSummaryDto, TradeDto, UniqueCardDto } from '../api/types'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../api/tradeEndpoints', () => ({
  acceptTrade: vi.fn(),
  cancelTrade: vi.fn(),
  createTrade: vi.fn(),
  declineTrade: vi.fn(),
  getIncomingTrades: vi.fn(),
  getMyUniqueCards: vi.fn(),
  getOutgoingTrades: vi.fn(),
  getPlayerUniqueCards: vi.fn(),
  searchPlayers: vi.fn(),
  subscribeToTrades: vi.fn(() => () => {}),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>
const api = tradeEndpoints as {
  acceptTrade: ReturnType<typeof vi.fn>
  cancelTrade: ReturnType<typeof vi.fn>
  createTrade: ReturnType<typeof vi.fn>
  declineTrade: ReturnType<typeof vi.fn>
  getIncomingTrades: ReturnType<typeof vi.fn>
  getMyUniqueCards: ReturnType<typeof vi.fn>
  getOutgoingTrades: ReturnType<typeof vi.fn>
  getPlayerUniqueCards: ReturnType<typeof vi.fn>
  searchPlayers: ReturnType<typeof vi.fn>
}

const player: Player = {
  id: 'me',
  email: 'me@campus.edu',
  displayName: 'BattleTest',
  role: 'ROLE_PLAYER',
  avatar: null,
  studentId: 'S1',
  degreeLevel: 'BTECH',
  specialization: 'CSAI',
  experience: 0,
  level: 1,
}

const myLotus: UniqueCardDto = {
  physicalUuid: 'm1',
  cardId: 'c-lotus',
  forgeName: 'Black Lotus',
  setCode: 'LEA',
  rarity: 'Mythic',
  imageUrl: null,
  serialNumber: 1,
  claimedAt: '2026-08-03T10:00:00',
  history: null,
}

const myMox: UniqueCardDto = {
  physicalUuid: 'm2',
  cardId: 'c-mox',
  forgeName: 'Mox Sapphire',
  setCode: 'LEA',
  rarity: 'Mythic',
  imageUrl: null,
  serialNumber: 2,
  claimedAt: '2026-08-03T10:00:00',
  history: null,
}

const partner: PlayerSummaryDto = {
  id: 'opp',
  displayName: 'Opponent',
  avatar: null,
  studentId: 'S2',
  degreeLevel: 'MTECH',
  specialization: 'CSE',
}

const partnerRecall: UniqueCardDto = {
  physicalUuid: 'p1',
  cardId: 'c-recall',
  forgeName: 'Ancestral Recall',
  setCode: 'LEA',
  rarity: 'Mythic',
  imageUrl: null,
  serialNumber: 3,
  claimedAt: '2026-08-03T10:00:00',
  history: null,
}

const incomingTrade: TradeDto = {
  id: 't1',
  status: 'PENDING',
  sender: { ...partner },
  receiver: { id: 'me', displayName: 'BattleTest', avatar: null, studentId: null, degreeLevel: 'BTECH', specialization: 'CSAI' },
  offered: [
    {
      physicalUuid: 'p1',
      cardId: 'c-recall',
      forgeName: 'Ancestral Recall',
      setCode: 'LEA',
      rarity: 'Mythic',
      imageUrl: null,
      serialNumber: 3,
    },
  ],
  requested: [
    {
      physicalUuid: 'm1',
      cardId: 'c-lotus',
      forgeName: 'Black Lotus',
      setCode: 'LEA',
      rarity: 'Mythic',
      imageUrl: null,
      serialNumber: 1,
    },
  ],
  createdAt: '2026-08-03T10:00:00',
  resolvedAt: null,
  expiresAt: '2026-08-04T10:00:00',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseAuth.mockReturnValue({
    player,
    token: 'x',
    login: vi.fn(),
    register: vi.fn(),
    refreshPlayer: vi.fn(),
    logout: vi.fn(),
  })
  api.getMyUniqueCards.mockResolvedValue([myLotus, myMox])
  api.getIncomingTrades.mockResolvedValue([incomingTrade])
  api.getOutgoingTrades.mockResolvedValue([])
})

function renderPage() {
  return render(
    <MemoryRouter>
      <TradePage />
    </MemoryRouter>,
  )
}

test('renders incoming offer with accept and decline actions', async () => {
  renderPage()

  expect(await screen.findByText('Incoming offers')).toBeInTheDocument()
  expect(screen.getByText(/Ancestral Recall/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
})

test('accept resolves the trade and reloads my uniques', async () => {
  api.acceptTrade.mockResolvedValue({ ...incomingTrade, status: 'ACCEPTED' })

  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))

  await waitFor(() => expect(api.acceptTrade).toHaveBeenCalledWith('t1'))
  await waitFor(() => expect(api.getMyUniqueCards).toHaveBeenCalledTimes(2))
})

test('decline calls decline endpoint', async () => {
  api.declineTrade.mockResolvedValue({ ...incomingTrade, status: 'DECLINED' })

  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Decline' }))

  await waitFor(() => expect(api.declineTrade).toHaveBeenCalledWith('t1'))
})

test('outgoing offer shows cancel action', async () => {
  api.getOutgoingTrades.mockResolvedValue([
    { ...incomingTrade, id: 't2', status: 'PENDING' },
  ])

  renderPage()

  expect(await screen.findByText('Outgoing offers')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel offer' })).toBeInTheDocument()

  api.cancelTrade.mockResolvedValue({ ...incomingTrade, status: 'CANCELLED' })
  api.getOutgoingTrades.mockResolvedValue([])

  fireEvent.click(screen.getByRole('button', { name: 'Cancel offer' }))

  await waitFor(() => expect(api.cancelTrade).toHaveBeenCalledWith('t2'))
})

test('composer searches partner, selects bundles and creates trade', async () => {
  api.searchPlayers.mockResolvedValue([partner])
  api.getPlayerUniqueCards.mockResolvedValue([partnerRecall])
  api.getIncomingTrades.mockResolvedValue([])
  api.getOutgoingTrades.mockResolvedValue([])

  renderPage()

  await screen.findByText('New offer')

  fireEvent.change(screen.getByPlaceholderText('Find a player by name or email…'), {
    target: { value: 'Opponent' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))

  const partnerChip = await screen.findByText(/Opponent · MTECH CSE/)
  fireEvent.click(partnerChip)

  await screen.findByText('You offer (0)')
  expect(screen.getByText('Ancestral Recall')).toBeInTheDocument()

  fireEvent.click(screen.getByText('Black Lotus'))
  fireEvent.click(screen.getByText('Ancestral Recall'))

  const offerBtn = screen.getByRole('button', { name: 'Offer 1 for 1' })
  expect(offerBtn).toBeEnabled()
  fireEvent.click(offerBtn)

  await waitFor(() =>
    expect(api.createTrade).toHaveBeenCalledWith({
      receiverId: 'opp',
      offeredPhysicalUuids: ['m1'],
      requestedPhysicalUuids: ['p1'],
    }),
  )
  await waitFor(() =>
    expect(screen.getByText('Trade offered. Waiting for the other player to respond.')).toBeInTheDocument(),
  )
})

test('self is filtered out of search results', async () => {
  const meSummary: PlayerSummaryDto = {
    id: 'me',
    displayName: 'BattleTest',
    avatar: null,
    studentId: null,
    degreeLevel: 'BTECH',
    specialization: 'CSAI',
  }
  api.searchPlayers.mockResolvedValue([meSummary])
  api.getPlayerUniqueCards.mockResolvedValue([])

  renderPage()

  await screen.findByText('New offer')
  fireEvent.change(screen.getByPlaceholderText('Find a player by name or email…'), {
    target: { value: 'BattleTest' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))

  expect(
    await screen.findByText('Only you match. Try another name.'),
  ).toBeInTheDocument()
})
