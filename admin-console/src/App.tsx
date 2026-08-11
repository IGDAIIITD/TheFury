import { useEffect, useState } from 'react'
import { getToken, setToken, setUnauthorizedHandler } from './api'
import Login from './Login'
import EventsTab from './tabs/EventsTab'
import SpawnsTab from './tabs/SpawnsTab'
import PlayersTab from './tabs/PlayersTab'
import AuditTab from './tabs/AuditTab'
import type { Player } from './types'

type Tab = 'events' | 'spawns' | 'players' | 'audit'

const TABS: { key: Tab; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'spawns', label: 'Spawns' },
  { key: 'players', label: 'Players' },
  { key: 'audit', label: 'Audit' },
]

export default function App() {
  const [player, setPlayer] = useState<Player | null>(() => (getToken() ? ({ displayName: 'Admin' } as Player) : null))
  const [tab, setTab] = useState<Tab>('events')

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null)
      setPlayer(null)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  if (!player) {
    return <Login onSuccess={(p) => setPlayer(p)} />
  }

  return (
    <div>
      <div className="topbar">
        <span className="brand">Campus Forge · Admin</span>
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="logout"
          onClick={() => {
            setToken(null)
            setPlayer(null)
          }}
        >
          Sign out
        </button>
      </div>
      <div className="page">
        {tab === 'events' && <EventsTab />}
        {tab === 'spawns' && <SpawnsTab />}
        {tab === 'players' && <PlayersTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}
