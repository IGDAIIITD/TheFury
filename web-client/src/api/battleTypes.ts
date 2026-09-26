export interface MatchDto {
  id: string
  player1Id: string
  player2Id: string | null
  deck1Id: string
  deck2Id: string | null
  status: MatchStatus
  winnerId: string | null
  battleCode: string | null
  createdAt: string
}

/** EXPIRED = nobody joined the lobby within 2 minutes; CANCELLED = the host closed it. */
export type MatchStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CONCEDED' | 'EXPIRED' | 'CANCELLED'

/** A battle lobby stays open this long (the engine closes it after that). */
export const LOBBY_TTL_MS = 2 * 60 * 1000

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
  /** The card this option is about (newer engines); lets identical cards be told apart. */
  cardId?: number
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
  status?: MatchStatus
  winnerId?: string | null
  /** Set on the REST fallback for matches that aren't running (e.g. a waiting lobby). */
  createdAt?: string
}

export interface BattleFeatures {
  aiBattlesEnabled: boolean
}
