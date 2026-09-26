import type { CSSProperties, ReactNode } from 'react'

/**
 * Grouped filter chips: each group has a small label and its own accent color, and
 * groups are separated by vertical dividers (see .filter-bar in index.css).
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>
}

export type FilterTone = 'show' | 'color' | 'mana' | 'set' | 'rarity' | 'metric' | 'branch'

export function FilterGroup({ label, tone, children }: { label: string; tone: FilterTone; children: ReactNode }) {
  return (
    <div className={`filter-group tone-${tone}`} role="group" aria-label={label}>
      <span className="filter-label">{label}</span>
      <div className="filter-chips">{children}</div>
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
  color,
  title,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  /** Per-chip accent (e.g. a mana color); defaults to the group's tone. */
  color?: string
  title?: string
}) {
  const style = color ? ({ '--chip': color } as CSSProperties) : undefined
  return (
    <button type="button" className={`chip${active ? ' active' : ''}`} aria-pressed={active} onClick={onClick} style={style} title={title}>
      {children}
    </button>
  )
}
