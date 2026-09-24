import { supabase } from './supabaseClient'
import type {
  BuildingActivityDto,
  CardDto,
  CollectionEntryDto,
  DeckDto,
  DeckProblemDto,
  DeckValidationResult,
  EventDto,
  FeedEntryDto,
  LeaderboardFilters,
  LeaderboardMetric,
  LeaderboardResponse,
  OwnershipType,
  PopularDeckDto,
  ProfileStatsDto,
} from './types'

export interface BrowseParams {
  name?: string
  ownershipType?: string
}

/** Error thrown when a deck fails server-side validation on save. */
export class DeckValidationError extends Error {
  response: { data: { message: string; details: DeckProblemDto[] } }
  constructor(message: string, details: DeckProblemDto[]) {
    super(message)
    this.name = 'DeckValidationError'
    this.response = { data: { message, details } }
  }
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not authenticated')
  return id
}

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message ?? fallback)
}

// ---------------------------------------------------------------
// Card catalog
// ---------------------------------------------------------------

interface CardRow {
  id: string
  oracle_id: string
  forge_name: string
  rarity: string | null
  ownership_type: OwnershipType
  set_code: string | null
  mana_value: number | null
  types: string | null
  colors: string | null
  image_url: string | null
  discoverable: boolean
  spawn_region: string | null
  weight: number | null
  commander_eligible: boolean
  requires_unlock?: boolean
}

function toCard(r: CardRow): CardDto {
  return {
    id: r.id,
    oracleId: r.oracle_id,
    forgeName: r.forge_name,
    rarity: r.rarity,
    ownershipType: r.ownership_type,
    setCode: r.set_code,
    manaValue: r.mana_value,
    types: r.types,
    colors: r.colors,
    imageUrl: r.image_url,
    discoverable: r.discoverable,
    spawnRegion: r.spawn_region,
    weight: r.weight,
    commanderEligible: r.commander_eligible,
    requiresUnlock: r.requires_unlock ?? false,
  }
}

export async function browseCards(params: BrowseParams = {}): Promise<CardDto[]> {
  let query = supabase.from('cards').select('*')
  if (params.name) query = query.ilike('forge_name', `%${params.name}%`)
  if (params.ownershipType) query = query.eq('ownership_type', params.ownershipType)
  const { data, error } = await query.order('forge_name', { ascending: true })
  if (error) fail(error, 'Could not load cards')
  return (data as CardRow[]).map(toCard)
}

// ---------------------------------------------------------------
// Collection
// ---------------------------------------------------------------

const UNLIMITED_QUANTITY = 2147483647

export async function getCollection(): Promise<CollectionEntryDto[]> {
  const uid = await requireUserId()
  const [cardsRes, unlocksRes, uniquesRes, discRes, favRes] = await Promise.all([
    supabase.from('cards').select('*'),
    supabase.from('player_unlocks').select('card_id').eq('player_id', uid),
    supabase.from('unique_cards').select('card_id').eq('owner_id', uid),
    supabase.from('discoveries').select('card_id, count').eq('player_id', uid),
    supabase.from('favorites').select('card_id').eq('player_id', uid),
  ])
  if (cardsRes.error) fail(cardsRes.error, 'Could not load cards')
  if (unlocksRes.error) fail(unlocksRes.error, 'Could not load collection')
  if (uniquesRes.error) fail(uniquesRes.error, 'Could not load collection')
  if (discRes.error) fail(discRes.error, 'Could not load collection')
  if (favRes.error) fail(favRes.error, 'Could not load collection')

  const unlockCounts = new Map<string, number>()
  for (const row of unlocksRes.data as { card_id: string }[]) {
    unlockCounts.set(row.card_id, (unlockCounts.get(row.card_id) ?? 0) + 1)
  }
  const uniqueCounts = new Map<string, number>()
  for (const row of uniquesRes.data as { card_id: string }[]) {
    uniqueCounts.set(row.card_id, (uniqueCounts.get(row.card_id) ?? 0) + 1)
  }
  const discoveryCounts = new Map<string, number>()
  for (const row of discRes.data as { card_id: string; count: number }[]) {
    discoveryCounts.set(row.card_id, Number(row.count))
  }
  const favorites = new Set((favRes.data as { card_id: string }[]).map((r) => r.card_id))

  const entries: CollectionEntryDto[] = []
  for (const card of cardsRes.data as CardRow[]) {
    let quantity = 0
    // UNLIMITED: free (base 15), or unlocked by one scan (an unlock row) → unlimited copies
    if (card.ownership_type === 'UNLIMITED') {
      quantity = !card.requires_unlock || unlockCounts.has(card.id) ? UNLIMITED_QUANTITY : 0
    }
    else if (card.ownership_type === 'UNLOCK') quantity = unlockCounts.get(card.id) ?? 0
    else quantity = uniqueCounts.get(card.id) ?? 0
    if (quantity > 0) {
      entries.push({
        cardId: card.id,
        forgeName: card.forge_name,
        ownershipType: card.ownership_type,
        quantity,
        discoveredCount: discoveryCounts.get(card.id) ?? 0,
        favorite: favorites.has(card.id),
      })
    }
  }
  entries.sort((a, b) => a.forgeName.localeCompare(b.forgeName))
  return entries
}

export async function toggleFavorite(cardId: string): Promise<boolean> {
  const uid = await requireUserId()
  const { data: existing, error: findError } = await supabase
    .from('favorites')
    .select('id')
    .eq('player_id', uid)
    .eq('card_id', cardId)
    .maybeSingle()
  if (findError) fail(findError, 'Could not update favorite')

  if (existing) {
    const { error } = await supabase.from('favorites').delete().eq('id', (existing as { id: string }).id)
    if (error) fail(error, 'Could not update favorite')
    return false
  }
  const { error } = await supabase
    .from('favorites')
    .insert({ id: crypto.randomUUID(), player_id: uid, card_id: cardId })
  if (error) fail(error, 'Could not update favorite')
  return true
}

// ---------------------------------------------------------------
// Decks
// ---------------------------------------------------------------

interface DeckRow {
  id: string
  name: string
  format_code: string
  commander_card_id: string | null
  created_at: string
  updated_at: string
}

interface DeckCardRow {
  deck_id: string
  card_id: string
  quantity: number
  cards: { forge_name: string } | { forge_name: string }[] | null
}

function forgeNameOf(row: DeckCardRow): string {
  const c = row.cards
  if (!c) return ''
  return Array.isArray(c) ? c[0]?.forge_name ?? '' : c.forge_name
}

function toDeck(deck: DeckRow, cards: DeckCardRow[]): DeckDto {
  const mapped = cards
    .map((c) => ({ cardId: c.card_id, forgeName: forgeNameOf(c), quantity: c.quantity }))
    .sort((a, b) => a.forgeName.localeCompare(b.forgeName, undefined, { sensitivity: 'base' }))
  return {
    id: deck.id,
    name: deck.name,
    formatCode: deck.format_code,
    commanderCardId: deck.commander_card_id,
    cards: mapped,
    createdAt: deck.created_at,
    updatedAt: deck.updated_at,
  }
}

async function loadDeckCards(deckIds: string[]): Promise<DeckCardRow[]> {
  if (deckIds.length === 0) return []
  const { data, error } = await supabase
    .from('deck_cards')
    .select('deck_id, card_id, quantity, cards(forge_name)')
    .in('deck_id', deckIds)
  if (error) fail(error, 'Could not load decks')
  return data as DeckCardRow[]
}

export async function listDecks(): Promise<DeckDto[]> {
  const uid = await requireUserId()
  const { data, error } = await supabase
    .from('decks')
    .select('*')
    .eq('player_id', uid)
    .order('updated_at', { ascending: false })
  if (error) fail(error, 'Could not load decks')
  const decks = data as DeckRow[]
  const cards = await loadDeckCards(decks.map((d) => d.id))
  const byDeck = new Map<string, DeckCardRow[]>()
  for (const c of cards) {
    const list = byDeck.get(c.deck_id) ?? []
    list.push(c)
    byDeck.set(c.deck_id, list)
  }
  return decks.map((d) => toDeck(d, byDeck.get(d.id) ?? []))
}

export async function getDeck(id: string): Promise<DeckDto> {
  const { data, error } = await supabase.from('decks').select('*').eq('id', id).maybeSingle()
  if (error) fail(error, 'Could not load deck')
  if (!data) throw new Error(`Deck not found: ${id}`)
  const cards = await loadDeckCards([id])
  return toDeck(data as DeckRow, cards)
}

export interface SaveDeckInput {
  name: string
  formatCode: string
  commanderCardId: string | null
  cards: { cardId: string; quantity: number }[]
}

async function assertValid(input: SaveDeckInput): Promise<void> {
  const { data, error } = await supabase.rpc('validate_deck_spec', {
    p_format_code: input.formatCode,
    p_commander: input.commanderCardId,
    p_cards: input.cards,
  })
  if (error) fail(error, 'Validation failed on the server.')
  const result = data as DeckValidationResult | null
  if (result && !result.valid) {
    throw new DeckValidationError('Deck is not valid', result.problems)
  }
}

async function writeDeckCards(deckId: string, cards: { cardId: string; quantity: number }[]): Promise<void> {
  const merged = new Map<string, number>()
  for (const c of cards) merged.set(c.cardId, (merged.get(c.cardId) ?? 0) + c.quantity)
  const rows = [...merged.entries()].map(([cardId, quantity]) => ({
    id: crypto.randomUUID(),
    deck_id: deckId,
    card_id: cardId,
    quantity,
  }))
  const { error: delError } = await supabase.from('deck_cards').delete().eq('deck_id', deckId)
  if (delError) fail(delError, 'Could not save deck')
  if (rows.length > 0) {
    const { error } = await supabase.from('deck_cards').insert(rows)
    if (error) fail(error, 'Could not save deck')
  }
}

export async function createDeck(input: SaveDeckInput): Promise<DeckDto> {
  const uid = await requireUserId()
  await assertValid(input)
  const id = crypto.randomUUID()
  const { data, error } = await supabase
    .from('decks')
    .insert({
      id,
      player_id: uid,
      name: input.name,
      format_code: input.formatCode,
      commander_card_id: input.commanderCardId,
    })
    .select('*')
    .single()
  if (error) fail(error, 'Could not save deck')
  await writeDeckCards(id, input.cards)
  const cards = await loadDeckCards([id])
  return toDeck(data as DeckRow, cards)
}

export async function updateDeck(id: string, input: SaveDeckInput): Promise<DeckDto> {
  const uid = await requireUserId()
  await assertValid(input)
  const { data, error } = await supabase
    .from('decks')
    .update({
      name: input.name,
      format_code: input.formatCode,
      commander_card_id: input.commanderCardId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('player_id', uid)
    .select('*')
    .single()
  if (error) fail(error, 'Could not save deck')
  await writeDeckCards(id, input.cards)
  const cards = await loadDeckCards([id])
  return toDeck(data as DeckRow, cards)
}

export async function deleteDeck(id: string): Promise<void> {
  const uid = await requireUserId()
  const { error } = await supabase.from('decks').delete().eq('id', id).eq('player_id', uid)
  if (error) fail(error, 'Could not delete deck')
}

export async function validateDeck(
  formatCode: string,
  commanderCardId: string | null,
  cards: { cardId: string; quantity: number }[],
): Promise<DeckValidationResult> {
  const { data, error } = await supabase.rpc('validate_deck_spec', {
    p_format_code: formatCode,
    p_commander: commanderCardId,
    p_cards: cards,
  })
  if (error) fail(error, 'Validation failed on the server.')
  return (data as DeckValidationResult) ?? { valid: true, problems: [] }
}

// ---------------------------------------------------------------
// Profile / leaderboard / analytics
// ---------------------------------------------------------------

export async function getMyStats(): Promise<ProfileStatsDto> {
  const { data, error } = await supabase.rpc('my_profile_stats')
  if (error) fail(error, 'Could not load stats')
  return data as ProfileStatsDto
}

export async function getLeaderboard(
  metric: LeaderboardMetric = 'level',
  limit = 50,
  filters: LeaderboardFilters = {},
): Promise<LeaderboardResponse> {
  const { data, error } = await supabase.rpc('leaderboard_full', {
    p_metric: metric,
    p_degree_level: filters.degreeLevel ?? null,
    p_specialization: filters.specialization ?? null,
    p_department: filters.department ?? null,
    p_limit: limit,
  })
  if (error) fail(error, 'Could not load leaderboard')
  const result = data as { rows: LeaderboardResponse['rows']; myRank: number | null } | null
  return { rows: result?.rows ?? [], myRank: result?.myRank ?? null }
}

export async function getPopularDecks(limit = 5): Promise<PopularDeckDto[]> {
  const { data, error } = await supabase.rpc('popular_decks', { p_limit: limit })
  if (error) fail(error, 'Could not load analytics')
  return (data as { deck_name: string; play_count: number }[]).map((r) => ({
    deckName: r.deck_name,
    playCount: Number(r.play_count),
  }))
}

export async function getActiveBuildings(limit = 5): Promise<BuildingActivityDto[]> {
  const { data, error } = await supabase.rpc('active_buildings', { p_limit: limit })
  if (error) fail(error, 'Could not load analytics')
  return (data as { building: string; claims: number }[]).map((r) => ({
    building: r.building,
    claimCount: Number(r.claims),
  }))
}

// ---------------------------------------------------------------
// Events / feed
// ---------------------------------------------------------------

interface EventRow {
  id: string
  name: string
  allowed_sets_json: string
  bonus_multiplier: number | string
  start_time: string
  end_time: string
  active: boolean
  created_at: string
}

function toEvent(r: EventRow): EventDto {
  let allowedSets: string[] = []
  try {
    const parsed = JSON.parse(r.allowed_sets_json)
    if (Array.isArray(parsed)) allowedSets = parsed.map(String)
  } catch {
    allowedSets = []
  }
  return {
    id: r.id,
    name: r.name,
    allowedSets,
    bonusMultiplier: Number(r.bonus_multiplier),
    startTime: r.start_time,
    endTime: r.end_time,
    active: r.active,
    createdAt: r.created_at,
  }
}

export async function listEvents(): Promise<EventDto[]> {
  const { data, error } = await supabase.from('events').select('*').order('start_time', { ascending: false })
  if (error) fail(error, 'Could not load events')
  return (data as EventRow[]).map(toEvent)
}

export async function getActiveEvents(): Promise<EventDto[]> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('active', true)
    .lte('start_time', now)
    .gte('end_time', now)
    .order('start_time', { ascending: true })
  if (error) fail(error, 'Could not load events')
  return (data as EventRow[]).map(toEvent)
}

interface FeedRow {
  type: string
  text: string
  player_name: string | null
  created_at: string
}

export function toFeedEntry(r: FeedRow): FeedEntryDto {
  return {
    type: r.type as FeedEntryDto['type'],
    message: r.text,
    playerName: r.player_name,
    createdAt: r.created_at,
  }
}

export async function getFeedHistory(): Promise<FeedEntryDto[]> {
  const { data, error } = await supabase
    .from('activity_feed')
    .select('type, text, player_name, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) fail(error, 'Could not load feed')
  return (data as FeedRow[]).map(toFeedEntry)
}
