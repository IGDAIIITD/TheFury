import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { FeedEntryDto } from '../types'

const TYPE_LABEL: Record<FeedEntryDto['type'], string> = {
  DISCOVERY: 'Discovery',
  ACHIEVEMENT: 'Achievement',
  EVENT: 'Event',
  SPAWN: 'Spawn',
  TRADE: 'Trade',
}

export default function AuditTab() {
  const [entries, setEntries] = useState<FeedEntryDto[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api
      .get<FeedEntryDto[]>('/admin/audit')
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load audit feed'))
  }, [])

  useEffect(load, [load])

  return (
    <div>
      <h2>Audit feed</h2>
      {error && <p className="error-text">{error}</p>}
      <p className="meta">Same in-memory feed as the player-facing Events page, including event lifecycle and spawn activity.</p>
      <div className="panel">
        {entries.length === 0 && <p className="empty">No activity yet.</p>}
        {entries.map((entry, idx) => (
          <div className="row" key={`${entry.createdAt}:${idx}`}>
            <span className={`badge ${entry.type === 'SPAWN' || entry.type === 'EVENT' ? 'warn' : 'meta'}`}>
              {TYPE_LABEL[entry.type]}
            </span>
            <div className="grow">
              <span>{entry.playerName ? `${entry.playerName} ` : ''}— {entry.message}</span>
              <div className="meta">{new Date(entry.createdAt).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
