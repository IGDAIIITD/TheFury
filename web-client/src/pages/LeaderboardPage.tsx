import { useEffect, useMemo, useState } from 'react'
import { getLeaderboard, getPopularDecks } from '../api/endpoints'
import { Chip, FilterBar, FilterGroup } from '../components/Filters'
import { useAuth } from '../auth/AuthContext'
import { CACHE_KEYS, cacheGet, cacheSet } from '../lib/idb'
import {
  type DegreeLevel,
  type LeaderboardFilters,
  type LeaderboardMetric,
  type LeaderboardResponse,
  type PopularDeckDto,
} from '../api/types'

const METRICS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'level', label: 'Level' },
  { key: 'collection', label: 'Collection' },
  { key: 'winrate', label: 'Win Rate' },
]

const METRIC_SUBTITLES: Record<LeaderboardMetric, string> = {
  level: 'Ranked by level, then experience',
  collection: 'Ranked by collection completion',
  winrate: 'Ranked by win rate (at least one battle)',
}

const MEDAL_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32']

const DEGREE_LABELS: Record<DegreeLevel, string> = {
  BTECH: 'B.Tech',
  MTECH: 'M.Tech',
}

/** Individual branches (any degree). */
const BRANCHES = ['CSE', 'CSAI', 'CSAM', 'CSB', 'CSSS', 'CSD', 'CSECON', 'ECE', 'EVE'] as const

export default function LeaderboardPage() {
  const { player } = useAuth()
  const [metric, setMetric] = useState<LeaderboardMetric>('level')
  const [branch, setBranch] = useState('')
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [decks, setDecks] = useState<PopularDeckDto[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const filters: LeaderboardFilters = useMemo(() => (branch ? { specialization: branch } : {}), [branch])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError('')
      const cacheKey = CACHE_KEYS.leaderboard(metric, branch || 'all')
      const cached = await cacheGet<LeaderboardResponse>(cacheKey)
      if (mounted && cached) setData(cached)
      try {
        const fresh = await getLeaderboard(metric, 50, filters)
        if (!mounted) return
        setData(fresh)
        void cacheSet(cacheKey, fresh)
      } catch {
        if (mounted && !cached) setError('Failed to load leaderboard.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [metric, filters])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const cached = await cacheGet<{ decks: PopularDeckDto[] }>(CACHE_KEYS.campusPulse)
      if (mounted && cached?.decks) setDecks(cached.decks)
      try {
        const d = await getPopularDecks(5)
        if (!mounted) return
        setDecks(d)
        void cacheSet(CACHE_KEYS.campusPulse, { decks: d })
      } catch {
        // non-fatal: campus pulse stays empty or cached offline
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const valueLabel = useMemo(() => {
    switch (metric) {
      case 'collection':
        return 'Owned'
      case 'winrate':
        return 'Wins'
      default:
        return 'XP'
    }
  }, [metric])

  if (loading && !data) return <div className="page">Loading…</div>
  if (error) return <div className="page empty">{error}</div>

  const rows = data?.rows ?? []

  return (
    <div className="page">
      <h2>Leaderboard</h2>
      <p className="meta" style={{ marginTop: -8 }}>
        {METRIC_SUBTITLES[metric]}
      </p>

      <FilterBar>
        <FilterGroup label="Rank by" tone="metric">
          {METRICS.map((m) => (
            <Chip key={m.key} active={metric === m.key} onClick={() => setMetric(m.key)}>
              {m.label}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Branch" tone="branch">
          <Chip active={!branch} onClick={() => setBranch('')}>
            All
          </Chip>
          {BRANCHES.map((b) => (
            <Chip key={b} active={branch === b} onClick={() => setBranch(branch === b ? '' : b)}>
              {b}
            </Chip>
          ))}
        </FilterGroup>
      </FilterBar>

      {data?.myRank != null && data.myRank > 0 && (
        <div className="panel my-rank">
          <strong>Your rank: #{data.myRank}</strong>
        </div>
      )}

      <div className="leaderboard panel">
        <div className="lb-row lb-head">
          <span>#</span>
          <span>Player</span>
          <span>{valueLabel}</span>
          <span>{metric === 'level' ? 'Level' : metric === 'collection' ? 'Collection' : 'Win rate'}</span>
        </div>
        {rows.length === 0 && <div className="empty">No players yet.</div>}
        {rows.map((row) => {
          const isMe = player?.id === row.playerId
          const isTop3 = row.rank <= 3
          return (
            <div key={row.playerId} className={`lb-row ${isMe ? 'me' : ''}`}>
              <span className="lb-rank" style={{ color: isTop3 ? MEDAL_COLORS[row.rank - 1] : undefined }}>
                {row.rank}
              </span>
              <span className="lb-name">
                {row.avatar ? (
                  <img src={row.avatar} alt="" className="lb-avatar" />
                ) : (
                  <span className="lb-avatar placeholder">{row.displayName.charAt(0)}</span>
                )}
                {row.displayName}
                {row.degreeLevel && (
                  <span className="lb-cohort">
                    {DEGREE_LABELS[row.degreeLevel as DegreeLevel] ?? row.degreeLevel}
                    {row.specialization ? ` · ${row.specialization}` : ''}
                  </span>
                )}
                {isMe && <span className="lb-you">you</span>}
              </span>
              <span>{row.value}</span>
              <span className="lb-score">{row.score}{metric !== 'level' ? '%' : ''}</span>
            </div>
          )
        })}
      </div>

      {decks.length > 0 && (
        <div className="campus-pulse">
          <h3>Most-played decks</h3>
          <div className="panel">
            {decks.map((deck, i) => (
              <div className="pulse-row" key={deck.deckName}>
                <span className="lb-rank">{i + 1}</span>
                <span className="grow">{deck.deckName}</span>
                <span className="meta">{deck.playCount} game{deck.playCount === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
