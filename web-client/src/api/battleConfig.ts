/**
 * Battle-engine connection config.
 *
 * The battle engine is a separate service from the game backend. Its REST API
 * (`/api/v1/battle/*`) and STOMP WS (`/ws/match`) are authenticated with a
 * Supabase access-token JWT (not the legacy backend `cf_token`).
 *
 * The engine origin is `VITE_BATTLE_ENGINE_URL` when set at build time (local
 * dev), otherwise the URL published in Supabase `app_config` and discovered at
 * startup (GitHub Pages + a Cloudflare quick tunnel whose URL changes).
 */

let runtimeOrigin = ''

/**
 * Engine origin discovered at runtime (see `battleEngineDiscovery.ts`): the
 * Pages build ships without a URL and reads the current tunnel URL from the
 * Supabase `app_config` table. Pass '' to clear.
 */
export function setRuntimeBattleEngineOrigin(origin: string): void {
  runtimeOrigin = origin.trim().replace(/\/+$/, '')
}

/** A build-time `VITE_BATTLE_ENGINE_URL` wins (local dev); otherwise the runtime one. */
export function battleEngineOrigin(): string {
  const buildTime = (import.meta.env.VITE_BATTLE_ENGINE_URL ?? '').replace(/\/+$/, '')
  return buildTime || runtimeOrigin
}

/**
 * True when a battle engine origin is configured. When false the PWA is running
 * without a battle backend (e.g. the GitHub Pages build with battles descoped):
 * callers should hide/disable battle entry points rather than fall back to the
 * same origin, which has no engine and would just error.
 */
export function battleEngineConfigured(): boolean {
  return battleEngineOrigin().length > 0
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