import type { ReactNode } from 'react'
import type { CardEntry } from '../api/battleTypes'

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

/** Renders a single card tile for hand / battlefield / graveyard listings. */
export default function BattleCard({ card }: { card: CardEntry }) {
  const isCreature = typeof card.power === 'number' && typeof card.toughness === 'number'

  return (
    <div
      className="card-tile"
      style={{
        textAlign: 'left',
        background: 'var(--panel)',
        opacity: card.tapped ? 0.62 : 1,
        transform: card.tapped ? 'rotate(-2deg)' : undefined,
        borderColor: card.attacking ? 'var(--bad)' : card.blocking ? 'var(--accent)' : undefined,
        cursor: 'default',
      }}
      title={card.text ?? card.name}
    >
      <div className="name">{card.name}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <span className="meta">{card.type ?? 'Permanent'}</span>
        {card.cost && <span className="mana">{card.cost}</span>}
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
    </div>
  )
}
