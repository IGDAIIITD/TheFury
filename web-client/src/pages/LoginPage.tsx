import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  BTECH_SPECIALIZATIONS,
  MTECH_SPECIALIZATIONS,
  type DegreeLevel,
} from '../api/types'

type Mode = 'login' | 'register'

const DEGREE_LABELS: { value: DegreeLevel; label: string }[] = [
  { value: 'BTECH', label: 'B.Tech' },
  { value: 'MTECH', label: 'M.Tech' },
]

const SPECIALIZATIONS: Record<DegreeLevel, readonly string[]> = {
  BTECH: [...BTECH_SPECIALIZATIONS],
  MTECH: [...MTECH_SPECIALIZATIONS],
}

export default function LoginPage() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [degreeLevel, setDegreeLevel] = useState<DegreeLevel | ''>('')
  const [specialization, setSpecialization] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password, displayName, degreeLevel, specialization)
      }
      navigate('/collection')
    } catch (err) {
      const message = (err as { message?: string })?.message
      setError(message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Campus Forge</h1>
        <p>{mode === 'login' ? 'Welcome back, Planeswalker.' : 'Create your account to start scanning.'}</p>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="field">
              <label>Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Sorceress Erin"
                required
              />
            </div>
          )}
          <div className="field">
            <label>Campus email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@campus.edu"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {mode === 'register' && (
            <>
              <div className="field">
                <label>Degree</label>
                <select
                  value={degreeLevel}
                  onChange={(e) => {
                    setDegreeLevel(e.target.value as DegreeLevel)
                    setSpecialization('')
                  }}
                  required
                >
                  <option value="" disabled>
                    Select your degree
                  </option>
                  {DEGREE_LABELS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              {degreeLevel && (
                <div className="field">
                  <label>Specialization</label>
                  <select value={specialization} onChange={(e) => setSpecialization(e.target.value)} required>
                    <option value="" disabled>
                      Select specialization
                    </option>
                    {SPECIALIZATIONS[degreeLevel].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          <div className="error">{error}</div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}
          </button>
        </form>

        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 14 }}>
          {mode === 'login' ? (
            <>
              No account?{' '}
              <a onClick={() => switchMode('register')} style={{ cursor: 'pointer' }}>
                Register
              </a>
            </>
          ) : (
            <>
              Have an account?{' '}
              <a onClick={() => switchMode('login')} style={{ cursor: 'pointer' }}>
                Log in
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
