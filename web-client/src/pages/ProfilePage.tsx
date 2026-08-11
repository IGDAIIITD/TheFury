import { useCallback, useEffect, useState } from 'react'
import { getMyStats } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import { CACHE_KEYS, cacheGet, cacheSet } from '../lib/idb'
import { swatchBg } from '../lib/colors'
import type { ProfileStatsDto } from '../api/types'

const COLOR_LABELS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
}

export default function ProfilePage() {
  const { player, refreshPlayer } = useAuth()
  const [stats, setStats] = useState<ProfileStatsDto | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const fresh = await getMyStats()
    setStats(fresh)
    void cacheSet(CACHE_KEYS.stats, fresh)
    await refreshPlayer()
  }, [refreshPlayer])

  useEffect(() => {
    let mounted = true
    const boot = async () => {
      const cached = await cacheGet<ProfileStatsDto>(CACHE_KEYS.stats)
      if (mounted && cached) setStats(cached)
      try {
        const fresh = await getMyStats()
        if (!mounted) return
        setStats(fresh)
        void cacheSet(CACHE_KEYS.stats, fresh)
        await refreshPlayer()
      } catch {
        if (mounted && !cached) setError('Failed to load profile.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    boot()
    return () => {
      mounted = false
    }
  }, [refreshPlayer])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await load()
    } catch {
      setError('Failed to refresh profile.')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <div className="page">Loading…</div>
  if (error) return <div className="page empty">{error}</div>
  if (!stats) return null

  const displayName = player?.displayName ?? stats.player.displayName
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const xpInLevel = stats.experience % 100
  const ringDeg = (xpInLevel / 100) * 360

  return (
    <div className="page">
      <div className="profile-header panel">
        <div className="profile-avatar">{initials}</div>
        <div>
          <h2 style={{ margin: 0 }}>{displayName}</h2>
          <p className="meta" style={{ margin: '4px 0 0' }}>
            {stats.player.email}
          </p>
          {stats.player.studentId && (
            <p className="meta" style={{ margin: 0 }}>
              Student ID: {stats.player.studentId}
            </p>
          )}
          {stats.player.degreeLevel && (
            <p className="meta" style={{ margin: 0 }}>
              {stats.player.degreeLevel === 'MTECH' ? 'M.Tech' : 'B.Tech'}
              {stats.player.specialization ? ` · ${stats.player.specialization}` : ''}
            </p>
          )}
        </div>
        <div
          className="profile-level-ring"
          style={{ background: `conic-gradient(var(--accent) ${ringDeg}deg, var(--bg-soft) 0deg)` }}
        >
          <div className="profile-level-inner">
            <strong>Lv {stats.level}</strong>
            <span>{stats.experience} XP</span>
          </div>
        </div>
        <button className="btn ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="xp-bar">
        <div style={{ width: `${Math.min(100, xpInLevel)}%` }} />
      </div>
      <p className="meta" style={{ marginTop: 6 }}>
        {stats.experienceToNextLevel} XP to level {stats.level + 1}
      </p>

      <div className="stat-grid">
        <div className="stat-card panel">
          <strong>{stats.collectionCompletionPercent}%</strong>
          <span>Collection</span>
        </div>
        <div className="stat-card panel">
          <strong>
            {stats.ownedCards}/{stats.totalCards}
          </strong>
          <span>Cards owned</span>
        </div>
        <div className="stat-card panel">
          <strong>{stats.totalDiscoveries}</strong>
          <span>Discoveries</span>
        </div>
        <div className="stat-card panel">
          <strong>
            {stats.battleStats.wins}–{stats.battleStats.losses}
          </strong>
          <span>Battles ({stats.battleStats.played} played)</span>
        </div>
        <div className="stat-card panel">
          <strong>{stats.battleStats.winRatePercent}%</strong>
          <span>Win rate</span>
        </div>
      </div>

      {stats.favoriteColors.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Favorite colors</h3>
          <div className="fav-colors">
            {stats.favoriteColors.map((c) => (
              <span key={c} className="swatch lg" style={{ background: swatchBg(c), color: '#0f1220' }}>
                {c}
              </span>
            ))}
            <span className="meta">
              {stats.favoriteColors.map((c) => COLOR_LABELS[c] ?? c).join(' · ')}
            </span>
          </div>
        </div>
      )}

      {stats.buildingsVisited.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Buildings visited</h3>
          <div className="fav-colors">
            {stats.buildingsVisited.map((b) => (
              <span key={b} className="chip">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Badges {stats.badges.length > 0 ? `(${stats.badges.length})` : ''}</h3>
        {stats.badges.length === 0 ? (
          <p className="meta">No badges yet — discover cards and win battles to earn them.</p>
        ) : (
          <div className="badge-grid">
            {stats.badges.map((b) => (
              <div key={b.code} className="badge-card" title={b.description}>
                <span className="badge-icon">{b.name.charAt(0)}</span>
                <strong>{b.name}</strong>
                <span className="meta">{b.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
