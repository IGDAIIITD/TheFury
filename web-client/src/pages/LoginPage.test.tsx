import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import LoginPage from './LoginPage'
import { useAuth } from '../auth/AuthContext'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseAuth.mockReturnValue({
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

test('shows cohort fields only in register mode', () => {
  const { container } = renderPage()
  expect(container.querySelectorAll('select').length).toBe(0)

  fireEvent.click(screen.getByText('Register'))

  expect(container.querySelectorAll('select').length).toBe(1)
})

test('specialization options depend on the selected degree', () => {
  const { container } = renderPage()
  fireEvent.click(screen.getByText('Register'))

  const selects = () => Array.from(container.querySelectorAll('select'))
  const degree = selects()[0] as HTMLSelectElement

  fireEvent.change(degree, { target: { value: 'BTECH' } })

  let spec = selects()[1] as HTMLSelectElement
  expect(Array.from(spec.options).map((o) => o.value)).toEqual(
    expect.arrayContaining(['CSE', 'CSAI', 'CSECON', 'ECE', 'EVE']),
  )

  fireEvent.change(degree, { target: { value: 'MTECH' } })

  spec = selects()[1] as HTMLSelectElement
  expect(Array.from(spec.options).map((o) => o.value)).toEqual(['', 'CSE', 'ECE'])
})

test('register submits degree level and specialization', async () => {
  const { container } = renderPage()
  fireEvent.click(screen.getByText('Register'))

  fireEvent.change(screen.getByPlaceholderText('e.g. Sorceress Erin'), { target: { value: 'Sorceress' } })
  fireEvent.change(screen.getByPlaceholderText('you@campus.edu'), { target: { value: 'new@campus.edu' } })
  fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, {
    target: { value: 'pw123456' },
  })

  const selects = () => Array.from(container.querySelectorAll('select'))
  fireEvent.change(selects()[0], { target: { value: 'BTECH' } })
  fireEvent.change(selects()[1], { target: { value: 'CSAI' } })

  fireEvent.click(screen.getByText('Register'))

  await waitFor(() =>
    expect(mockedUseAuth().register).toHaveBeenCalledWith(
      'new@campus.edu',
      'pw123456',
      'Sorceress',
      'BTECH',
      'CSAI',
    ),
  )
})

test('login submits email and password only', async () => {
  const { container } = renderPage()
  fireEvent.change(screen.getByPlaceholderText('you@campus.edu'), { target: { value: 'you@campus.edu' } })
  fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, {
    target: { value: 'pw123456' },
  })

  fireEvent.click(screen.getByText('Log in'))

  await waitFor(() => expect(mockedUseAuth().login).toHaveBeenCalledWith('you@campus.edu', 'pw123456'))
  expect(mockedUseAuth().register).not.toHaveBeenCalled()
})
