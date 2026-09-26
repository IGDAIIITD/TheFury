import type { MatchDto, MatchState } from '../api/battleTypes'

/**
 * A mid-game board for working on the battle UI without the engine: open
 * /battle?mock in `npm run dev`. Factories, not constants, so production builds drop
 * this module entirely (BattlePage only calls them behind import.meta.env.DEV).
 */
export const mockMatch = (): MatchDto => ({
  id: '00000000-0000-4000-8000-00000000mock',
  player1Id: 'mock-me',
  player2Id: 'mock-opponent',
  deck1Id: 'deck-1',
  deck2Id: 'deck-2',
  status: 'ACTIVE',
  winnerId: null,
  battleCode: 'MOCK01',
  createdAt: new Date().toISOString(),
})

const land = (id: number, name: string, tapped = false) => ({ id, name, type: 'Basic Land', tapped })
const creature = (id: number, name: string, cost: string, power: number, toughness: number, extra = {}) => ({
  id,
  name,
  type: 'Creature',
  cost,
  power,
  toughness,
  ...extra,
})

export const mockState = (): MatchState => ({
  matchId: mockMatch().id,
  player1Id: 'mock-me',
  player2Id: 'mock-opponent',
  turn: 6,
  phase: 'MAIN1',
  activePlayerIndex: 0,
  stack: [],
  players: [
    {
      index: 0,
      name: 'You',
      life: 14,
      hasPriority: true,
      hasLost: false,
      handSize: 4,
      librarySize: 41,
      mana: { R: 1 },
      hand: [
        creature(101, 'Hill Giant', '{3}{R}', 3, 3),
        creature(102, 'Craw Wurm', '{4}{G}{G}', 6, 4),
        creature(103, 'Raging Goblin', '{R}', 1, 1),
        { id: 104, name: 'Forest', type: 'Basic Land' },
      ],
      battlefield: [
        land(1, 'Mountain'),
        land(2, 'Mountain', true),
        land(3, 'Forest'),
        land(4, 'Forest'),
        land(5, 'Island'),
        creature(6, 'Grizzly Bears', '{1}{G}', 2, 2),
        creature(7, 'Goblin Piker', '{1}{R}', 2, 1, { tapped: true }),
      ],
      graveyard: [creature(8, 'Elvish Warrior', '{G}{G}', 2, 3)],
    },
    {
      index: 1,
      name: 'Opponent',
      life: 4,
      hasPriority: false,
      hasLost: false,
      handSize: 3,
      librarySize: 38,
      mana: {},
      hand: [],
      battlefield: [
        land(11, 'Forest'),
        land(12, 'Forest', true),
        land(13, 'Mountain'),
        creature(14, 'War Mammoth', '{3}{G}', 3, 3),
        creature(15, 'Fire Elemental', '{3}{R}{R}', 5, 4, { damage: 2 }),
      ],
      graveyard: [],
    },
  ],
  pendingChoice: {
    requestId: 1,
    type: 'play',
    prompt: 'Play a spell or ability',
    cancellable: true,
    minCount: 0,
    maxCount: 1,
    options: [
      { label: 'Hill Giant - Creature 3 / 3', value: '0' },
      { label: 'Raging Goblin - Creature 1 / 1', value: '1' },
      { label: 'Play land: Forest', value: '2' },
    ],
  },
})
