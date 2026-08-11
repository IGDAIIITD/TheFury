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

export interface CreateEventInput {
  name: string
  allowedSets: string[]
  bonusMultiplier: number
  startTime: string
  endTime: string
}

export interface CardDto {
  id: string
  forgeName: string
  setCode: string | null
  rarity: string | null
  ownershipType: string
}

export type ClaimStatus = 'ACTIVE' | 'CLAIMED' | 'EXPIRED' | 'REVOKED'

export interface ClaimDto {
  id: string
  token: string
  cardId: string
  forgeName: string
  building: string | null
  expiresAt: string | null
  status: ClaimStatus
  eventId: string | null
  eventName: string | null
  spawnedBy: string | null
  createdAt: string
}

export interface MintClaimInput {
  cardId: string
  building?: string
  expiresAt?: string | null
  quantity?: number
  eventId?: string | null
}

export interface AdminPlayerDto {
  id: string
  email: string
  displayName: string
  role: string
  studentId: string | null
  degreeLevel: string | null
  specialization: string | null
  experience: number
  level: number
  banned: boolean
  bannedAt: string | null
  created: string | null
  lastLogin: string | null
}

export type FeedType = 'DISCOVERY' | 'ACHIEVEMENT' | 'EVENT' | 'SPAWN' | 'TRADE'

export interface FeedEntryDto {
  type: FeedType
  message: string
  playerName: string | null
  createdAt: string
}
