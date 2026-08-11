import api from './client'
import type { BattleFeatures, MatchDto, MatchState } from './battleTypes'

export async function listMatches(): Promise<MatchDto[]> {
  const { data } = await api.get<MatchDto[]>('/battle/matches')
  return data
}

export async function createMatch(deckId: string, opponentPlayerId?: string, opponentDeckId?: string): Promise<MatchDto> {
  const { data } = await api.post<MatchDto>('/battle/create', { deckId, opponentPlayerId, opponentDeckId })
  return data
}

export async function createLobby(deckId: string): Promise<MatchDto> {
  const { data } = await api.post<MatchDto>('/battle/lobby', { deckId })
  return data
}

export async function joinMatch(code: string, deckId: string): Promise<MatchDto> {
  const { data } = await api.post<MatchDto>('/battle/join', { code, deckId })
  return data
}

export async function getBattleFeatures(): Promise<BattleFeatures> {
  const { data } = await api.get<BattleFeatures>('/battle/features')
  return data
}

export async function concedeMatch(matchId: string): Promise<void> {
  await api.post(`/battle/matches/${matchId}/concede`)
}

export async function getMatchState(matchId: string): Promise<MatchState> {
  const { data } = await api.get<MatchState>(`/battle/matches/${matchId}/state`)
  return data
}
