import { useCallback, useEffect, useState } from 'react'
import { getMyStats, getPublicProfile } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import { CACHE_KEYS, cacheGet, cacheSet } from '../lib/idb'
import { swatchBg, swatchFg } from '../lib/colors'
import type { ProfileStatsDto } from '../api/types'
import { useParams } from 'react-router-dom'
import { degreeLabel } from '../lib/labels'

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
  const params = useParams<any>()
  const queryId = new URLSearchParams(window.location.search).get('id')
  const profileId = (params && (params as any).id) || queryId || (window.location.pathname.includes("/profile/") ? window.location.pathname.split("/").pop() || null : null) || null

  const load = useCallback(async () => {
    const fresh = await getMyStats()
    setStats(fresh)
    void cacheSet(CACHE_KEYS.stats, fresh)
    await refreshPlayer()
  }, [refreshPlayer])

  useEffect(() => {
    let mounted = true
    const boot = async () => {
      if (profileId) {
        try {
          const pub = await getPublicProfile(profileId)
          if (!mounted) return
          if (!pub) {
            setError('Profile not found.')
            setLoading(false)
            return
          }
          // build minimal stats shape for public view
          setStats({
            player: pub,
            experience: pub.experience,
            level: pub.level,
            experienceToNextLevel: Math.max(0, pub.level * 100 - pub.experience),
            collectionCompletionPercent: 0,
            ownedCards: 0,
            totalCards: 0,
            totalDiscoveries: 0,
            favoriteColors: [],
            buildingsVisited: [],
            battleStats: { played: 0, wins: 0, losses: 0, winRatePercent: 0 },
            badges: [],
          })
          setLoading(false)
          return
        } catch {
          if (mounted) {
            setError('Failed to load profile.')
            setLoading(false)
          }
          return
        }
      }
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
  }, [refreshPlayer, profileId])

  const onRefresh = async () => {
    if (profileId) return
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
          {stats.player.degreeLevel && (
            <p className="meta" style={{ margin: '4px 0 0' }}>
              {degreeLabel(stats.player.degreeLevel)}
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
        <button className="btn ghost" onClick={onRefresh} disabled={refreshing || !!profileId}>
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
              <span key={c} className="swatch lg" style={{ background: swatchBg(c), color: swatchFg(c) }}>
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
