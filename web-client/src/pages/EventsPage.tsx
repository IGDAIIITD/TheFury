import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getRecentBattles, type RecentBattleDto } from '../api/endpoints'
import { timeAgo } from '../lib/time'

/**
 * Campus battles: lobbies waiting for an opponent (tap one to join instead of typing its
 * code) and who won the battles played so far.
 */
export default function EventsPage() {
  const [battles, setBattles] = useState<RecentBattleDto[] | null>(null)

  useEffect(() => {
    getRecentBattles(30)
      .then(setBattles)
      .catch(() => setBattles([]))
  }, [])

  return (
    <div className="page">
      <h2>Events</h2>

      <section className="panel events-section">
        <h3>Battle history</h3>
        {battles === null && <div className="meta">Loading…</div>}
        {battles !== null && battles.length === 0 && <div className="empty">No battles finished yet.</div>}
        <div className="battle-history">
          {(battles ?? []).map((b) => (
            <div key={b.matchId} className="battle-history-row">
              <span className="grow">
                <strong>
                  {b.winnerId ? <Link to={`/profile?id=${b.winnerId}`}>{b.winnerName}</Link> : b.winnerName}
                </strong>{' '}
                <span className="meta">beat</span>{' '}
                {b.loserId ? <Link to={`/profile?id=${b.loserId}`}>{b.loserName}</Link> : b.loserName}
              </span>
              <span className="meta">{timeAgo(b.endedAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
