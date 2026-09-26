import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { checkRoll, ROLL_RE, type RollStatus } from '../api/rollAuth'
import logo from '../assets/igda-iiitd-logo.png'
import ThemeToggle from '../components/ThemeToggle'

/**
 * Sign-in for The Fury.
 *   1. identify: roll number + first name, checked against the IIITD student roster
 *   2. password: log in (REGISTERED) or choose a password (NEW; the profile is filled
 *      from the roster, so there's nothing else to fill in)
 * Every account is a roll account; organisers are roll accounts promoted to admin.
 */
type Step = 'identify' | 'password'

const MIN_PASSWORD = 8

const DEGREE_LABEL: Record<string, string> = { BTECH: 'B.Tech', MTECH: 'M.Tech' }

function errorText(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string } | null
  if (e?.message === 'Invalid login credentials') return 'Wrong password. Try again.'
  // A 404 that isn't student-auth's own "not in the student list" means the function is missing.
  const unknownRoll = /student list/i.test(e?.message ?? '')
  if (e?.status === 404 && !unknownRoll) return 'Sign-in is not available right now. Try again in a moment.'
  return e?.message || fallback
}

export default function LoginPage() {
  const { loginWithRoll, registerWithRoll } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('identify')
  const [rollNo, setRollNo] = useState('')
  const [firstName, setFirstName] = useState('')
  const [student, setStudent] = useState<RollStatus | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(errorText(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const go = (next: Step) => {
    setStep(next)
    setError('')
    setPassword('')
    setConfirm('')
  }

  const identify = (e: React.FormEvent) => {
    e.preventDefault()
    const roll = rollNo.trim()
    if (!ROLL_RE.test(roll)) return setError('Roll numbers are 7 digits, e.g. 2026001.')
    if (!firstName.trim()) return setError('Enter your first name.')
    return run(async () => {
      setStudent(await checkRoll(roll, firstName.trim()))
      go('password')
    }, 'Could not check your roll number.')
  }

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (!student) return
    if (student.status === 'NEW') {
      if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`)
      if (password !== confirm) return setError('The passwords do not match.')
      return run(async () => {
        await registerWithRoll(student.rollNo, firstName.trim(), password, nickname.trim() || undefined)
        navigate('/collection')
      }, 'Could not create your account.')
    }
    return run(async () => {
      await loginWithRoll(student.rollNo, password)
      navigate('/collection')
    }, 'Could not log in.')
  }

  return (
    <div className="auth-page">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <img className="auth-logo" src={logo} alt="IGDA IIIT-Delhi" />
        <h1>The Fury</h1>
        <p className="tagline">
          {step === 'password' && student?.status === 'NEW'
              ? 'Choose a password to claim your deck.'
              : 'Scan. Build. Battle.'}
        </p>

        {step === 'identify' && (
          <form onSubmit={identify} noValidate>
            <div className="field">
              <label htmlFor="roll">Roll number</label>
              <input
                id="roll"
                className="roll"
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value.replace(/\D/g, '').slice(0, 7))}
                inputMode="numeric"
                autoComplete="username"
                placeholder="2026001"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="first-name">First name</label>
              <input
                id="first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                placeholder="As on the student list"
              />
            </div>
            <div className="error" role="alert">{error}</div>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'password' && student && (
          <form onSubmit={submitPassword} noValidate>
            <div className="auth-who">
              <strong>{student.name}</strong>
              <span className="meta">
                {student.rollNo} · {DEGREE_LABEL[student.degreeLevel] ?? student.degreeLevel} {student.program} ·{' '}
                {student.batch} batch
              </span>
            </div>
            <div className="field">
              <label htmlFor="password">{student.status === 'NEW' ? 'Create a password' : 'Password'}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={student.status === 'NEW' ? 'new-password' : 'current-password'}
                autoFocus
              />
            </div>
            {student.status === 'NEW' && (
              <div className="field">
                <label htmlFor="nickname">
                  Nickname <span className="optional">optional</span>
                </label>
                <input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={24}
                  autoComplete="nickname"
                  placeholder={`Shown instead of ${student.name.split(' ')[0]}`}
                />
              </div>
            )}
            {student.status === 'NEW' && (
              <div className="field">
                <label htmlFor="confirm">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            )}
            <div className="error" role="alert">{error}</div>
            <button className="btn" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Please wait…' : student.status === 'NEW' ? 'Create account' : 'Log in'}
            </button>
            <div className="auth-footer">
              <button type="button" className="btn link" onClick={() => go('identify')}>
                Not you?
              </button>
              {student.status === 'REGISTERED' && (
                <span className="meta">Forgot it? Ask an IGDA organiser.</span>
              )}
            </div>
          </form>
        )}

      </div>
      <p className="auth-credit">An IGDA IIIT-Delhi event</p>
    </div>
  )
}
