export interface Player {
  id: string
  email: string
  displayName: string
  role: string
  avatar: string | null
  studentId: string | null
  degreeLevel: string | null
  specialization: string | null
  experience: number
  level: number
}

export interface AuthResponse {
  token: string
  tokenType: string
  player: Player
}

export type OwnershipType = 'UNLIMITED' | 'UNLOCK' | 'UNIQUE'

export interface CardDto {
  id: string
  oracleId: string
  forgeName: string
  rarity: string | null
  ownershipType: OwnershipType
  setCode: string | null
  manaValue: number | null
  types: string | null
  colors: string | null
  imageUrl: string | null
  discoverable: boolean
  spawnRegion: string | null
  weight: number | null
  commanderEligible: boolean
}

export interface CollectionEntryDto {
  cardId: string
  forgeName: string
  ownershipType: OwnershipType
  quantity: number
  discoveredCount: number
  favorite: boolean
}

export interface CollectionResponse {
  entries: CollectionEntryDto[]
  totalCount: number
}

export interface DiscoverResultDto {
  card: CardDto
  unlocked: boolean
  alreadyOwned: boolean
  discoveryCount: number
  experienceAwarded: number
}

export interface DeckCardDto {
  cardId: string
  forgeName: string
  quantity: number
}

export interface DeckDto {
  id: string
  name: string
  formatCode: string
  commanderCardId: string | null
  cards: DeckCardDto[]
  createdAt: string
  updatedAt: string
}

export interface DeckListResponse {
  decks: DeckDto[]
}

export interface DeckProblemDto {
  code: string
  message: string
  cardId: string | null
}

export interface DeckValidationResult {
  valid: boolean
  problems: DeckProblemDto[]
}

export interface ApiError {
  status: number
  message: string
  details: DeckProblemDto[] | null
}

export interface ClaimResult {
  card: CardDto
  unlocked: boolean
  alreadyOwned: boolean
  discoveryCount: number
  experienceAwarded: number
  token: string
  building: string | null
}

export interface BattleStatsDto {
  played: number
  wins: number
  losses: number
  winRatePercent: number
}

export interface BadgeDto {
  code: string
  name: string
  description: string
}

export interface ProfileStatsDto {
  player: Player
  experience: number
  level: number
  experienceToNextLevel: number
  collectionCompletionPercent: number
  ownedCards: number
  totalCards: number
  totalDiscoveries: number
  favoriteColors: string[]
  buildingsVisited: string[]
  battleStats: BattleStatsDto
  badges: BadgeDto[]
}

export interface PopularDeckDto {
  deckName: string
  playCount: number
}

export interface BuildingActivityDto {
  building: string
  claimCount: number
}

export type LeaderboardMetric = 'level' | 'collection' | 'winrate'

export type DegreeLevel = 'BTECH' | 'MTECH'

export const BTECH_SPECIALIZATIONS = [
  'CSE',
  'CSAI',
  'CSAM',
  'CSB',
  'CSSS',
  'CSD',
  'CSECON',
  'ECE',
  'EVE',
] as const

export const MTECH_SPECIALIZATIONS = ['CSE', 'ECE'] as const

export interface LeaderboardFilters {
  degreeLevel?: DegreeLevel
  specialization?: string
  department?: 'CSE' | 'ECE'
}

export interface LeaderboardRowDto {
  rank: number
  playerId: string
  displayName: string
  avatar: string | null
  degreeLevel: string | null
  specialization: string | null
  score: number
  value: number
}

export interface LeaderboardResponse {
  rows: LeaderboardRowDto[]
  myRank: number | null
}

export type TradeSide = 'OFFERED' | 'REQUESTED'

export type TradeStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED'

export interface UniqueCardDto {
  physicalUuid: string
  cardId: string
  forgeName: string
  setCode: string | null
  rarity: string | null
  imageUrl: string | null
  serialNumber: number
  claimedAt: string
  history: string | null
}

export interface TradePlayerDto {
  id: string
  displayName: string
  avatar: string | null
  studentId: string | null
  degreeLevel: string | null
  specialization: string | null
}

export interface TradeCardDto {
  physicalUuid: string
  cardId: string
  forgeName: string
  setCode: string | null
  rarity: string | null
  imageUrl: string | null
  serialNumber: number
}

export interface TradeDto {
  id: string
  status: TradeStatus
  sender: TradePlayerDto
  receiver: TradePlayerDto
  offered: TradeCardDto[]
  requested: TradeCardDto[]
  createdAt: string
  resolvedAt: string | null
  expiresAt: string | null
}

export interface CreateTradeRequest {
  receiverId: string
  offeredPhysicalUuids: string[]
  requestedPhysicalUuids: string[]
}

export interface PlayerSummaryDto {
  id: string
  displayName: string
  avatar: string | null
  studentId: string | null
  degreeLevel: string | null
  specialization: string | null
}

export type EventStatus = 'active' | 'upcoming' | 'ended'

export interface EventDto {
  id: string
  name: string
  allowedSets: string[]
  bonusMultiplier: number
  startTime: string
  endTime: string
  active: boolean
  createdAt: string
}

export type FeedType = 'DISCOVERY' | 'ACHIEVEMENT' | 'EVENT' | 'SPAWN' | 'TRADE'

export interface FeedEntryDto {
  type: FeedType
  message: string
  playerName: string | null
  createdAt: string
}
