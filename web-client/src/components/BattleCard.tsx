import type { ReactNode } from 'react'
import type { CardEntry } from '../api/battleTypes'
import { renderManaCost, describeManaCost } from '../pages/battleUi'
import { CardArt } from '../lib/scryfall'

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: '1px 5px',
      }}
    >
      {children}
    </span>
  )
}

export interface BattleCardProps {
  card: CardEntry
  /** Card may be tapped to make a choice. */
  selectable?: boolean
  /** Currently selected for a multi-choice (e.g. attackers/blockers). */
  selected?: boolean
  /** Non-interactive right now (dimmed, cursor default). */
  disabled?: boolean
  /** Combat emphasis: 'attack' | 'block' | undefined. */
  emphasis?: 'attack' | 'block'
  /** Show Scryfall card art image. */
  showArt?: boolean
  onClick?: () => void
}

/** Renders a single card tile for hand / battlefield / graveyard listings. */
export default function BattleCard({
  card,
  selectable = false,
  selected = false,
  disabled = false,
  emphasis,
  showArt = false,
  onClick,
}: BattleCardProps) {
  const isCreature = typeof card.power === 'number' && typeof card.toughness === 'number'
  const interactive = selectable && !disabled

  return (
    <div
      className={[
        'card-tile',
        'battle-card',
        interactive ? 'interactive' : '',
        selected ? 'selected' : '',
        disabled ? 'dimmed' : '',
        emphasis ? `emphasis-${emphasis}` : '',
        !showArt ? 'text-mode' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        textAlign: 'left',
        background: 'var(--panel)',
        opacity: card.tapped ? 0.62 : 1,
        transform: card.tapped ? 'rotate(-2deg)' : undefined,
        borderColor: emphasis === 'attack' ? 'var(--bad)' : emphasis === 'block' ? 'var(--accent)' : undefined,
        cursor: interactive ? 'pointer' : 'default',
      }}
      title={card.text ?? card.name}
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      aria-pressed={selected}
    >
      <CardArt name={card.name} loading="eager" />
      <div className="name">{card.name}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <span className="meta">{card.type ?? 'Permanent'}</span>
        {card.cost && <span className="mana" title={describeManaCost(card.cost)}>{renderManaCost(card.cost)}</span>}
      </div>

      {isCreature && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>
            {card.power}/{card.toughness}
          </span>
          {card.damage ? (
            <span className="meta" style={{ color: 'var(--bad)' }}>
              {card.damage} dmg
            </span>
          ) : null}
        </div>
      )}

      {(card.tapped || card.attacking || card.blocking) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {card.tapped && <Badge color="var(--muted)">Tapped</Badge>}
          {card.attacking && <Badge color="var(--bad)">Attacking</Badge>}
          {card.blocking && <Badge color="var(--accent)">Blocking</Badge>}
        </div>
      )}

      {selected && (
        <div className="battle-card-check" aria-hidden>
          ✓
        </div>
      )}
    </div>
  )
}
