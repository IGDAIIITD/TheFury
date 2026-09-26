import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import LeaderboardPage from './LeaderboardPage'
import { useAuth } from '../auth/AuthContext'
import * as endpoints from '../api/endpoints'
import type { LeaderboardResponse } from '../api/types'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  getLeaderboard: vi.fn(),
  getPopularDecks: vi.fn(),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>
const mockedEndpoints = endpoints as {
  getLeaderboard: ReturnType<typeof vi.fn>
  getPopularDecks: ReturnType<typeof vi.fn>
}

const response: LeaderboardResponse = {
  metric: 'level',
  myRank: 1,
  rows: [
    {
      rank: 1,
      playerId: 'p1',
      displayName: 'BattleTest',
      avatar: null,
      degreeLevel: 'BTECH',
      specialization: 'CSAI',
      value: 1210,
      score: 13,
    },
    {
      rank: 2,
      playerId: 'p2',
      displayName: 'Opponent',
      avatar: null,
      degreeLevel: 'MTECH',
      specialization: 'CSE',
      value: 700,
      score: 8,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseAuth.mockReturnValue({
    player: { id: 'p1', displayName: 'BattleTest', level: 13 },
    logout: vi.fn(),
  })
  mockedEndpoints.getLeaderboard.mockResolvedValue(response)
  mockedEndpoints.getPopularDecks.mockResolvedValue([
    { deckName: 'RG Combat', playCount: 4 },
    { deckName: 'Burn', playCount: 2 },
  ])
})

test('renders ranked rows and highlights the current player', async () => {
  render(<LeaderboardPage />)

  expect(await screen.findByText('Opponent')).toBeInTheDocument()
  expect(screen.getByText('Your rank: #1')).toBeInTheDocument()
  expect(screen.getByText('BattleTest')).toBeInTheDocument()
  expect(screen.getByText('1210')).toBeInTheDocument()
  expect(screen.getByText('13')).toBeInTheDocument()
  expect(screen.getByText('B.Tech · CSAI')).toBeInTheDocument()
  expect(screen.getAllByText('you').length).toBeGreaterThan(0)
})

test('switching metric reloads with the new metric and no cohort filter', async () => {
  render(<LeaderboardPage />)
  await screen.findByText('Opponent')

  fireEvent.click(screen.getByText('Win Rate'))

  await waitFor(() => expect(mockedEndpoints.getLeaderboard).toHaveBeenCalledWith('winrate', 50, {}))
})

test('selecting a branch filters by that specialization, any degree', async () => {
  render(<LeaderboardPage />)
  await screen.findByText('Opponent')

  fireEvent.click(screen.getByRole('button', { name: 'CSAI' }))
  await waitFor(() => expect(mockedEndpoints.getLeaderboard).toHaveBeenCalledWith('level', 50, { specialization: 'CSAI' }))

  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  await waitFor(() => expect(mockedEndpoints.getLeaderboard).toHaveBeenLastCalledWith('level', 50, {}))
})

test('offers every branch and no department or degree filters', async () => {
  render(<LeaderboardPage />)
  await screen.findByText('Opponent')
  for (const b of ['CSE', 'CSAI', 'CSAM', 'CSB', 'CSSS', 'CSD', 'CSECON', 'ECE', 'EVE']) {
    expect(screen.getByRole('button', { name: b })).toBeInTheDocument()
  }
  expect(screen.queryByText('CSE dept')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'B.Tech' })).not.toBeInTheDocument()
})

test('shows empty state when there are no rows', async () => {
  mockedEndpoints.getLeaderboard.mockResolvedValue({ metric: 'level', myRank: 0, rows: [] })

  render(<LeaderboardPage />)

  expect(await screen.findByText('No players yet.')).toBeInTheDocument()
})

test('shows error state when the fetch fails and no cache exists', async () => {
  mockedEndpoints.getLeaderboard.mockRejectedValue(new Error('down'))

  render(<LeaderboardPage />)

  expect(await screen.findByText('Failed to load leaderboard.')).toBeInTheDocument()
})

test('shows most-played decks and no building activity', async () => {
  render(<LeaderboardPage />)

  expect(await screen.findByText('Most-played decks')).toBeInTheDocument()
  expect(screen.getByText('RG Combat')).toBeInTheDocument()
  expect(screen.getByText('4 games')).toBeInTheDocument()
  expect(screen.queryByText(/buildings/i)).not.toBeInTheDocument()
  expect(mockedEndpoints.getPopularDecks).toHaveBeenCalledWith(5)
})
