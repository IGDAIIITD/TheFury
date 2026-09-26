import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOpenLobbies, getRecentBattles, type OpenLobbyDto, type RecentBattleDto } from '../api/endpoints'
import { battleEngineConfigured } from '../api/battleConfig'
import { formatCountdown, remainingMs, timeAgo } from '../lib/time'

/** How often the open-battles list refreshes while the page is visible. */
const LOBBY_POLL_MS = 5000

/**
 * Campus battles: lobbies waiting for an opponent (tap one to join instead of typing its
 * code) and who won the battles played so far.
 */
export default function EventsPage() {
  const navigate = useNavigate()
  const [lobbies, setLobbies] = useState<OpenLobbyDto[] | null>(null)
  const [battles, setBattles] = useState<RecentBattleDto[] | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const online = battleEngineConfigured()

  const loadLobbies = useCallback(() => {
    getOpenLobbies()
      .then((rows) => {
        setLobbies(rows)
        setError('')
      })
      .catch(() => setError('Could not load open battles.'))
  }, [])

  useEffect(() => {
    loadLobbies()
    getRecentBattles(30)
      .then(setBattles)
      .catch(() => setBattles([]))
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadLobbies()
    }, LOBBY_POLL_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const onVisible = () => document.visibilityState === 'visible' && loadLobbies()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadLobbies])

  const live = (lobbies ?? []).filter((l) => remainingMs(Date.parse(l.expiresAt), now) > 0)

  return (
    <div className="page">
      <h2>Events</h2>

      <section className="panel events-section">
        <div className="events-head">
          <h3>Open battles</h3>
          <span className="live-dot" aria-hidden />
          <span className="meta">live</span>
        </div>
        {!online && <div className="meta">Battles are offline right now.</div>}
        {error && <div className="problem">{error}</div>}
        {lobbies === null && !error && <div className="meta">Loading…</div>}
        {lobbies !== null && live.length === 0 && (
          <div className="empty">No open battles. Create one from the Battle tab and it will show up here.</div>
        )}
        <div className="lobby-list">
          {live.map((l) => (
            <div key={l.matchId} className={`lobby-row${l.mine ? ' mine' : ''}`}>
              <div className="grow">
                <div className="lobby-host">{l.mine ? 'Your lobby' : l.hostName}</div>
                <div className="meta">
                  Code <span className="lobby-code">{l.battleCode}</span> · closes in{' '}
                  {formatCountdown(remainingMs(Date.parse(l.expiresAt), now))}
                </div>
              </div>
              {l.mine ? (
                <button className="btn ghost" onClick={() => navigate('/battle')}>
                  View
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={!online}
                  onClick={() => navigate(`/battle?join=${encodeURIComponent(l.battleCode)}`)}
                >
                  Join
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel events-section">
        <h3>Battle history</h3>
        {battles === null && <div className="meta">Loading…</div>}
        {battles !== null && battles.length === 0 && <div className="empty">No battles finished yet.</div>}
        <div className="battle-history">
          {(battles ?? []).map((b) => (
            <div key={b.matchId} className="battle-history-row">
              <span className="grow">
                <strong>{b.winnerName}</strong> <span className="meta">beat</span> {b.loserName}
              </span>
              <span className="meta">{timeAgo(b.endedAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
