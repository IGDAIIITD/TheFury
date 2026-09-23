/**
 * Battle-engine connection config.
 *
 * The battle engine is a separate service from the game backend. Its REST API
 * (`/api/v1/battle/*`) and STOMP WS (`/ws/match`) are authenticated with a
 * Supabase access-token JWT (not the legacy backend `cf_token`).
 *
 * `VITE_BATTLE_ENGINE_URL` is the engine origin (defaults to same-origin via the
 * dev proxy so no engine URL is needed for local `npm run dev`).
 */
export function battleEngineOrigin(): string {
  return (import.meta.env.VITE_BATTLE_ENGINE_URL ?? '').replace(/\/+$/, '')
}

/** REST base including origin; paths are like `/battle/matches`. */
export function battleRestBase(): string {
  const origin = battleEngineOrigin()
  return origin ? `${origin}/api/v1` : '/api/v1'
}

/** STOMP/SockJS endpoint for a given origin. */
export function battleWsUrl(): string {
  const origin = battleEngineOrigin()
  const base = origin ? origin : window.location.origin
  const wsBase = base.startsWith('https://') ? base.replace(/^https/, 'wss') : base.replace(/^http/, 'ws')
  return `${wsBase}/ws/match`
}

/**
 * JWT to present to the battle engine. Prefers a live Supabase session access
 * token (the engine verifies Supabase JWTs via its JWKS); falls back to the
 * legacy backend token so seeded demo users keep working in dev.
 */
export async function battleToken(): Promise<string | null> {
  try {
    const { supabase } = await import('../api/supabaseClient')
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) {
      return data.session.access_token
    }
  } catch {
    // supabase client unavailable — fall through
  }
  return localStorage.getItem('cf_token')
}