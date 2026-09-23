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