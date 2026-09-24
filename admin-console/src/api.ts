import type {
  AdminPlayerDto,
  AuthResponse,
  ClaimDto,
  EventDto,
  FeedEntryDto,
  Player,
} from './types'

const TOKEN_KEY = 'ac_token'

const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ?? 'https://prjsiywvhxqnsvsmfgxm.supabase.co'
).replace(/\/+$/, '')
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_CI-gegnlyhVoOfHr-1SEmw__J_BDZZ6'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export interface HttpError {
  status: number
  message: string
}

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

function headers(withBody = true): Record<string, string> {
  const h: Record<string, string> = { apikey: SUPABASE_ANON_KEY }
  if (withBody) h['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function toError(res: Response, fallback: string): Promise<Error & { status: number }> {
  if (res.status === 401) unauthorizedHandler?.()
  let message = fallback
  try {
    const data = await res.json()
    message = data.message ?? data.error_description ?? data.msg ?? data.error ?? fallback
  } catch {
    /* keep fallback */
  }
  const error = new Error(message) as Error & { status: number }
  error.status = res.status
  return error
}

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      ...headers(body !== undefined),
      Prefer: method === 'POST' || method === 'PATCH' ? 'return=representation' : 'return=minimal',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw await toError(res, res.statusText)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function edge<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await toError(res, `Request failed (${res.status})`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------

function toPlayer(p: Record<string, unknown>): Player {
  return {
    id: String(p.id),
    email: String(p.email),
    displayName: String(p.display_name),
    role: p.role === 'ADMIN' ? 'ROLE_ADMIN' : 'ROLE_PLAYER',
    avatar: (p.avatar as string | null) ?? null,
    studentId: (p.student_id as string | null) ?? null,
    degreeLevel: (p.degree_level as string | null) ?? null,
    specialization: (p.specialization as string | null) ?? null,
    experience: Number(p.experience ?? 0),
    level: Number(p.level ?? 1),
  }
}

function toAdminPlayer(p: Record<string, unknown>): AdminPlayerDto {
  return {
    id: String(p.id),
    email: String(p.email),
    displayName: String(p.display_name),
    role: p.role === 'ADMIN' ? 'ROLE_ADMIN' : 'ROLE_PLAYER',
    studentId: (p.student_id as string | null) ?? null,
    degreeLevel: (p.degree_level as string | null) ?? null,
    specialization: (p.specialization as string | null) ?? null,
    experience: Number(p.experience ?? 0),
    level: Number(p.level ?? 1),
    banned: Boolean(p.banned),
    bannedAt: (p.banned_at as string | null) ?? null,
    created: (p.created as string | null) ?? null,
    lastLogin: (p.last_login as string | null) ?? null,
  }
}

function toEvent(e: Record<string, unknown>): EventDto {
  let allowedSets: string[] = []
  try {
    const parsed = JSON.parse(String(e.allowed_sets_json ?? '[]'))
    if (Array.isArray(parsed)) allowedSets = parsed.map(String)
  } catch {
    allowedSets = []
  }
  return {
    id: String(e.id),
    name: String(e.name),
    allowedSets,
    bonusMultiplier: Number(e.bonus_multiplier ?? 1),
    startTime: String(e.start_time),
    endTime: String(e.end_time),
    active: Boolean(e.active),
    createdAt: String(e.created_at),
  }
}

function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function toClaim(c: Record<string, unknown>): ClaimDto {
  const card = embedOne(c.cards as { forge_name?: string } | { forge_name?: string }[] | null)
  const spawned = embedOne(c.spawned_by_profile as { display_name?: string } | { display_name?: string }[] | null)
  const event = embedOne(c.events as { name?: string } | { name?: string }[] | null)
  return {
    id: String(c.id),
    token: String(c.token),
    cardId: String(c.card_id),
    forgeName: card?.forge_name ?? '',
    building: (c.building as string | null) ?? null,
    expiresAt: (c.expires_at as string | null) ?? null,
    status: c.status as ClaimDto['status'],
    eventId: (c.event_id as string | null) ?? null,
    eventName: event?.name ?? null,
    spawnedBy: spawned?.display_name ?? null,
    createdAt: String(c.created_at),
  }
}

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------

async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = data.error_description ?? data.msg ?? data.message ?? 'Login failed'
    const error = new Error(message) as Error & { status: number }
    error.status = res.status
    throw error
  }
  const token: string = data.access_token
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(data.user.id)}`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
  )
  const rows = await profRes.json().catch(() => [])
  const profile = Array.isArray(rows) ? rows[0] : null
  if (!profile || profile.role !== 'ADMIN') {
    const error = new Error('Admin access required') as Error & { status: number }
    error.status = 403
    throw error
  }
  return { token, tokenType: 'Bearer', player: toPlayer(profile) }
}

// ---------------------------------------------------------------
// Route dispatcher (keeps the tab components' REST-ish call sites)
// ---------------------------------------------------------------

async function route<T>(method: string, path: string, body?: unknown): Promise<T> {
  const [pathname, queryString] = path.split('?')
  const q = new URLSearchParams(queryString ?? '')
  const segs = pathname.split('/').filter(Boolean)

  // POST /auth/login
  if (method === 'POST' && segs[0] === 'auth' && segs[1] === 'login') {
    const { email, password } = (body ?? {}) as { email: string; password: string }
    return login(email, password) as Promise<T>
  }

  // /cards
  if (segs[0] === 'cards') {
    const rows = await rest<Record<string, unknown>[]>('GET', 'cards?select=*&order=forge_name.asc')
    return rows.map((c) => ({
      id: c.id,
      forgeName: c.forge_name,
      setCode: c.set_code,
      rarity: c.rarity,
      ownershipType: c.ownership_type,
    })) as unknown as T
  }

  // /events (public read, reused by SpawnsTab)
  if (segs[0] === 'events') {
    const rows = await rest<Record<string, unknown>[]>('GET', 'events?select=*&order=start_time.desc')
    return rows.map(toEvent) as unknown as T
  }

  if (segs[0] === 'admin') {
    // /admin/events
    if (segs[1] === 'events') {
      if (method === 'GET') {
        const rows = await rest<Record<string, unknown>[]>('GET', 'events?select=*&order=start_time.desc')
        return rows.map(toEvent) as unknown as T
      }
      if (method === 'POST') {
        const input = body as {
          name: string
          allowedSets: string[]
          bonusMultiplier: number
          startTime: string
          endTime: string
        }
        const rows = await rest<Record<string, unknown>[]>('POST', 'events', {
          id: crypto.randomUUID(),
          name: input.name,
          allowed_sets_json: JSON.stringify(input.allowedSets ?? []),
          bonus_multiplier: input.bonusMultiplier ?? 1,
          start_time: input.startTime,
          end_time: input.endTime,
        })
        return toEvent(rows[0]) as unknown as T
      }
      if (method === 'PUT' && segs[2]) {
        const input = body as {
          name: string
          allowedSets: string[]
          bonusMultiplier: number
          startTime: string
          endTime: string
        }
        const rows = await rest<Record<string, unknown>[]>(
          'PATCH',
          `events?id=eq.${encodeURIComponent(segs[2])}`,
          {
            name: input.name,
            allowed_sets_json: JSON.stringify(input.allowedSets ?? []),
            bonus_multiplier: input.bonusMultiplier ?? 1,
            start_time: input.startTime,
            end_time: input.endTime,
          },
        )
        return toEvent(rows[0]) as unknown as T
      }
      if (method === 'DELETE' && segs[2]) {
        await rest<void>('DELETE', `events?id=eq.${encodeURIComponent(segs[2])}`)
        return undefined as T
      }
    }

    // /admin/players[/{id}/ban|unban|role]
    if (segs[1] === 'players') {
      if (method === 'GET') {
        const term = q.get('q')?.trim()
        const filter = term
          ? `&or=(display_name.ilike.*${encodeURIComponent(term)}*,email.ilike.*${encodeURIComponent(term)}*)`
          : ''
        const rows = await rest<Record<string, unknown>[]>(
          'GET',
          `profiles?select=*&order=display_name.asc${filter}`,
        )
        return rows.map(toAdminPlayer) as unknown as T
      }
      if (method === 'POST' && segs[2]) {
        const id = encodeURIComponent(segs[2])
        if (segs[3] === 'ban') {
          const rows = await rest<Record<string, unknown>[]>('PATCH', `profiles?id=eq.${id}`, {
            banned: true,
            banned_at: new Date().toISOString(),
          })
          return toAdminPlayer(rows[0]) as unknown as T
        }
        if (segs[3] === 'unban') {
          const rows = await rest<Record<string, unknown>[]>('PATCH', `profiles?id=eq.${id}`, {
            banned: false,
            banned_at: null,
          })
          return toAdminPlayer(rows[0]) as unknown as T
        }
        if (segs[3] === 'role') {
          const role = String((body as { role?: string })?.role ?? '').replace(/^ROLE_/, '')
          const rows = await rest<Record<string, unknown>[]>('PATCH', `profiles?id=eq.${id}`, { role })
          return toAdminPlayer(rows[0]) as unknown as T
        }
      }
    }

    // /admin/claims
    if (segs[1] === 'claims') {
      if (method === 'GET') {
        const rows = await rest<Record<string, unknown>[]>(
          'GET',
          'claims?select=*,cards(forge_name),spawned_by_profile:profiles!claims_spawned_by_fkey(display_name),events(name)&order=created_at.desc',
        )
        return rows.map(toClaim) as unknown as T
      }
      if (method === 'POST') {
        return edge<ClaimDto[]>('admin-spawn', body) as Promise<T>
      }
    }

    // /admin/audit
    if (segs[1] === 'audit' && method === 'GET') {
      const rows = await rest<Record<string, unknown>[]>(
        'GET',
        'activity_feed?select=type,text,player_name,created_at&order=created_at.desc&limit=50',
      )
      return rows.map((r) => ({
        type: r.type,
        message: r.text,
        playerName: r.player_name,
        createdAt: r.created_at,
      })) as unknown as T
    }
  }

  throw new Error(`Unsupported request: ${method} ${path}`)
}

export const api = {
  get: <T>(path: string) => route<T>('GET', path),
  post: <T>(path: string, body?: unknown) => route<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => route<T>('PUT', path, body),
  del: <T>(path: string) => route<T>('DELETE', path),
}

export type { FeedEntryDto }
