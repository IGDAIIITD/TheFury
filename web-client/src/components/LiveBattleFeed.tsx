import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOpenLobbies, type OpenLobbyDto } from '../api/endpoints'
import { battleEngineConfigured } from '../api/battleConfig'
import { formatCountdown, remainingMs } from '../lib/time'

const LOBBY_POLL_MS = 5000

/** Live waiting-room feed shared by Battle and Collection → Events. */
export default function LiveBattleFeed() {
  const navigate = useNavigate()
  const [lobbies, setLobbies] = useState<OpenLobbyDto[] | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const online = battleEngineConfigured()

  const load = useCallback(() => {
    getOpenLobbies()
      .then((rows) => {
        setLobbies(rows)
        setError('')
      })
      .catch(() => setError('Could not load open battles.'))
  }, [])

  useEffect(() => {
    load()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, LOBBY_POLL_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const live = (lobbies ?? []).filter((l) => remainingMs(Date.parse(l.expiresAt), now) > 0)

  return (
    <section className="panel events-section">
      <div className="events-head">
        <h3>Live events</h3>
        <span className="live-dot" aria-hidden />
        <span className="meta">open battles</span>
      </div>
      {!online && <div className="meta">Battles are offline right now.</div>}
      {error && <div className="problem">{error}</div>}
      {lobbies === null && !error && <div className="meta">Loading…</div>}
      {lobbies !== null && live.length === 0 && (
        <div className="empty">No open battles. Create one and it will show up here.</div>
      )}
      <div className="lobby-list">
        {live.map((lobby) => (
          <div key={lobby.matchId} className={`lobby-row${lobby.mine ? ' mine' : ''}`}>
            <div className="grow">
              <div className="lobby-host">{lobby.mine ? 'Your lobby' : lobby.hostName}</div>
              <div className="meta">
                Code <span className="lobby-code">{lobby.battleCode}</span> · closes in{' '}
                {formatCountdown(remainingMs(Date.parse(lobby.expiresAt), now))}
              </div>
            </div>
            {lobby.mine ? (
              <button className="btn ghost" onClick={() => navigate('/battle')}>View</button>
            ) : (
              <button
                className="btn"
                disabled={!online}
                onClick={() => navigate(`/battle?join=${encodeURIComponent(lobby.battleCode)}`)}
              >
                Join
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
