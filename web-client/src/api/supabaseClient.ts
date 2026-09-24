import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client for the web app (auth, PostgREST, storage, functions).
 * Configure via env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
 * Dev defaults match the local Supabase CLI stack; override in `web-client/.env`.
 */
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '')
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey)

export async function getSupabaseSessionToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/** Error thrown by {@link callEdgeFunction}; carries the HTTP status. */
export class EdgeFunctionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'EdgeFunctionError'
    this.status = status
  }
}

/**
 * Invoke a Supabase Edge Function with the caller's session, using raw fetch
 * (instead of `functions.invoke`) so non-2xx statuses stay predictable.
 */
export async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const token = await getSupabaseSessionToken()
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (!res.ok) {
    const message = (parsed as { message?: string } | null)?.message ?? `Request failed (${res.status})`
    throw new EdgeFunctionError(res.status, message)
  }
  return parsed as T
}
