export interface MatchDto {
  id: string
  player1Id: string
  player2Id: string | null
  deck1Id: string
  deck2Id: string | null
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CONCEDED'
  winnerId: string | null
  battleCode: string | null
  createdAt: string
}

export interface CardEntry {
  id: number
  name: string
  type?: string | null
  cost?: string | null
  power?: number
  toughness?: number
  tapped?: boolean
  attacking?: boolean
  blocking?: boolean
  damage?: number
  text?: string | null
}

export interface MatchPlayerState {
  index: number
  name: string
  life: number
  hasPriority: boolean
  hasLost: boolean
  handSize: number
  librarySize: number
  hand: CardEntry[]
  battlefield: CardEntry[]
  graveyard: CardEntry[]
  /** Live mana pool keyed by W/U/B/R/G/C (public info). */
  mana?: Record<string, number>
}

export interface StackItemState {
  cardName: string | null
  activatingPlayerIndex: number
  isAbility: boolean
}

export interface PendingChoiceOption {
  label: string
  value: string
}

export interface PendingChoice {
  requestId: number
  type: string
  prompt: string
  cancellable: boolean
  minCount: number
  maxCount: number
  options: PendingChoiceOption[]
}

/** Live game state pushed by the backend from the embedded Forge engine. */
export interface MatchState {
  matchId: string
  player1Id: string
  player2Id: string | null
  turn: number
  phase: string | null
  activePlayerIndex: number
  players: MatchPlayerState[]
  stack: StackItemState[]
  pendingChoice: PendingChoice | null
  gameOver?: boolean
  winCondition?: string | null
  winnerName?: string | null
  status?: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CONCEDED'
  winnerId?: string | null
}

export interface BattleFeatures {
  aiBattlesEnabled: boolean
}
