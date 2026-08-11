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
  getActiveBuildings: vi.fn(),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>
const mockedEndpoints = endpoints as {
  getLeaderboard: ReturnType<typeof vi.fn>
  getPopularDecks: ReturnType<typeof vi.fn>
  getActiveBuildings: ReturnType<typeof vi.fn>
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
  mockedEndpoints.getActiveBuildings.mockResolvedValue([{ building: 'Block C', claimCount: 7 }])
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

test('selecting a degree level filters by it', async () => {
  render(<LeaderboardPage />)
  await screen.findByText('Opponent')

  fireEvent.click(screen.getByText('B.Tech'))

  await waitFor(() =>
    expect(mockedEndpoints.getLeaderboard).toHaveBeenCalledWith('level', 50, { degreeLevel: 'BTECH' }),
  )
})

test('selecting a specialization filters by degree level and specialization', async () => {
  render(<LeaderboardPage />)
  await screen.findByText('Opponent')

  fireEvent.click(screen.getByText('B.Tech'))
  fireEvent.click(screen.getByText('CSAI'))

  await waitFor(() =>
    expect(mockedEndpoints.getLeaderboard).toHaveBeenCalledWith('level', 50, {
      degreeLevel: 'BTECH',
      specialization: 'CSAI',
    }),
  )
})

test('selecting a department filters by it', async () => {
  render(<LeaderboardPage />)
  await screen.findByText('Opponent')

  fireEvent.click(screen.getByText('CSE dept'))

  await waitFor(() =>
    expect(mockedEndpoints.getLeaderboard).toHaveBeenCalledWith('level', 50, { department: 'CSE' }),
  )
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

test('renders campus pulse analytics', async () => {
  render(<LeaderboardPage />)

  expect(await screen.findByText('Campus Pulse')).toBeInTheDocument()
  expect(screen.getByText('RG Combat')).toBeInTheDocument()
  expect(screen.getByText('4 games')).toBeInTheDocument()
  expect(screen.getByText('Block C')).toBeInTheDocument()
  expect(screen.getByText('7 claims')).toBeInTheDocument()
  expect(mockedEndpoints.getPopularDecks).toHaveBeenCalledWith(5)
  expect(mockedEndpoints.getActiveBuildings).toHaveBeenCalledWith(5)
})
