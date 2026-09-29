import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import MatchLogButton from './MatchLogButton'
import { getMatchLog } from '../api/endpoints'

vi.mock('../api/endpoints', () => ({ getMatchLog: vi.fn() }))
const mocked = getMatchLog as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

test('loads and shows the saved log on demand, once', async () => {
  mocked.mockResolvedValue('[Turn] Turn 1 (Aadi)\n[Life] Rehan lost 2 life\n')
  render(<MatchLogButton matchId="m1" />)
  expect(mocked).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Log' }))
  expect(await screen.findByText(/Rehan lost 2 life/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Log' }))
  expect(mocked).toHaveBeenCalledTimes(1)
  expect(mocked).toHaveBeenCalledWith('m1')
})

test('says so when no log was saved', async () => {
  mocked.mockResolvedValue(null)
  render(<MatchLogButton matchId="old" />)
  fireEvent.click(screen.getByRole('button', { name: 'Log' }))
  expect(await screen.findByText(/No log was saved for this match\./)).toBeInTheDocument()
})
