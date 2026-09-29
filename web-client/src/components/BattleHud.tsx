import type { MatchPlayerState } from '../api/battleTypes'
import { availableMana, healthSegments, phaseStrip, MANA_COLORS, MANA_NAMES } from '../pages/battleUi'

/** Horizontal life bar: one solid segment per life point out of 20. */
export function HealthBar({ life }: { life: number }) {
  const { filled, total, overflow } = healthSegments(life)
  const tone = filled <= 5 ? 'critical' : filled <= 10 ? 'hurt' : 'healthy'
  return (
    <div className={`health-bar ${tone}`} role="meter" aria-label="Life" aria-valuenow={life} aria-valuemin={0} aria-valuemax={total}>
      <div className="health-bar-segments">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`health-seg${i < filled ? ' on' : ''}`} />
        ))}
      </div>
      <span className="health-bar-number">
        {life}
        {overflow > 0 && <small> (+{overflow})</small>}
      </span>
    </div>
  )
}

/** Mana you can spend right now, per color: untapped sources + floating mana. */
export function ManaPanel({
  battlefield,
  pool,
}: {
  battlefield: MatchPlayerState['battlefield'] | undefined
  pool: Record<string, number> | null | undefined
}) {
  const mana = availableMana(battlefield, pool)
  return (
    <div className="mana-panel" aria-label={`Mana available: ${mana.total}`}>
      {MANA_COLORS.map((c) => (
        <span
          key={c}
          className={`mana-orb mana-${c}${mana.byColor[c] === 0 ? ' empty' : ''}`}
          title={`${MANA_NAMES[c]}: ${mana.byColor[c]}`}
          aria-label={`${MANA_NAMES[c]} ${mana.byColor[c]}`}
        >
          <span className="mana-orb-letter" aria-hidden>{c}</span>
          <span className="mana-orb-count">{mana.byColor[c]}</span>
        </span>
      ))}
      <span className="mana-total">
        {mana.total} mana
        {mana.floating > 0 && <em> · {mana.floating} floating</em>}
      </span>
    </div>
  )
}

/** The turn's steps with the current one lit. */
export function PhaseStrip({ phase }: { phase: string | null }) {
  const steps = phaseStrip(phase)
  return (
    <div className="phase-strip" aria-label="Turn steps">
      {steps.map((s) => (
        <div
          key={s.key}
          className={`phase-step${s.active ? ' active' : ''}${s.inCombat && s.key === 'COMBAT_BEGIN' ? ' in-combat' : ''}`}
        >
          {s.label}
        </div>
      ))}
    </div>
  )
}
