import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import api from '../api/client'
import type { AuthResponse, Player } from '../api/types'

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(() => {
    const raw = localStorage.getItem('cf_player')
    return raw ? (JSON.parse(raw) as Player) : null
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cf_token'))

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password })
    localStorage.setItem('cf_token', data.token)
    localStorage.setItem('cf_player', JSON.stringify(data.player))
    setToken(data.token)
    setPlayer(data.player)
  }, [])

  const register = useCallback(
    async (email: string, password: string, displayName: string, degreeLevel: string, specialization: string) => {
      const { data } = await api.post<AuthResponse>('/auth/register', {
        email,
        password,
        displayName,
        degreeLevel,
        specialization,
      })
      localStorage.setItem('cf_token', data.token)
      localStorage.setItem('cf_player', JSON.stringify(data.player))
      setToken(data.token)
      setPlayer(data.player)
    },
    [],
  )

  const refreshPlayer = useCallback(async () => {
    const { data } = await api.get<Player>('/auth/me')
    localStorage.setItem('cf_player', JSON.stringify(data))
    setPlayer(data)
    return data
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('cf_token')
    localStorage.removeItem('cf_player')
    setToken(null)
    setPlayer(null)
  }, [])

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
