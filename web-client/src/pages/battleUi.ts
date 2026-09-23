import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { CardEntry, MatchPlayerState, MatchState, PendingChoice } from '../api/battleTypes'

/**
 * Pure helpers for the battle UI: phase naming/strip, "what should I do now"
 * instructions derived from the pending choice, and mapping a pending choice's
 * options onto the player's own cards so the cards themselves act as buttons.
 */

export const PHASE_LABELS: Record<string, string> = {
  UNTAP: 'Untap',
  UPKEEP: 'Upkeep',
  DRAW: 'Draw',
  MAIN1: 'Main Phase',
  COMBAT_BEGIN: 'Beginning of Combat',
  COMBAT_DECLARE_ATTACKERS: 'Declare Attackers',
  COMBAT_DECLARE_BLOCKERS: 'Declare Blockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'First-Strike Damage',
  COMBAT_DAMAGE: 'Combat Damage',
  COMBAT_END: 'End of Combat',
  MAIN2: 'Main Phase 2',
  END_OF_TURN: 'End Step',
  CLEANUP: 'Cleanup',
}

export const PHASE_STRIP: { key: string; label: string }[] = [
  { key: 'UNTAP', label: 'Untap' },
  { key: 'UPKEEP', label: 'Upkeep' },
  { key: 'DRAW', label: 'Draw' },
  { key: 'MAIN1', label: 'Main' },
  { key: 'COMBAT_BEGIN', label: 'Combat' },
  { key: 'COMBAT_DECLARE_ATTACKERS', label: 'Attack' },
  { key: 'COMBAT_DECLARE_BLOCKERS', label: 'Block' },
  { key: 'COMBAT_FIRST_STRIKE_DAMAGE', label: '1st Strike' },
  { key: 'COMBAT_DAMAGE', label: 'Damage' },
  { key: 'COMBAT_END', label: 'End C.' },
  { key: 'MAIN2', label: 'Main 2' },
  { key: 'END_OF_TURN', label: 'End' },
  { key: 'CLEANUP', label: 'Cleanup' },
]

/** True when the phase belongs to the combat block (for strip highlighting). */
const isCombatStep = (phase: string | null | undefined) =>
  !!phase && phase.startsWith('COMBAT_')

export const friendlyPhase = (p: string | null | undefined) =>
  p
    ? PHASE_LABELS[p] ??
      p
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : '—'

export interface PhaseStep {
  key: string
  label: string
  active: boolean
  inCombat: boolean
}

export function phaseStrip(phase: string | null | undefined): PhaseStep[] {
  const current = phase ?? ''
  const inCombat = isCombatStep(current)
  return PHASE_STRIP.map((step) => ({
    ...step,
    active: step.key === current || (inCombat && step.key === 'COMBAT_BEGIN'),
    inCombat,
  }))
}

export type InstructionTone = 'action' | 'wait' | 'info'

/** Mana color letter -> emoji pip. No hearts; colorless uses a plain square. */
export const MANA_EMOJI: Record<string, string> = {
  W: '⚪',
  U: '🔵',
  B: '⚫',
  R: '🔴',
  G: '🟢',
  C: '⬜',
}

/** Non-zero mana pool entries as { color, count, emoji } pairs (W/U/B/R/G/C order). */
export function manaList(pool: Record<string, number> | null | undefined): {
  color: string
  count: number
  emoji: string
}[] {
  if (!pool) return []
  const order = ['W', 'U', 'B', 'R', 'G', 'C']
  const out: { color: string; count: number; emoji: string }[] = []
  for (const color of order) {
    const count = pool[color] ?? 0
    if (count > 0) out.push({ color, count, emoji: MANA_EMOJI[color] ?? color })
  }
  return out
}

/** Phases where instant-speed spells (Giant Growth, Shock, etc.) may be cast. */
const INSTANT_ALLOWED_PHASES = new Set([
  'COMBAT_BEGIN',
  'COMBAT_DECLARE_ATTACKERS',
  'COMBAT_DECLARE_BLOCKERS',
  'COMBAT_FIRST_STRIKE_DAMAGE',
  'COMBAT_DAMAGE',
  'COMBAT_END',
])

export function isInCombatPhase(phase: string | null | undefined): boolean {
  return !!phase && INSTANT_ALLOWED_PHASES.has(phase)
}

/** Returns true if the option label describes an instant-speed spell (not an activated ability). */
export function isInstantSpellLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return lower.includes('— instant') || lower.includes(' - instant')
}

/** Human-readable mana cost description for title tooltips. */
export function describeManaCost(cost: string | null | undefined): string {
  if (!cost) return ''
  const colorNames: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' }
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  let generic = 0
  const colored: string[] = []
  while ((m = re.exec(cost)) !== null) {
    const sym = m[1].toUpperCase()
    if (MANA_EMOJI[sym]) {
      colored.push(colorNames[sym] ?? sym)
    } else {
      const n = parseInt(sym, 10)
      if (!isNaN(n)) generic += n
    }
  }
  const total = generic + colored.length
  if (total === 0) return ''
  const parts: string[] = []
  if (generic > 0) parts.push(`${generic} generic`)
  for (const c of colored) parts.push(`1 ${c}`)
  return `${total} mana: ${parts.join(' + ')}`
}

/** Parse a Forge mana-cost string like {2}{R}{G} into emoji pips + styled numbers. */
export function renderManaCost(cost: string | null | undefined): ReactNode[] {
  if (!cost) return []
  const nodes: ReactNode[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  let last = 0
  let hasGeneric = false
  let sawFirstColor = false
  while ((m = re.exec(cost)) !== null) {
    if (m.index > last) nodes.push(cost.slice(last, m.index))
    const sym = m[1].toUpperCase()
    const emoji = MANA_EMOJI[sym]
    if (emoji) {
      if (hasGeneric && !sawFirstColor) {
        nodes.push('+')
        sawFirstColor = true
      }
      nodes.push(emoji)
    } else {
      hasGeneric = true
      nodes.push(
        createElement('span', { key: `m${m.index}`, className: 'mana-cost-num' }, sym),
      )
    }
    last = re.lastIndex
  }
  if (last < cost.length) nodes.push(cost.slice(last))
  return nodes
}

export interface BattleInstruction {
  title: string
  detail: string
  tone: InstructionTone
}

function plural(n: number) {
  return n === 1 ? '1 card' : `${n} cards`
}

/** Derives the "what is happening / what should I do" banner for a state snapshot. */
export function instructionFor(
  state: MatchState,
  me: MatchPlayerState | undefined,
  opponent: MatchPlayerState | undefined,
): BattleInstruction {
  const choice = state.pendingChoice
  if (choice) {
    const detail = choice.prompt || ''
    switch (choice.type) {
      case 'play':
        return {
          title: `${friendlyPhase(state.phase)} — play a card or pass`,
          detail,
          tone: 'action',
        }
      case 'attack':
        return {
          title: 'Choose creatures to attack with',
          detail: 'Tap creatures on your battlefield, then press Attack. You may skip.',
          tone: 'action',
        }
      case 'block':
        return {
          title: 'Choose creatures to block with',
          detail: 'Tap blockers on your battlefield, then press Block. You may skip.',
          tone: 'action',
        }
      case 'target':
        return { title: 'Choose a target', detail, tone: 'action' }
      case 'discard':
        return {
          title: `Discard ${plural(choice.minCount)}${choice.maxCount > choice.minCount ? ` to ${choice.maxCount}` : ''}`,
          detail: 'Tap cards in your hand, then confirm.',
          tone: 'action',
        }
      case 'reveal':
        return {
          title: `Reveal ${plural(choice.minCount)}${choice.maxCount > choice.minCount ? ` to ${choice.maxCount}` : ''}`,
          detail: 'Tap cards in your hand, then confirm.',
          tone: 'action',
        }
      case 'choose':
        return { title: 'Choose card(s)', detail, tone: 'action' }
      case 'mulligan':
        return { title: 'Keep this hand?', detail, tone: 'action' }
      case 'start':
        return { title: 'Choose who plays first', detail, tone: 'action' }
      case 'confirm':
        return { title: 'Confirm', detail, tone: 'action' }
      default:
        return { title: 'Your decision', detail, tone: 'action' }
    }
  }

  const isMyPriority = me?.hasPriority ?? false
  if (isMyPriority) {
    return {
      title: `${friendlyPhase(state.phase)} — your priority`,
      detail: 'Play a card or pass.',
      tone: 'info',
    }
  }
  return {
    title: `Waiting for ${opponent?.name ?? 'your opponent'}…`,
    detail: 'You will be prompted when the game needs your input.',
    tone: 'wait',
  }
}

/** Zones a choice can pull its options from. */
export type MatchZone = 'hand' | 'battlefield' | 'opponent' | 'none'

export interface OptionMatch {
  optionIndex: number
  label: string
  zone: MatchZone
  cardIds: number[]
  manaAbility?: boolean
}

/** Strips the " - description" suffix and any trailing "(id)" from a label. */
function cardNameFromLabel(label: string): string {
  const idx = label.indexOf(' - ')
  const name = idx >= 0 ? label.slice(0, idx) : label
  return name.replace(/\s*\(\d+\)\s*$/, '').trim()
}

const findIn = (cards: CardEntry[] | undefined, name: string) =>
  (cards ?? []).filter((c) => c.name === name).map((c) => c.id)

/** Detects a mana-ability tap option (e.g. "{T}: Add {G}") that auto-tap handles. */
function isManaAbility(label: string): boolean {
  const rest = label.includes(' - ') ? label.slice(label.indexOf(' - ') + 3) : ''
  return /\{T\}.*Add\s*\{[WUBRGC]\}/i.test(rest)
}

/**
 * Maps a single choice option onto a player's cards. Returns a match with the
 * zone + card ids, or a `none` match when the option is not a card (e.g.
 * "Keep", "Yes", a player name) so the UI can fall back to a text button.
 */
export function matchOptionToCard(
  type: string,
  label: string,
  pools: { hand: CardEntry[]; battlefield: CardEntry[]; opponent: CardEntry[] },
): OptionMatch {
  const name = cardNameFromLabel(label)
  const basic = (zone: MatchZone, cardIds: number[]): OptionMatch => ({
    optionIndex: -1,
    label,
    zone,
    cardIds,
  })

  if (type === 'attack' || type === 'block') {
    return basic('battlefield', findIn(pools.battlefield, name))
  }

  if (type === 'target') {
    let ids = findIn(pools.opponent, name)
    if (ids.length > 0) return basic('opponent', ids)
    ids = findIn(pools.battlefield, name)
    if (ids.length > 0) return basic('battlefield', ids)
    ids = findIn(pools.hand, name)
    if (ids.length > 0) return basic('hand', ids)
    return basic('none', [])
  }

  if (type === 'play') {
    const rest = label.includes(' - ') ? label.slice(label.indexOf(' - ') + 3) : ''
    // Activated/mana abilities live on battlefield permanents; casts are hand cards.
    const isAbility = /[{T}~:]|mana/i.test(rest)
    const manaTap = isManaAbility(label)
    if (isAbility) {
      let ids = findIn(pools.battlefield, name)
      if (ids.length > 0) return { ...basic('battlefield', ids), manaAbility: manaTap }
      ids = findIn(pools.hand, name)
      if (ids.length > 0) return { ...basic('hand', ids), manaAbility: manaTap }
      return { ...basic('none', []), manaAbility: manaTap }
    }
    let ids = findIn(pools.hand, name)
    if (ids.length > 0) return basic('hand', ids)
    ids = findIn(pools.battlefield, name)
    if (ids.length > 0) return basic('battlefield', ids)
    return basic('none', [])
  }

  // discard / reveal / choose / generic card picks -> hand first, then board.
  let ids = findIn(pools.hand, name)
  if (ids.length > 0) return basic('hand', ids)
  ids = findIn(pools.battlefield, name)
  if (ids.length > 0) return basic('battlefield', ids)
  return basic('none', [])
}

/** Maps every option of a pending choice onto cards. */
export function matchOptionsToCards(
  choice: PendingChoice,
  pools: { hand: CardEntry[]; battlefield: CardEntry[]; opponent: CardEntry[] },
  phase?: string | null,
): OptionMatch[] {
  const inCombat = isInCombatPhase(phase)
  const allCards = [...pools.hand, ...pools.battlefield]
  return choice.options.map((opt, i) => {
    const m = matchOptionToCard(choice.type, opt.label, pools)
    if (choice.type === 'play' && !inCombat && m.cardIds.length > 0) {
      const card = allCards.find((c) => m.cardIds.includes(c.id))
      if (card?.type?.toLowerCase() === 'instant') {
        return { ...m, zone: 'none' as const }
      }
    }
    return { ...m, optionIndex: i }
  })
}

/** Zones the choice actually uses, for highlighting the right card groups. */
export function interactiveZones(choice: PendingChoice): MatchZone[] {
  switch (choice.type) {
    case 'attack':
    case 'block':
      return ['battlefield']
    case 'target':
      return ['hand', 'battlefield', 'opponent']
    case 'play':
      return ['hand', 'battlefield']
    case 'discard':
    case 'reveal':
    case 'choose':
      return ['hand']
    default:
      return []
  }
}

/** Single-tap choices send immediately; multi-select needs a confirm button. */
export function isImmediateChoice(choice: PendingChoice): boolean {
  if (choice.type === 'play') return true
  if (choice.type === 'target') return choice.maxCount <= 1
  return false
}

/** Primary confirm button label for a choice (or null when N/A). */
export function primaryActionLabel(choice: PendingChoice): string | null {
  switch (choice.type) {
    case 'attack':
      return 'Attack'
    case 'block':
      return 'Block'
    case 'discard':
    case 'reveal':
    case 'choose':
      return 'Confirm'
    default:
      return null
  }
}
