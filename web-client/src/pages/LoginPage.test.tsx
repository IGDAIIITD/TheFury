import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import LoginPage from './LoginPage'
import { useAuth } from '../auth/AuthContext'
import { checkRoll } from '../api/rollAuth'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../api/rollAuth', () => ({
  ROLL_RE: /^[0-9]{7}$/,
  checkRoll: vi.fn(),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>
const mockedCheckRoll = checkRoll as unknown as ReturnType<typeof vi.fn>

const AADI = {
  rollNo: '2026001',
  name: 'Aadi Dhariwal',
  program: 'CSE',
  degreeLevel: 'BTECH',
  batch: 2026,
}

let auth: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.clearAllMocks()
  auth = {
    loginWithRoll: vi.fn().mockResolvedValue(undefined),
    registerWithRoll: vi.fn().mockResolvedValue(undefined),
  }
  mockedUseAuth.mockReturnValue(auth)
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

function identify(roll = '2026001', first = 'Aadi') {
  fireEvent.change(screen.getByLabelText('Roll number'), { target: { value: roll } })
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: first } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

test('asks for roll number and first name, never an email or cohort', () => {
  const { container } = renderPage()
  expect(screen.getByText('The Fury')).toBeInTheDocument()
  expect(screen.getByLabelText('Roll number')).toBeInTheDocument()
  expect(screen.getByLabelText('First name')).toBeInTheDocument()
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  expect(container.querySelectorAll('select').length).toBe(0)
  expect(screen.queryByText(/campus forge/i)).not.toBeInTheDocument()
})

test('keeps only digits in the roll number and rejects short rolls locally', () => {
  renderPage()
  const roll = screen.getByLabelText('Roll number') as HTMLInputElement
  fireEvent.change(roll, { target: { value: '20a26-0012345' } })
  expect(roll.value).toBe('2026001')
  identify('20260', 'Aadi')
  expect(screen.getByRole('alert')).toHaveTextContent('7 digits')
  expect(mockedCheckRoll).not.toHaveBeenCalled()
})

test('a name mismatch stays on the first step and shows the server message', async () => {
  mockedCheckRoll.mockRejectedValue(Object.assign(new Error("That first name doesn't match this roll number."), { status: 403 }))
  renderPage()
  identify('2026001', 'Aarav')
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("doesn't match"))
  expect(mockedCheckRoll).toHaveBeenCalledWith('2026001', 'Aarav')
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
})

test('a NEW roll shows the roster identity and creates the account with a confirmed password', async () => {
  mockedCheckRoll.mockResolvedValue({ ...AADI, status: 'NEW' })
  renderPage()
  identify()
  await screen.findByText('Aadi Dhariwal')
  expect(screen.getByText(/B\.Tech CSE/)).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Create a password'), { target: { value: 'dragons12' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'dragons13' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(screen.getByRole('alert')).toHaveTextContent('do not match')
  expect(auth.registerWithRoll).not.toHaveBeenCalled()

  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'dragons12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() => expect(auth.registerWithRoll).toHaveBeenCalledWith('2026001', 'Aadi', 'dragons12', undefined))
})

test('a REGISTERED roll just asks for the password', async () => {
  mockedCheckRoll.mockResolvedValue({ ...AADI, status: 'REGISTERED' })
  renderPage()
  identify()
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'dragons12' } })
  expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
  await waitFor(() => expect(auth.loginWithRoll).toHaveBeenCalledWith('2026001', 'dragons12'))
})

test('a wrong password gets a friendly message', async () => {
  mockedCheckRoll.mockResolvedValue({ ...AADI, status: 'REGISTERED' })
  auth.loginWithRoll.mockRejectedValue(new Error('Invalid login credentials'))
  renderPage()
  identify()
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope-nope' } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wrong password'))
})

test('there is no email sign-in at all', () => {
  renderPage()
  expect(screen.queryByRole('button', { name: /staff/i })).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
})

test('a NEW roll can pick an optional nickname', async () => {
  mockedCheckRoll.mockResolvedValue({ ...AADI, status: 'NEW' })
  renderPage()
  identify()
  fireEvent.change(await screen.findByLabelText(/Nickname/), { target: { value: '  Dragon Lord ' } })
  fireEvent.change(screen.getByLabelText('Create a password'), { target: { value: 'dragons12' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'dragons12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() => expect(auth.registerWithRoll).toHaveBeenCalledWith('2026001', 'Aadi', 'dragons12', 'Dragon Lord'))
})

test('a REGISTERED roll is not asked for a nickname', async () => {
  mockedCheckRoll.mockResolvedValue({ ...AADI, status: 'REGISTERED' })
  renderPage()
  identify()
  await screen.findByLabelText('Password')
  expect(screen.queryByLabelText(/Nickname/)).not.toBeInTheDocument()
})
