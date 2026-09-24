import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../api/supabaseClient'
import type { Player } from '../api/types'

interface AuthContextValue {
  player: Player | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (
    email: string,
    password: string,
    displayName: string,
    degreeLevel: string,
    specialization: string,
  ) => Promise<void>
  refreshPlayer: () => Promise<Player>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface ProfileRow {
  id: string
  display_name: string
  email: string
  student_id: string | null
  avatar: string | null
  role: string
  experience: number
  level: number
  degree_level: string | null
  specialization: string | null
}

function toPlayer(r: ProfileRow): Player {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    avatar: r.avatar,
    studentId: r.student_id,
    degreeLevel: r.degree_level,
    specialization: r.specialization,
    experience: Number(r.experience),
    level: r.level,
  }
}

async function fetchProfile(): Promise<Player> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Profile not found')
  return toPlayer(data as ProfileRow)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(() => {
    const raw = localStorage.getItem('cf_player')
    return raw ? (JSON.parse(raw) as Player) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cf_token'))

  const persist = useCallback((accessToken: string | null, next: Player | null) => {
    if (accessToken) localStorage.setItem('cf_token', accessToken)
    else localStorage.removeItem('cf_token')
    if (next) localStorage.setItem('cf_player', JSON.stringify(next))
    else localStorage.removeItem('cf_player')
    setToken(accessToken)
    setPlayer(next)
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      const next = await fetchProfile()
      persist(data.session?.access_token ?? null, next)
      void supabase
        .from('profiles')
        .update({ last_login: new Date().toISOString() })
        .eq('id', next.id)
    },
    [persist],
  )

  const register = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      degreeLevel: string,
      specialization: string,
    ) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName, degree_level: degreeLevel, specialization: specialization },
        },
      })
      if (error) throw error

      let session = data.session
      if (!session) {
        // Email confirmation is enabled on the project. Try an immediate sign-in
        // (works only when confirmation is off); otherwise tell the user.
        const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError || !signIn.session) {
          throw new Error('Check your email to confirm your account, then sign in.')
        }
        session = signIn.session
      }

      const uid = session.user.id
      // The auth trigger only copies display_name; persist the cohort fields.
      const { error: cohortError } = await supabase
        .from('profiles')
        .update({ degree_level: degreeLevel, specialization })
        .eq('id', uid)
      if (cohortError) throw cohortError

      const next = await fetchProfile()
      persist(session.access_token, next)
    },
    [persist],
  )

  const refreshPlayer = useCallback(async () => {
    const next = await fetchProfile()
    persist(localStorage.getItem('cf_token'), next)
    return next
  }, [persist])

  const logout = useCallback(() => {
    void supabase.auth.signOut()
    persist(null, null)
  }, [persist])

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        persist(null, null)
        return
      }
      if (event === 'TOKEN_REFRESHED') {
        localStorage.setItem('cf_token', session.access_token)
        setToken(session.access_token)
      }
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [persist])

  const value = useMemo(
    () => ({ player, token, login, register, refreshPlayer, logout }),
    [player, token, login, register, refreshPlayer, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
