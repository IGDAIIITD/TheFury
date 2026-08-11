import { useState } from 'react'
import { api } from './api'
import type { AuthResponse, Player } from './types'

export default function Login({ onSuccess }: { onSuccess: (player: Player) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api.post<AuthResponse>('/auth/login', { email, password })
      localStorage.setItem('ac_token', data.token)
      onSuccess(data.player)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Campus Forge · Admin</h1>
        <p className="meta">Sign in with an admin account (ROLE_ADMIN).</p>
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn" disabled={busy || !email || !password} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
