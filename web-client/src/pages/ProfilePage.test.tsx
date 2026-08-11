import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import ProfilePage from './ProfilePage'
import { useAuth } from '../auth/AuthContext'
import * as endpoints from '../api/endpoints'
import type { ProfileStatsDto } from '../api/types'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../api/endpoints', () => ({
  getMyStats: vi.fn(),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>
const mockedEndpoints = endpoints as {
  getMyStats: ReturnType<typeof vi.fn>
}

const stats: ProfileStatsDto = {
  player: {
    id: 'p1',
    email: 'test@campus.edu',
    displayName: 'BattleTest',
    role: 'ROLE_PLAYER',
    avatar: null,
    studentId: 'S001',
    degreeLevel: 'BTECH',
    specialization: 'CSAI',
    experience: 1210,
    level: 13,
  },
  experience: 1210,
  level: 13,
  experienceToNextLevel: 90,
  collectionCompletionPercent: 84,
  ownedCards: 26,
  totalCards: 31,
  totalDiscoveries: 24,
  favoriteColors: ['G', 'R'],
  buildingsVisited: ['Block C', 'Library'],
  battleStats: { played: 36, wins: 24, losses: 12, winRatePercent: 67 },
  badges: [
    { code: 'FIRST_DISCOVERY', name: 'First Discovery', description: 'Discover your first card.' },
    { code: 'BATTLE_VETERAN', name: 'Battle Veteran', description: 'Finish a battle.' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseAuth.mockReturnValue({
    player: stats.player,
    token: 'x',
    login: vi.fn(),
    register: vi.fn(),
    refreshPlayer: vi.fn().mockResolvedValue(stats.player),
    logout: vi.fn(),
  })
  mockedEndpoints.getMyStats.mockResolvedValue(stats)
})

test('renders player stats, xp bar and badges', async () => {
  render(<ProfilePage />)

  expect(await screen.findByText('BattleTest')).toBeInTheDocument()
  expect(screen.getByText('Student ID: S001')).toBeInTheDocument()
  expect(screen.getByText('B.Tech · CSAI')).toBeInTheDocument()
  expect(screen.getByText('Lv 13')).toBeInTheDocument()
  expect(screen.getByText('90 XP to level 14')).toBeInTheDocument()
  expect(screen.getByText('84%')).toBeInTheDocument()
  expect(screen.getByText('24–12')).toBeInTheDocument()
  expect(screen.getByText('First Discovery')).toBeInTheDocument()
  expect(screen.getByText('Battle Veteran')).toBeInTheDocument()
  expect(screen.getByText('Buildings visited')).toBeInTheDocument()
  expect(screen.getByText('Block C')).toBeInTheDocument()
  expect(screen.getByText('Library')).toBeInTheDocument()
})

test('refresh button reloads stats and player', async () => {
  render(<ProfilePage />)
  await screen.findByText('BattleTest')

  fireEvent.click(screen.getByText('Refresh'))

  await waitFor(() => expect(mockedEndpoints.getMyStats).toHaveBeenCalledTimes(2))
})
