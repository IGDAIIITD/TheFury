import { battleEngineOrigin, setRuntimeBattleEngineOrigin } from './battleConfig'
import { supabase } from './supabaseClient'

/**
 * Runtime discovery of the battle engine URL.
 *
 * The Pages build has no `VITE_BATTLE_ENGINE_URL`. Instead
 * `battle-engine/start-public.ps1` publishes the engine's current public URL (a
 * Cloudflare quick tunnel, which changes on every start) in the Supabase
 * `app_config` table under `battle_engine_url`. On startup we read it, check the
 * engine really answers (`/api/v1/battle/features` needs no auth), and follow
 * Realtime updates so open tabs pick up a restarted engine without reloading.
 *
 * `onChange` fires whenever the effective engine origin changes, so the caller
 * can re-render (the Battle tab and route read `battleEngineConfigured()`).
 */

const CONFIG_KEY = 'battle_engine_url'
const PROBE_TIMEOUT_MS = 5000

async function engineResponds(origin: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${origin}/api/v1/battle/features`, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function normalize(value: unknown): string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim().replace(/\/+$/, '') : ''
}

export function discoverBattleEngine(onChange: () => void): () => void {
  // A build-time URL (local dev) always wins; nothing to discover.
  if ((import.meta.env.VITE_BATTLE_ENGINE_URL ?? '').trim()) return () => {}

  let latest = 0
  const apply = async (raw: unknown) => {
    const ticket = ++latest
    const candidate = normalize(raw)
    const next = candidate && (await engineResponds(candidate)) ? candidate : ''
    if (ticket !== latest || next === battleEngineOrigin()) return
    setRuntimeBattleEngineOrigin(next)
    onChange()
  }

  void supabase
    .from('app_config')
    .select('value')
    .eq('key', CONFIG_KEY)
    .maybeSingle()
    .then(({ data }) => apply(data?.value))

  const channel = supabase
    .channel('app-config')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_config', filter: `key=eq.${CONFIG_KEY}` },
      (payload) => {
        void apply((payload.new as { value?: unknown } | null)?.value)
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
