import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import EventsPage from './EventsPage'
import { getOpenLobbies, getRecentBattles } from '../api/endpoints'

vi.mock('../api/endpoints', () => ({
  getOpenLobbies: vi.fn(),
  getRecentBattles: vi.fn(),
}))

vi.mock('../api/battleConfig', () => ({
  battleEngineConfigured: () => true,
}))

const mockedLobbies = getOpenLobbies as unknown as ReturnType<typeof vi.fn>
const mockedBattles = getRecentBattles as unknown as ReturnType<typeof vi.fn>

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString()

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/collection/events']}>
      <Routes>
        <Route path="/collection/events" element={<EventsPage />} />
        <Route path="/battle" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedLobbies.mockResolvedValue([
    { matchId: 'm1', battleCode: 'ABC234', hostId: 'h1', hostName: 'Aadi', createdAt: inSeconds(-30), expiresAt: inSeconds(90), mine: false },
    { matchId: 'm2', battleCode: 'MINE22', hostId: 'me', hostName: 'Me', createdAt: inSeconds(-10), expiresAt: inSeconds(110), mine: true },
  ])
  mockedBattles.mockResolvedValue([
    { matchId: 'b1', winnerName: 'Aadi', loserName: 'Rehan', winCondition: 'Life', endedAt: inSeconds(-300) },
  ])
})

test('lists open battles with host, code and a countdown', async () => {
  renderPage()
  expect(await screen.findByText('Aadi', { selector: '.lobby-host' })).toBeInTheDocument()
  expect(screen.getByText('ABC234')).toBeInTheDocument()
  expect(screen.getByText(/closes in 1:3\d/)).toBeInTheDocument()
  expect(screen.getByText('Your lobby')).toBeInTheDocument()
})

test('Join opens the battle page with the code filled in', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Join' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/battle?join=ABC234')
})

test('your own lobby offers View instead of Join', async () => {
  renderPage()
  await screen.findByText('Your lobby')
  expect(screen.getAllByRole('button', { name: 'Join' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument()
})

test('shows who won past battles', async () => {
  renderPage()
  expect(await screen.findByText('Rehan', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('beat')).toBeInTheDocument()
  expect(screen.getByText('5m ago')).toBeInTheDocument()
})

test('expired lobbies drop out of the list', async () => {
  mockedLobbies.mockResolvedValue([
    { matchId: 'old', battleCode: 'OLD999', hostId: 'h', hostName: 'Late', createdAt: inSeconds(-200), expiresAt: inSeconds(-80), mine: false },
  ])
  renderPage()
  expect(await screen.findByText(/No open battles/)).toBeInTheDocument()
  expect(screen.queryByText('OLD999')).not.toBeInTheDocument()
})

test('polls for new lobbies', async () => {
  vi.useFakeTimers()
  try {
    renderPage()
    await act(async () => {
      await Promise.resolve()
    })
    const calls = mockedLobbies.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(mockedLobbies.mock.calls.length).toBeGreaterThan(calls)
  } finally {
    vi.useRealTimers()
  }
})
