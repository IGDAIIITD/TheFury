import api from './client'
import type {
  BuildingActivityDto,
  CardDto,
  CollectionEntryDto,
  DeckDto,
  DeckValidationResult,
  EventDto,
  FeedEntryDto,
  LeaderboardFilters,
  LeaderboardMetric,
  LeaderboardResponse,
  PopularDeckDto,
  ProfileStatsDto,
} from './types'

export interface BrowseParams {
  name?: string
  ownershipType?: string
}

export async function browseCards(params: BrowseParams = {}): Promise<CardDto[]> {
  const { data } = await api.get<CardDto[]>('/cards', { params })
  return data
}

export async function getCollection(): Promise<CollectionEntryDto[]> {
  const { data } = await api.get<{ entries: CollectionEntryDto[] }>('/collection')
  return data.entries
}

export async function toggleFavorite(cardId: string): Promise<boolean> {
  const { data } = await api.put<{ favorite: boolean }>(`/collection/favorites/${cardId}`)
  return data.favorite
}

export async function listDecks(): Promise<DeckDto[]> {
  const { data } = await api.get<{ decks: DeckDto[] }>('/decks')
  return data.decks
}

export async function getDeck(id: string): Promise<DeckDto> {
  const { data } = await api.get<DeckDto>(`/decks/${id}`)
  return data
}

export interface SaveDeckInput {
  name: string
  formatCode: string
  commanderCardId: string | null
  cards: { cardId: string; quantity: number }[]
}

export async function createDeck(input: SaveDeckInput): Promise<DeckDto> {
  const { data } = await api.post<DeckDto>('/decks', input)
  return data
}

export async function updateDeck(id: string, input: SaveDeckInput): Promise<DeckDto> {
  const { data } = await api.put<DeckDto>(`/decks/${id}`, input)
  return data
}

export async function deleteDeck(id: string): Promise<void> {
  await api.delete(`/decks/${id}`)
}

export async function validateDeck(
  formatCode: string,
  commanderCardId: string | null,
  cards: { cardId: string; quantity: number }[],
): Promise<DeckValidationResult> {
  const { data } = await api.post<DeckValidationResult>('/decks/validate', {
    formatCode,
    commanderCardId,
    cards,
  })
  return data
}

export async function getMyStats(): Promise<ProfileStatsDto> {
  const { data } = await api.get<ProfileStatsDto>('/players/me/stats')
  return data
}

export async function getLeaderboard(
  metric: LeaderboardMetric = 'level',
  limit = 50,
  filters: LeaderboardFilters = {},
): Promise<LeaderboardResponse> {
  const { data } = await api.get<LeaderboardResponse>('/leaderboard', {
    params: { metric, limit, ...filters },
  })
  return data
}

export async function getPopularDecks(limit = 5): Promise<PopularDeckDto[]> {
  const { data } = await api.get<PopularDeckDto[]>('/analytics/decks', {
    params: { limit },
  })
  return data
}

export async function getActiveBuildings(limit = 5): Promise<BuildingActivityDto[]> {
  const { data } = await api.get<BuildingActivityDto[]>('/analytics/buildings', {
    params: { limit },
  })
  return data
}

export async function listEvents(): Promise<EventDto[]> {
  const { data } = await api.get<EventDto[]>('/events')
  return data
}

export async function getActiveEvents(): Promise<EventDto[]> {
  const { data } = await api.get<EventDto[]>('/events/active')
  return data
}

export async function getFeedHistory(): Promise<FeedEntryDto[]> {
  const { data } = await api.get<FeedEntryDto[]>('/feed')
  return data
}
