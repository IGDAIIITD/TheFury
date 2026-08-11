import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Layout from './Layout'
import { useAuth } from '../auth/AuthContext'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>

const LABELS = ['Collection', 'Decks', 'Battle', 'Scan', 'Profile', 'Leaderboard']

let logoutMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  logoutMock = vi.fn()
  mockedUseAuth.mockReturnValue({
    player: { id: 'p1', displayName: 'BattleTest', level: 13 },
    logout: logoutMock,
  })
  localStorage.setItem('cf_onboard_seen', '1')
})

afterAll(() => localStorage.removeItem('cf_onboard_seen'))

test('renders all nav destinations in the tab bar', () => {
  render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  )

  for (const label of LABELS) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
})

test('renders the player badge with level', () => {
  render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  )

  expect(screen.getByText('BattleTest · Lv 13')).toBeInTheDocument()
})

test('calls logout when the Logout button is clicked', () => {
  render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByText('Logout'))

  expect(logoutMock).toHaveBeenCalled()
})
