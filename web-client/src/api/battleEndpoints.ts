import axios from 'axios'
import { battleRestBase, battleToken } from './battleConfig'
import type { BattleFeatures, MatchDto, MatchState } from './battleTypes'

const battleApi = axios.create()

battleApi.interceptors.request.use(async (config) => {
  // resolved per request: the engine URL can be discovered (or change) after load
  config.baseURL = battleRestBase()
  const token = await battleToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

battleApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error('401 Unauthorized encountered on battle engine:', error.config?.url)
    }
    return Promise.reject(error)
  },
)

export async function createMatch(deckId: string, opponentPlayerId?: string, opponentDeckId?: string): Promise<MatchDto> {
  const { data } = await battleApi.post<MatchDto>('/battle/create', { deckId, opponentPlayerId, opponentDeckId })
  return data
}

export async function createLobby(deckId: string): Promise<MatchDto> {
  const { data } = await battleApi.post<MatchDto>('/battle/lobby', { deckId })
  return data
}

export async function joinMatch(code: string, deckId: string): Promise<MatchDto> {
  const { data } = await battleApi.post<MatchDto>('/battle/join', { code, deckId })
  return data
}

export async function getBattleFeatures(): Promise<BattleFeatures> {
  const { data } = await battleApi.get<BattleFeatures>('/battle/features')
  return data
}

export async function concedeMatch(matchId: string): Promise<void> {
  await battleApi.post(`/battle/matches/${matchId}/concede`)
}

export async function getMatchState(matchId: string): Promise<MatchState> {
  const { data } = await battleApi.get<MatchState>(`/battle/matches/${matchId}/state`)
  return data
}
export async function getMatch(matchId: string): Promise<MatchDto> {
  const { data } = await battleApi.get<MatchDto>(`/battle/matches/${matchId}`)
  return data
}

/** Host closes their own waiting lobby (it leaves the open-battles feed). */
export async function cancelLobby(matchId: string): Promise<void> {
  await battleApi.post(`/battle/matches/${matchId}/cancel`)
}
