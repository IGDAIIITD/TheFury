import { describe, expect, it } from 'vitest'
import type { MatchState, PendingChoice } from '../api/battleTypes'
import {
  friendlyPhase,
  phaseStrip,
  instructionFor,
  matchOptionToCard,
  matchOptionsToCards,
  interactiveZones,
  isImmediateChoice,
  primaryActionLabel,
  manaSourceColors,
  manaCostSymbols,
  availableMana,
  healthSegments,
  MANA_EMOJI,
  renderManaCost,
  describeManaCost,
} from './battleUi'

const card = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra })

const me = {
  index: 0,
  name: 'BattleTest',
  life: 20,
  hasPriority: true,
  hasLost: false,
  handSize: 3,
  librarySize: 30,
  hand: [card(1, 'Mountain'), card(2, 'Raging Goblin', { power: 1, toughness: 1 })],
  battlefield: [card(10, 'Mountain'), card(11, 'Grizzly Bears', { power: 2, toughness: 2 })],
  graveyard: [],
}

const opponent = {
  index: 1,
  name: 'Opponent',
  life: 20,
  hasPriority: false,
  hasLost: false,
  handSize: 4,
  librarySize: 28,
  hand: [],
  battlefield: [card(20, 'Hill Giant', { power: 3, toughness: 3 })],
  graveyard: [],
}

const baseState = (over: Partial<MatchState> = {}): MatchState => ({
  matchId: 'm1',
  player1Id: 'p1',
  player2Id: 'p2',
  turn: 1,
  phase: 'MAIN1',
  activePlayerIndex: 0,
  players: [me as never, opponent as never],
  stack: [],
  pendingChoice: null,
  ...over,
})

const choice = (over: Partial<PendingChoice> = {}): PendingChoice => ({
  requestId: 1,
  type: 'play',
  prompt: 'Cast a spell, activate an ability, or pass priority',
  cancellable: true,
  minCount: 0,
  maxCount: 1,
  options: [],
  ...over,
})

const pools = { hand: me.hand, battlefield: me.battlefield, opponent: opponent.battlefield }

describe('friendlyPhase', () => {
  it('labels known Forge phase names', () => {
    expect(friendlyPhase('COMBAT_DECLARE_ATTACKERS')).toBe('Declare Attackers')
    expect(friendlyPhase('END_OF_TURN')).toBe('End Step')
    expect(friendlyPhase('MAIN2')).toBe('Main Phase 2')
  })

  it('falls back to humanized raw names', () => {
    expect(friendlyPhase('SOME_WEIRD_PHASE')).toBe('Some Weird Phase')
  })

  it('handles null', () => {
    expect(friendlyPhase(null)).toBe('—')
  })
})

describe('phaseStrip', () => {
  it('highlights the current step', () => {
    const steps = phaseStrip('MAIN1')
    expect(steps.find((s) => s.active)?.key).toBe('MAIN1')
  })

  it('marks combat block while in a combat substep', () => {
    const steps = phaseStrip('COMBAT_DECLARE_ATTACKERS')
    const active = steps.filter((s) => s.active)
    expect(active.map((s) => s.key)).toContain('COMBAT_BEGIN')
    expect(active.map((s) => s.key)).toContain('COMBAT_DECLARE_ATTACKERS')
  })

  it('does not mark combat outside combat', () => {
    expect(phaseStrip('DRAW').every((s) => !s.inCombat)).toBe(true)
  })
})

describe('instructionFor', () => {
  it('explains a play decision', () => {
    const s = baseState({ pendingChoice: choice() })
    const i = instructionFor(s, me as never, opponent as never)
    expect(i.tone).toBe('action')
    expect(i.title).toContain('play a card or pass')
    expect(i.title).toContain('Main Phase')
  })

  it('explains attackers and blockers', () => {
    expect(instructionFor(baseState({ pendingChoice: choice({ type: 'attack' }) }), me as never, opponent as never).title).toBe(
      'Choose creatures to attack with',
    )
    expect(instructionFor(baseState({ pendingChoice: choice({ type: 'block' }) }), me as never, opponent as never).title).toBe(
      'Choose creatures to block with',
    )
  })

  it('explains mulligan and starting player', () => {
    expect(instructionFor(baseState({ pendingChoice: choice({ type: 'mulligan' }) }), me as never, opponent as never).title).toBe(
      'Keep this hand?',
    )
    expect(instructionFor(baseState({ pendingChoice: choice({ type: 'start' }) }), me as never, opponent as never).title).toBe(
      'Choose who plays first',
    )
  })

  it('says waiting during the opponent turn when I lack priority', () => {
    const noPriority = { ...me, hasPriority: false }
    const i = instructionFor(baseState({ activePlayerIndex: 1, phase: 'MAIN2' }), noPriority as never, opponent as never)
    expect(i.tone).toBe('wait')
    expect(i.title).toContain('Waiting for Opponent')
  })

  it('flags my priority when I have it even on opponent turn', () => {
    const i = instructionFor(baseState({ activePlayerIndex: 1, phase: 'MAIN2' }), me as never, opponent as never)
    expect(i.tone).toBe('info')
    expect(i.title).toContain('your priority')
  })

  it('flags my priority on own turn without a decision', () => {
    const i = instructionFor(baseState({}), me as never, opponent as never)
    expect(i.tone).toBe('info')
    expect(i.title).toContain('your priority')
  })
})

describe('matchOptionToCard', () => {
  it('matches attackers/blockers on the battlefield', () => {
    const attack = matchOptionToCard('attack', 'Grizzly Bears', pools)
    expect(attack.zone).toBe('battlefield')
    expect(attack.cardIds).toEqual([11])
    const block = matchOptionToCard('block', 'Grizzly Bears', pools)
    expect(block.zone).toBe('battlefield')
    expect(block.cardIds).toEqual([11])
  })

  it('matches playable land as a hand card', () => {
    const m = matchOptionToCard('play', 'Mountain - ', pools)
    expect(m.zone).toBe('hand')
    expect(m.cardIds).toEqual([1])
  })

  it('treats {T} activations as battlefield abilities', () => {
    const m = matchOptionToCard('play', 'Grizzly Bears - {T}: Add {G}.', pools)
    expect(m.zone).toBe('battlefield')
    expect(m.cardIds).toEqual([11])
  })

  it('treats creature casts as hand cards', () => {
    const m = matchOptionToCard('play', 'Raging Goblin - Summon creature, haste', pools)
    expect(m.zone).toBe('hand')
    expect(m.cardIds).toEqual([2])
  })

  it('matches targets on the opponent board, stripping trailing ids', () => {
    const m = matchOptionToCard('target', 'Hill Giant (123)', pools)
    expect(m.zone).toBe('opponent')
    expect(m.cardIds).toEqual([20])
  })

  it('matches discard/reveal from the hand', () => {
    const m = matchOptionToCard('discard', 'Mountain', pools)
    expect(m.zone).toBe('hand')
    expect(m.cardIds).toEqual([1])
  })

  it('returns none for non-card options', () => {
    for (const label of ['Keep', 'Mulligan', 'Yes', 'No', 'Opponent', 'BattleTest', 'Unknown Creature']) {
      expect(matchOptionToCard('confirm', label, pools).zone).toBe('none')
    }
  })

  it('highlights all copies of a duplicated card', () => {
    const dup = { ...pools, battlefield: [card(30, 'Mountain'), card(31, 'Mountain')] }
    const m = matchOptionToCard('attack', 'Mountain', { ...pools, battlefield: dup.battlefield })
    expect(m.cardIds).toEqual([30, 31])
  })
})

describe('matchOptionsToCards', () => {
  it('assigns option indices and skips non-cards', () => {
    const c = choice({
      type: 'discard',
      minCount: 1,
      maxCount: 2,
      options: [
        { label: 'Mountain', value: '0' },
        { label: 'Raging Goblin', value: '1' },
        { label: 'Hill Giant', value: '2' },
      ],
    })
    const matches = matchOptionsToCards(c, pools)
    expect(matches).toHaveLength(3)
    expect(matches[0]).toMatchObject({ optionIndex: 0, zone: 'hand', cardIds: [1] })
    expect(matches[1]).toMatchObject({ optionIndex: 1, zone: 'hand', cardIds: [2] })
    expect(matches[2]).toMatchObject({ optionIndex: 2, zone: 'none', cardIds: [] })
  })

  it('filters instant spells to none outside combat', () => {
    const instantPools = {
      hand: [
        card(30, 'Giant Growth', { type: 'Instant' }),
        card(31, 'Grizzly Bears', { type: 'Creature — Bear' }),
      ],
      battlefield: [card(10, 'Mountain')],
      opponent: [],
    }
    const c = choice({
      options: [
        { label: 'Giant Growth - G Target creature gets +3/+3', value: '0' },
        { label: 'Grizzly Bears - Summon creature', value: '1' },
        { label: 'Mountain - {T}: Add {R}. (mana)', value: '2' },
      ],
    })
    const matches = matchOptionsToCards(c, instantPools, 'MAIN1')
    const giantGrowth = matches.find((m) => m.label.includes('Giant Growth'))
    const grizzly = matches.find((m) => m.label.includes('Grizzly Bears'))
    expect(giantGrowth?.zone).toBe('none')
    expect(grizzly?.zone).toBe('hand')
  })

  it('keeps instant spells as cards during combat', () => {
    const instantPools = {
      hand: [card(30, 'Giant Growth', { type: 'Instant' })],
      battlefield: [card(10, 'Mountain')],
      opponent: [],
    }
    const c = choice({
      options: [{ label: 'Giant Growth - G Target creature gets +3/+3', value: '0' }],
    })
    const matches = matchOptionsToCards(c, instantPools, 'COMBAT_DECLARE_BLOCKERS')
    expect(matches[0].zone).toBe('hand')
    expect(matches[0].cardIds).toEqual([30])
  })
})

describe('interactiveZones', () => {
  it('limits attackers/blockers to the battlefield', () => {
    expect(interactiveZones(choice({ type: 'attack' }))).toEqual(['battlefield'])
    expect(interactiveZones(choice({ type: 'block' }))).toEqual(['battlefield'])
  })

  it('opens hand + battlefield for play decisions', () => {
    expect(interactiveZones(choice())).toEqual(['hand', 'battlefield'])
  })

  it('returns none for button-only decisions', () => {
    expect(interactiveZones(choice({ type: 'mulligan' }))).toEqual([])
  })
})

describe('isImmediateChoice / primaryActionLabel', () => {
  it('fires play instantly', () => {
    expect(isImmediateChoice(choice())).toBe(true)
  })

  it('single-target fires instantly, multi-target needs confirm', () => {
    expect(isImmediateChoice(choice({ type: 'target', maxCount: 1 }))).toBe(true)
    expect(isImmediateChoice(choice({ type: 'target', maxCount: 2 }))).toBe(false)
  })

  it('attack/block/discard need a confirm step', () => {
    expect(isImmediateChoice(choice({ type: 'attack' }))).toBe(false)
    expect(isImmediateChoice(choice({ type: 'block' }))).toBe(false)
    expect(isImmediateChoice(choice({ type: 'discard' }))).toBe(false)
  })

  it('labels primary confirm buttons', () => {
    expect(primaryActionLabel(choice({ type: 'attack' }))).toBe('Attack')
    expect(primaryActionLabel(choice({ type: 'block' }))).toBe('Block')
    expect(primaryActionLabel(choice({ type: 'discard' }))).toBe('Confirm')
    expect(primaryActionLabel(choice({ type: 'play' }))).toBeNull()
    expect(primaryActionLabel(choice({ type: 'mulligan' }))).toBeNull()
  })
})

describe('MANA_EMOJI', () => {
  it('uses emoji pips, not braces or hearts, for every color', () => {
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
      expect(MANA_EMOJI[color]).toBeTruthy()
      expect(MANA_EMOJI[color]).not.toContain('{')
      expect(MANA_EMOJI[color]).not.toContain('}️')
      expect(MANA_EMOJI[color]).not.toContain('❤')
      expect(MANA_EMOJI[color]).not.toContain('🤍')
      expect(MANA_EMOJI[color]).not.toContain('🩶')
    }
  })
})

describe('renderManaCost', () => {
  it('returns empty for null/undefined/empty', () => {
    expect(renderManaCost(undefined)).toEqual([])
    expect(renderManaCost(null)).toEqual([])
    expect(renderManaCost('')).toEqual([])
  })

  it('converts single colored pip to emoji', () => {
    const r = renderManaCost('{G}')
    expect(r).toHaveLength(1)
    expect(r[0]).toBe('🟢')
  })

  it('converts mixed cost to emoji pips + "+" separator + styled number', () => {
    const r = renderManaCost('{2}{R}{G}')
    expect(r).toHaveLength(4)
    expect(r[0]).not.toBe('🔴')
    expect(r[1]).toBe('+')
    expect(r[2]).toBe('🔴')
    expect(r[3]).toBe('🟢')
  })

  it('inserts separator between generic and first colored pip', () => {
    const r = renderManaCost('{2}{R}')
    expect(r).toHaveLength(3)
    expect(r[1]).toBe('+')
    expect(r[2]).toBe('🔴')
  })

  it('does not insert separator when no generic cost', () => {
    const r = renderManaCost('{R}{G}')
    expect(r).toHaveLength(2)
    expect(r[0]).toBe('🔴')
    expect(r[1]).toBe('🟢')
    expect(r).not.toContain('+')
  })

  it('converts {X} to styled symbol', () => {
    const r = renderManaCost('{X}')
    expect(r).toHaveLength(1)
    expect(r[0]).not.toBe('🔴')
  })

  it('converts all six mana colors', () => {
    expect(renderManaCost('{W}')[0]).toBe('⚪')
    expect(renderManaCost('{U}')[0]).toBe('🔵')
    expect(renderManaCost('{B}')[0]).toBe('⚫')
    expect(renderManaCost('{R}')[0]).toBe('🔴')
    expect(renderManaCost('{G}')[0]).toBe('🟢')
    expect(renderManaCost('{C}')[0]).toBe('⬜')
  })
})

describe('describeManaCost', () => {
  it('returns empty for null/undefined/empty', () => {
    expect(describeManaCost(undefined)).toBe('')
    expect(describeManaCost(null)).toBe('')
    expect(describeManaCost('')).toBe('')
  })

  it('describes single colored pip', () => {
    expect(describeManaCost('{R}')).toBe('1 mana: 1 red')
  })

  it('describes generic + colored', () => {
    expect(describeManaCost('{2}{R}')).toBe('3 mana: 2 generic + 1 red')
  })

  it('describes generic + multiple colored', () => {
    expect(describeManaCost('{2}{R}{G}')).toBe('4 mana: 2 generic + 1 red + 1 green')
  })

  it('describes generic only', () => {
    expect(describeManaCost('{4}')).toBe('4 mana: 4 generic')
  })
})

describe('manaAbility flag', () => {
  it('marks {T}: Add {G} as manaAbility', () => {
    const m = matchOptionToCard('play', 'Mountain - {T}: Add {R}.', pools)
    expect(m.manaAbility).toBe(true)
    expect(m.zone).toBe('battlefield')
  })

  it('does not mark non-mana abilities as manaAbility', () => {
    const m = matchOptionToCard('play', 'Grizzly Bears - {T}: Tap target creature.', pools)
    expect(m.manaAbility).toBeFalsy()
  })

  it('does not mark casts as manaAbility', () => {
    const m = matchOptionToCard('play', 'Raging Goblin - Summon creature, haste', pools)
    expect(m.manaAbility).toBeFalsy()
  })
})

describe('manaSourceColors / availableMana', () => {
  it('reads basic lands by name and other sources from their rules text', () => {
    expect(manaSourceColors(card(1, 'Mountain'))).toEqual(['R'])
    expect(manaSourceColors(card(2, 'Cinder Barrens', { text: '{T}: Add {B} or {R}.' }))).toEqual(['B', 'R'])
    expect(manaSourceColors(card(3, 'Llanowar Elves', { text: '{T}: Add {G}.' }))).toEqual(['G'])
    expect(manaSourceColors(card(4, 'Manalith', { text: '{T}: Add one mana of any color.' }))).toEqual(['W', 'U', 'B', 'R', 'G'])
    expect(manaSourceColors(card(5, 'Grizzly Bears', { text: '' }))).toEqual([])
  })

  it('counts untapped sources plus floating mana; tapped sources do not count', () => {
    const board = [
      card(1, 'Mountain'),
      card(2, 'Mountain', { tapped: true }),
      card(3, 'Forest'),
      card(4, 'Cinder Barrens', { text: '{T}: Add {B} or {R}.' }),
      card(5, 'Grizzly Bears'),
    ]
    const m = availableMana(board, { U: 1 })
    expect(m.byColor).toEqual({ W: 0, U: 1, B: 1, R: 2, G: 1, C: 0 })
    expect(m.floating).toBe(1)
    expect(m.total).toBe(4)
  })

  it('is all zeros for an empty board', () => {
    expect(availableMana(undefined, null)).toEqual({ byColor: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, floating: 0, total: 0 })
  })
})

describe('healthSegments', () => {
  it('lights one of 20 segments per life point', () => {
    expect(healthSegments(20)).toEqual({ filled: 20, total: 20, overflow: 0 })
    expect(healthSegments(7)).toEqual({ filled: 7, total: 20, overflow: 0 })
  })
  it('clamps at zero and reports life gain above 20 as overflow', () => {
    expect(healthSegments(-3)).toEqual({ filled: 0, total: 20, overflow: 0 })
    expect(healthSegments(24)).toEqual({ filled: 20, total: 20, overflow: 4 })
  })
})

describe('matchOptionsToCards with identical cards', () => {
  const warriors = {
    hand: [],
    battlefield: [card(21, 'Elvish Warrior'), card(22, 'Elvish Warrior'), card(23, 'Forest')],
    opponent: [],
  }

  it('uses the engine card id when present, one option per card', () => {
    const c = choice({
      type: 'attack',
      options: [
        { label: 'Elvish Warrior', value: '0', cardId: 22 },
        { label: 'Elvish Warrior', value: '1', cardId: 21 },
      ],
    })
    const m = matchOptionsToCards(c, warriors)
    expect(m.map((x) => [x.optionIndex, x.zone, x.cardIds])).toEqual([
      [0, 'battlefield', [22]],
      [1, 'battlefield', [21]],
    ])
  })

  it('without card ids, gives same-name options their own card instead of the first option taking both', () => {
    const c = choice({
      type: 'attack',
      options: [
        { label: 'Elvish Warrior', value: '0' },
        { label: 'Elvish Warrior', value: '1' },
      ],
    })
    const m = matchOptionsToCards(c, warriors)
    expect(m.map((x) => x.cardIds)).toEqual([[21], [22]])
  })

  it('a card id that is on no visible zone maps to a text option', () => {
    const c = choice({ type: 'target', options: [{ label: 'Hidden', value: '0', cardId: 999 }] })
    expect(matchOptionsToCards(c, warriors)[0].zone).toBe('none')
  })
})

describe('manaCostSymbols', () => {
  it('splits generic mana from one pip per colored symbol', () => {
    expect(manaCostSymbols('{2}{G}{G}')).toEqual([
      { kind: 'generic', amount: 2 },
      { kind: 'color', color: 'G' },
      { kind: 'color', color: 'G' },
    ])
    expect(manaCostSymbols('{R}')).toEqual([{ kind: 'color', color: 'R' }])
  })
  it('drops {0}, keeps X / hybrid as other, and handles no cost', () => {
    expect(manaCostSymbols('{0}')).toEqual([])
    expect(manaCostSymbols('{X}{R/G}')).toEqual([
      { kind: 'other', text: 'X' },
      { kind: 'other', text: 'R/G' },
    ])
    expect(manaCostSymbols(null)).toEqual([])
  })
})
