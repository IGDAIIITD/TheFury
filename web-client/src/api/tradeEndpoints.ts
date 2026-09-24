import { supabase } from './supabaseClient'
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

/** SQLSTATEs raised by the game RPCs are 'CF' + the intended HTTP status. */
function rpcStatus(err: unknown): number {
  const code = (err as { code?: string })?.code ?? ''
  if (code.startsWith('CF')) {
    const n = Number(code.slice(2))
    if (n >= 400 && n < 500) return n
  }
  return 0
}

function toError(err: unknown, fallback: string): TradeApiError {
  const message = (err as { message?: string })?.message
  return new TradeApiError(rpcStatus(err), message ?? fallback)
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new TradeApiError(401, 'Not authenticated')
  return id
}

async function listAll(): Promise<TradeDto[]> {
  const { data, error } = await supabase.rpc('list_my_trades', { p_direction: 'ALL' })
  if (error) throw toError(error, 'Could not load trades')
  return (data as TradeDto[]) ?? []
}

async function findTrade(tradeId: string): Promise<TradeDto> {
  const trades = await listAll()
  const found = trades.find((t) => t.id === tradeId)
  if (!found) throw new TradeApiError(404, `Trade not found: ${tradeId}`)
  return found
}

export async function createTrade(request: CreateTradeRequest): Promise<TradeDto> {
  const { data, error } = await supabase.rpc('create_trade', {
    p_receiver: request.receiverId,
    p_offered: request.offeredPhysicalUuids,
    p_requested: request.requestedPhysicalUuids,
  })
  if (error) throw toError(error, 'Could not create trade')
  return findTrade(data as string)
}

export async function getIncomingTrades(): Promise<TradeDto[]> {
  const { data, error } = await supabase.rpc('list_my_trades', { p_direction: 'INCOMING' })
  if (error) throw toError(error, 'Could not load trades')
  return (data as TradeDto[]) ?? []
}

export async function getOutgoingTrades(): Promise<TradeDto[]> {
  const { data, error } = await supabase.rpc('list_my_trades', { p_direction: 'OUTGOING' })
  if (error) throw toError(error, 'Could not load trades')
  return (data as TradeDto[]) ?? []
}

export async function getTrade(tradeId: string): Promise<TradeDto> {
  return findTrade(tradeId)
}

export async function acceptTrade(tradeId: string): Promise<TradeDto> {
  const { error } = await supabase.rpc('accept_trade', { p_trade: tradeId })
  if (error) throw toError(error, 'Could not accept trade')
  return findTrade(tradeId)
}

export async function declineTrade(tradeId: string): Promise<TradeDto> {
  const { error } = await supabase.rpc('resolve_trade', { p_trade: tradeId, p_action: 'DECLINED' })
  if (error) throw toError(error, 'Could not decline trade')
  return findTrade(tradeId)
}

export async function cancelTrade(tradeId: string): Promise<TradeDto> {
  const { error } = await supabase.rpc('resolve_trade', { p_trade: tradeId, p_action: 'CANCELLED' })
  if (error) throw toError(error, 'Could not cancel trade')
  return findTrade(tradeId)
}

interface UniqueCardRow {
  physical_uuid: string
  card_id: string
  forge_name: string
  set_code: string | null
  rarity: string | null
  image_url: string | null
  serial_number: number
  claimed_at: string
  history: string | null
}

function toUniqueCard(r: UniqueCardRow): UniqueCardDto {
  return {
    physicalUuid: r.physical_uuid,
    cardId: r.card_id,
    forgeName: r.forge_name,
    setCode: r.set_code,
    rarity: r.rarity,
    imageUrl: r.image_url,
    serialNumber: r.serial_number,
    claimedAt: r.claimed_at,
    history: r.history,
  }
}

export async function getMyUniqueCards(): Promise<UniqueCardDto[]> {
  const uid = await requireUserId()
  const { data, error } = await supabase.rpc('player_unique_cards', { p_player: uid })
  if (error) throw toError(error, 'Could not load unique cards')
  return (data as UniqueCardRow[]).map(toUniqueCard)
}

export async function getPlayerUniqueCards(playerId: string): Promise<UniqueCardDto[]> {
  const { data, error } = await supabase.rpc('player_unique_cards', { p_player: playerId })
  if (error) throw toError(error, 'Could not load unique cards')
  return (data as UniqueCardRow[]).map(toUniqueCard)
}

interface PlayerRow {
  id: string
  display_name: string
  avatar: string | null
  student_id: string | null
  degree_level: string | null
  specialization: string | null
}

export async function searchPlayers(query: string): Promise<PlayerSummaryDto[]> {
  const { data, error } = await supabase.rpc('search_players', { p_query: query })
  if (error) throw toError(error, 'Could not search players')
  return (data as PlayerRow[]).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    avatar: r.avatar,
    studentId: r.student_id,
    degreeLevel: r.degree_level,
    specialization: r.specialization,
  }))
}
