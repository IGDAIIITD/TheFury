import api from './client'
import type {
  CreateTradeRequest,
  PlayerSummaryDto,
  TradeDto,
  UniqueCardDto,
} from './types'

export class TradeApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TradeApiError'
    this.status = status
  }
}

function toError(err: unknown, fallback: string): TradeApiError {
  const status = (err as { response?: { status?: number } })?.response?.status ?? 0
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
  return new TradeApiError(status, message ?? fallback)
}

export async function createTrade(request: CreateTradeRequest): Promise<TradeDto> {
  try {
    const { data } = await api.post<TradeDto>('/trades', request)
    return data
  } catch (err) {
    throw toError(err, 'Could not create trade')
  }
}

export async function getIncomingTrades(): Promise<TradeDto[]> {
  const { data } = await api.get<TradeDto[]>('/trades/incoming')
  return data
}

export async function getOutgoingTrades(): Promise<TradeDto[]> {
  const { data } = await api.get<TradeDto[]>('/trades/outgoing')
  return data
}

export async function getTrade(tradeId: string): Promise<TradeDto> {
  const { data } = await api.get<TradeDto>(`/trades/${tradeId}`)
  return data
}

export async function acceptTrade(tradeId: string): Promise<TradeDto> {
  try {
    const { data } = await api.post<TradeDto>(`/trades/${tradeId}/accept`)
    return data
  } catch (err) {
    throw toError(err, 'Could not accept trade')
  }
}

export async function declineTrade(tradeId: string): Promise<TradeDto> {
  try {
    const { data } = await api.post<TradeDto>(`/trades/${tradeId}/decline`)
    return data
  } catch (err) {
    throw toError(err, 'Could not decline trade')
  }
}

export async function cancelTrade(tradeId: string): Promise<TradeDto> {
  try {
    const { data } = await api.post<TradeDto>(`/trades/${tradeId}/cancel`)
    return data
  } catch (err) {
    throw toError(err, 'Could not cancel trade')
  }
}

export async function getMyUniqueCards(): Promise<UniqueCardDto[]> {
  const { data } = await api.get<UniqueCardDto[]>('/collection/unique')
  return data
}

export async function getPlayerUniqueCards(playerId: string): Promise<UniqueCardDto[]> {
  const { data } = await api.get<UniqueCardDto[]>(`/players/${playerId}/unique-cards`)
  return data
}

export async function searchPlayers(query: string): Promise<PlayerSummaryDto[]> {
  const { data } = await api.get<PlayerSummaryDto[]>('/players/search', {
    params: { q: query },
  })
  return data
}
