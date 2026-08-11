import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import EventsPage from './EventsPage'
import { useAuth } from '../auth/AuthContext'
import * as endpoints from '../api/endpoints'
import type { EventDto, FeedEntryDto } from '../api/types'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  listEvents: vi.fn(),
  getActiveEvents: vi.fn(),
  getFeedHistory: vi.fn(),
}))

let feedHandler: ((msg: { body: string }) => void) | null = null

vi.mock('@stomp/stompjs', () => ({
  Client: class FakeClient {
    constructor(public config: Record<string, unknown>) {}
    subscribe = vi.fn((_topic: string, handler: (msg: { body: string }) => void) => {
      feedHandler = handler
      return { unsubscribe: vi.fn() }
    })
    activate() {
      const onConnect = this.config.onConnect as () => void
      onConnect?.()
    }
    deactivate() {}
  },
}))

vi.mock('sockjs-client', () => ({ default: class FakeSockJS {} }))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>
const mockedEndpoints = endpoints as {
  listEvents: ReturnType<typeof vi.fn>
  getActiveEvents: ReturnType<typeof vi.fn>
  getFeedHistory: ReturnType<typeof vi.fn>
}

const event: EventDto = {
  id: 'e1',
  name: 'Race Week',
  allowedSets: ['RACE', 'UNLIMITED'],
  bonusMultiplier: 2,
  startTime: '2026-08-01T00:00:00',
  endTime: '2026-08-10T00:00:00',
  active: true,
  createdAt: '2026-07-30T00:00:00',
}

const feed: FeedEntryDto[] = [
  { type: 'DISCOVERY', message: 'discovered Test Card', playerName: 'Alice', createdAt: '2026-08-03T12:00:00' },
  { type: 'EVENT', message: 'event started: Race Week (×2.0 bonus)', playerName: null, createdAt: '2026-08-03T11:00:00' },
]

beforeEach(() => {
  vi.clearAllMocks()
  feedHandler = null
  mockedUseAuth.mockReturnValue({
    player: { id: 'p1', displayName: 'Tester', email: 't@campus.edu', role: 'ROLE_PLAYER' },
    token: 'x',
    login: vi.fn(),
    register: vi.fn(),
    refreshPlayer: vi.fn(),
    logout: vi.fn(),
  })
  mockedEndpoints.listEvents.mockResolvedValue([event])
  mockedEndpoints.getActiveEvents.mockResolvedValue([event])
  mockedEndpoints.getFeedHistory.mockResolvedValue(feed)
})

test('renders live event banner with bonus and allowed sets', async () => {
  render(<EventsPage />)

  expect(await screen.findByText('Race Week')).toBeInTheDocument()
  expect(screen.getByText('×2 bonus')).toBeInTheDocument()
  expect(screen.getByText(/RACE, UNLIMITED/)).toBeInTheDocument()
})

test('renders feed history from the backend', async () => {
  render(<EventsPage />)

  expect(await screen.findByText(/Alice .* discovered Test Card/)).toBeInTheDocument()
  expect(screen.getByText(/event started: Race Week/)).toBeInTheDocument()
})

test('live feed entries are prepended over STOMP', async () => {
  render(<EventsPage />)
  await screen.findByText(/Alice .* discovered Test Card/)

  feedHandler?.({
    body: JSON.stringify({
      type: 'ACHIEVEMENT',
      message: 'earned the First Discovery achievement',
      playerName: 'Bob',
      createdAt: '2026-08-03T13:00:00',
    } as FeedEntryDto),
  })

  await waitFor(() => expect(screen.getByText(/Bob .* earned the First Discovery achievement/)).toBeInTheDocument())
})
