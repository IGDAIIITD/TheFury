import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HowToPlayPage from './HowToPlayPage'

const renderPage = () =>
  render(
    <MemoryRouter>
      <HowToPlayPage />
    </MemoryRouter>,
  )

describe('HowToPlayPage', () => {
  it('shows every section', () => {
    renderPage()
    for (const heading of [/The goal/, /A turn/, /Mana: paying for cards/, /Attacking and blocking/, /QR codes/, /Decks, XP/]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
  })

  it('mana demo: tapping both Mountains leaves no red for Hill Giant', () => {
    renderPage()
    const demo = screen.getByText('Your hand').parentElement as HTMLElement
    const giant = () => within(demo).getAllByLabelText('Hill Giant')[0].closest('figure') as HTMLElement
    expect(within(giant()).getByText('Can cast')).toBeInTheDocument()

    for (const mountain of within(demo).getAllByRole('button', { name: 'Mountain' })) fireEvent.click(mountain)

    expect(within(giant()).getByText('Not enough mana')).toBeInTheDocument()
    fireEvent.click(within(demo).getByRole('button', { name: 'Untap all' }))
    expect(within(giant()).getByText('Can cast')).toBeInTheDocument()
  })
})
