import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AdminPlayerDto } from '../types'

export default function PlayersTab() {
  const [players, setPlayers] = useState<AdminPlayerDto[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback((query: string) => {
    api
      .get<AdminPlayerDto[]>(`/admin/players${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then(setPlayers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load players'))
  }, [])

  useEffect(() => {
    load('')
  }, [load])

  const ban = async (player: AdminPlayerDto) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.post<AdminPlayerDto>(`/admin/players/${player.id}/ban`)
      setNotice(`${player.displayName} banned.`)
      load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ban failed')
    } finally {
      setBusy(false)
    }
  }

  const unban = async (player: AdminPlayerDto) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.post<AdminPlayerDto>(`/admin/players/${player.id}/unban`)
      setNotice(`${player.displayName} unbanned.`)
      load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unban failed')
    } finally {
      setBusy(false)
    }
  }

  const setRole = async (player: AdminPlayerDto, role: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.post<AdminPlayerDto>(`/admin/players/${player.id}/role`, { role })
      setNotice(`${player.displayName} role set to ${role}.`)
      load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role change failed')
    } finally {
      setBusy(false)
    }
  }

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    load(q)
  }

  return (
    <div>
      <h2>Players</h2>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="meta" style={{ color: 'var(--good)' }}>{notice}</p>}

      <form className="panel" onSubmit={search}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="field grow">
            <label>Search by email or display name</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. testbattle@campus.edu" />
          </div>
          <button className="btn" type="submit">
            Search
          </button>
        </div>
      </form>

      <div className="panel">
        <h3>Results ({players.length})</h3>
        {players.length === 0 && <p className="empty">No players match.</p>}
        {players.map((player) => (
          <div className="row" key={player.id}>
            <div className="grow">
              <strong>{player.displayName}</strong>{' '}
              <span className={`badge ${player.role === 'ROLE_ADMIN' ? 'warn' : 'meta'}`}>{player.role}</span>{' '}
              {player.banned && <span className="badge bad">BANNED</span>}
              <div className="meta">
                {player.email} · {player.degreeLevel ?? '—'} {player.specialization ?? ''} · Lv {player.level}
                {player.banned && player.bannedAt ? ` · banned ${new Date(player.bannedAt).toLocaleString()}` : ''}
              </div>
            </div>
            <select value={player.role} onChange={(e) => setRole(player, e.target.value)} disabled={busy}>
              <option value="ROLE_PLAYER">ROLE_PLAYER</option>
              <option value="ROLE_ADMIN">ROLE_ADMIN</option>
            </select>
            {player.banned ? (
              <button className="btn small" disabled={busy} onClick={() => unban(player)}>
                Unban
              </button>
            ) : (
              <button className="btn small danger" disabled={busy} onClick={() => ban(player)}>
                Ban
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
