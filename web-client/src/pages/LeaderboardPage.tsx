import { useEffect, useMemo, useState } from 'react'
import { getActiveBuildings, getLeaderboard, getPopularDecks } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import { CACHE_KEYS, cacheGet, cacheSet } from '../lib/idb'
import {
  BTECH_SPECIALIZATIONS,
  MTECH_SPECIALIZATIONS,
  type BuildingActivityDto,
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

const SPECIALIZATIONS: Record<DegreeLevel, readonly string[]> = {
  BTECH: [...BTECH_SPECIALIZATIONS],
  MTECH: [...MTECH_SPECIALIZATIONS],
}

function scopeLabel(filters: LeaderboardFilters): string {
  if (filters.department) return `dept:${filters.department}`
  if (filters.degreeLevel && filters.specialization) {
    return `${filters.degreeLevel}:${filters.specialization}`
  }
  if (filters.degreeLevel) return filters.degreeLevel
  return 'all'
}

export default function LeaderboardPage() {
  const { player } = useAuth()
  const [metric, setMetric] = useState<LeaderboardMetric>('level')
  const [degreeLevel, setDegreeLevel] = useState<DegreeLevel | ''>('')
  const [specialization, setSpecialization] = useState('')
  const [department, setDepartment] = useState<'' | 'CSE' | 'ECE'>('')
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [decks, setDecks] = useState<PopularDeckDto[]>([])
  const [buildings, setBuildings] = useState<BuildingActivityDto[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const filters: LeaderboardFilters = useMemo(() => {
    if (department) return { department }
    if (degreeLevel) {
      const f: LeaderboardFilters = { degreeLevel }
      if (specialization) f.specialization = specialization
      return f
    }
    return {}
  }, [degreeLevel, specialization, department])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError('')
      const cacheKey = CACHE_KEYS.leaderboard(metric, scopeLabel(filters))
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
      const cached = await cacheGet<{ decks: PopularDeckDto[]; buildings: BuildingActivityDto[] }>(
        CACHE_KEYS.campusPulse,
      )
      if (mounted && cached) {
        setDecks(cached.decks)
        setBuildings(cached.buildings)
      }
      try {
        const [d, b] = await Promise.all([getPopularDecks(5), getActiveBuildings(5)])
        if (!mounted) return
        setDecks(d)
        setBuildings(b)
        void cacheSet(CACHE_KEYS.campusPulse, { decks: d, buildings: b })
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

      <div className="filters">
        {METRICS.map((m) => (
          <span
            key={m.key}
            className={`chip ${metric === m.key ? 'active' : ''}`}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="filters" style={{ marginTop: 8 }}>
        <span
          className={`chip ${!department && !degreeLevel ? 'active' : ''}`}
          onClick={() => {
            setDegreeLevel('')
            setSpecialization('')
            setDepartment('')
          }}
        >
          All
        </span>
        <span
          className={`chip ${department === 'CSE' ? 'active' : ''}`}
          onClick={() => {
            setDegreeLevel('')
            setSpecialization('')
            setDepartment('CSE')
          }}
        >
          CSE dept
        </span>
        <span
          className={`chip ${department === 'ECE' ? 'active' : ''}`}
          onClick={() => {
            setDegreeLevel('')
            setSpecialization('')
            setDepartment('ECE')
          }}
        >
          ECE dept
        </span>
        {(Object.keys(DEGREE_LABELS) as DegreeLevel[]).map((level) => (
          <span
            key={level}
            className={`chip ${degreeLevel === level && !department ? 'active' : ''}`}
            onClick={() => {
              setDegreeLevel(degreeLevel === level ? '' : level)
              setSpecialization('')
              setDepartment('')
            }}
          >
            {DEGREE_LABELS[level]}
          </span>
        ))}
        {degreeLevel && !department && (
          <>
            <span style={{ width: 8 }} />
            {SPECIALIZATIONS[degreeLevel].map((spec) => (
              <span
                key={spec}
                className={`chip ${specialization === spec ? 'active' : ''}`}
                onClick={() => setSpecialization(specialization === spec ? '' : spec)}
              >
                {spec}
              </span>
            ))}
          </>
        )}
      </div>

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

      {(decks.length > 0 || buildings.length > 0) && (
        <div className="campus-pulse">
          <h3>Campus Pulse</h3>
          <div className="pulse-grid">
            <div className="panel">
              <h4>Most-played decks</h4>
              {decks.length === 0 && <p className="empty">No match data yet.</p>}
              {decks.map((deck, i) => (
                <div className="pulse-row" key={deck.deckName}>
                  <span className="lb-rank">{i + 1}</span>
                  <span className="grow">{deck.deckName}</span>
                  <span className="meta">{deck.playCount} game{deck.playCount === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
            <div className="panel">
              <h4>Most active buildings</h4>
              {buildings.length === 0 && <p className="empty">No spawn data yet.</p>}
              {buildings.map((b, i) => (
                <div className="pulse-row" key={b.building}>
                  <span className="lb-rank">{i + 1}</span>
                  <span className="grow">{b.building}</span>
                  <span className="meta">{b.claimCount} claim{b.claimCount === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
