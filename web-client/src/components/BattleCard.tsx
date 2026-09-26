import { useRef, useState } from 'react'
import type { CardEntry } from '../api/battleTypes'
import { renderManaCost, describeManaCost, manaCostSymbols, MANA_NAMES } from '../pages/battleUi'
import { scryfallArtUrl } from '../lib/scryfall'

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
  /** Show the full card image (falls back to text when the image is missing). */
  showArt?: boolean
  /** Smaller tile (lands row). */
  small?: boolean
  onClick?: () => void
  /** Long-press / right-click: show the card enlarged. */
  onInspect?: () => void
}

const LONG_PRESS_MS = 450

/** Cost overlay: a grey circle for generic mana, one colored dot per colored pip. */
export function ManaCostPips({ cost }: { cost: string | null | undefined }) {
  const symbols = manaCostSymbols(cost)
  if (symbols.length === 0) return null
  return (
    <span className="cost-pips" title={describeManaCost(cost)} aria-label={`Costs ${describeManaCost(cost)}`}>
      {symbols.map((sym, i) =>
        sym.kind === 'generic' ? (
          <span key={i} className="pip generic">
            {sym.amount}
          </span>
        ) : sym.kind === 'color' ? (
          <span key={i} className={`pip mana-${sym.color}`} title={MANA_NAMES[sym.color]} />
        ) : (
          <span key={i} className="pip generic">
            {sym.text}
          </span>
        ),
      )}
    </span>
  )
}

/**
 * One card on the board or in hand. Art mode shows the whole printed card (name, cost and
 * rules are on the image) with small overlays for live state: tapped, damage, combat role,
 * current power/toughness. Text mode, or a missing image, shows the same facts as text.
 */
export default function BattleCard({
  card,
  selectable = false,
  selected = false,
  disabled = false,
  emphasis,
  showArt = true,
  small = false,
  onClick,
  onInspect,
}: BattleCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const isCreature = typeof card.power === 'number' && typeof card.toughness === 'number'
  const interactive = selectable && !disabled
  const art = showArt && !imgFailed

  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }
  const startPress = () => {
    if (!onInspect) return
    longPressed.current = false
    cancelPress()
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      onInspect()
    }, LONG_PRESS_MS)
  }

  return (
    <div
      className={[
        'battle-card',
        art ? 'art' : 'text',
        small ? 'small' : '',
        interactive ? 'interactive' : '',
        selected ? 'selected' : '',
        disabled ? 'dimmed' : '',
        card.tapped ? 'tapped' : '',
        emphasis ? `emphasis-${emphasis}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={card.text ? `${card.name}: ${card.text}` : card.name}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false
          return
        }
        if (interactive) onClick?.()
      }}
      onContextMenu={(e) => {
        if (!onInspect) return
        e.preventDefault()
        onInspect()
      }}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={card.name}
    >
      {art ? (
        <img
          className="battle-card-img"
          src={scryfallArtUrl(card.name)}
          alt={card.name}
          loading="eager"
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="battle-card-text">
          <div className="battle-card-name">{card.name}</div>
          {card.cost && (
            <span className="mana" title={describeManaCost(card.cost)}>
              {renderManaCost(card.cost)}
            </span>
          )}
          <div className="battle-card-type">{card.type ?? 'Permanent'}</div>
        </div>
      )}

      {art && <ManaCostPips cost={card.cost} />}
      {isCreature && (
        <span className={`battle-card-pt${card.damage ? ' hurt' : ''}`}>
          {card.power}/{card.toughness}
          {card.damage ? <em> −{card.damage}</em> : null}
        </span>
      )}
      {(card.tapped || card.attacking || card.blocking) && (
        <span className="battle-card-flags">
          {card.attacking && <span className="flag attack">Attacking</span>}
          {card.blocking && <span className="flag block">Blocking</span>}
          {card.tapped && <span className="flag tapped">Tapped</span>}
        </span>
      )}
      {selected && (
        <div className="battle-card-check" aria-hidden>
          ✓
        </div>
      )}
    </div>
  )
}
