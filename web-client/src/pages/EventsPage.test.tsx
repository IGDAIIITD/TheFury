import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import EventsPage from './EventsPage'
import { getRecentBattles } from '../api/endpoints'

vi.mock('../api/endpoints', () => ({
  getRecentBattles: vi.fn(),
}))

const mockedBattles = getRecentBattles as unknown as ReturnType<typeof vi.fn>
const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  mockedBattles.mockResolvedValue([
    { matchId: 'b1', winnerName: 'Aadi', loserName: 'Rehan', winCondition: 'Life', endedAt: inSeconds(-300) },
  ])
})

test('keeps battle history in Collection → Events', async () => {
  render(
    <MemoryRouter initialEntries={['/collection/events']}>
      <EventsPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Rehan', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('beat')).toBeInTheDocument()
  expect(screen.getByText('5m ago')).toBeInTheDocument()
})
