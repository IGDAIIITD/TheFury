import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { CardDto, ClaimDto, EventDto, MintClaimInput } from '../types'

export default function SpawnsTab() {
  const [cards, setCards] = useState<CardDto[]>([])
  const [claims, setClaims] = useState<ClaimDto[]>([])
  const [events, setEvents] = useState<EventDto[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [cardId, setCardId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [building, setBuilding] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [eventId, setEventId] = useState('')

  const load = useCallback(() => {
    api
      .get<ClaimDto[]>('/admin/claims')
      .then(setClaims)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load spawns'))
  }, [])

  useEffect(() => {
    load()
    api
      .get<CardDto[]>('/cards')
      .then((all) => setCards(all.filter((c) => c.ownershipType === 'UNLIMITED')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load cards'))
    api
      .get<EventDto[]>('/events')
      .then(setEvents)
      .catch(() => {})
  }, [load])

  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? cards.filter((c) => c.forgeName.toLowerCase().includes(q)) : cards
  }, [cards, search])

  const mint = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const payload: MintClaimInput = {
      cardId,
      quantity: Number(quantity) || 1,
      building: building.trim() || undefined,
      expiresAt: expiresAt ? `${expiresAt}:00` : null,
      eventId: eventId || null,
    }
    try {
      const created = await api.post<ClaimDto[]>('/admin/claims', payload)
      setNotice(`Spawned ${created.length} token(s).`)
      setCardId('')
      setQuantity('1')
      setBuilding('')
      setExpiresAt('')
      setEventId('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mint failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2>Spawns</h2>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="meta" style={{ color: 'var(--good)' }}>{notice}</p>}

      <form className="panel" onSubmit={mint}>
        <h3>Mint spawn tokens</h3>
        <div className="form-grid">
          <div className="field span-2">
            <label>Card (UNLIMITED catalog)</label>
            <input placeholder="Search cards…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select required value={cardId} onChange={(e) => setCardId(e.target.value)}>
              <option value="">Select a card…</option>
              {filtered.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.forgeName} {c.setCode ? `(${c.setCode})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quantity</label>
            <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label>Event (optional)</label>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">— none —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} {ev.active ? '(live)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Building (optional)</label>
            <input placeholder="e.g. Block C" value={building} onChange={(e) => setBuilding(e.target.value)} />
          </div>
          <div className="field">
            <label>Expires at (optional)</label>
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <button className="btn" disabled={busy || !cardId} type="submit">
          Mint
        </button>
      </form>

      <div className="panel">
        <h3>Active & recent spawns</h3>
        {claims.length === 0 && <p className="empty">No spawns yet.</p>}
        {claims.map((claim) => {
          const cls = claim.status === 'ACTIVE' ? 'good' : claim.status === 'CLAIMED' ? 'meta' : 'warn'
          return (
            <div className="row" key={claim.id}>
              <span className={`badge ${cls}`}>{claim.status}</span>
              <div className="grow">
                <strong>{claim.forgeName}</strong>
                <div className="meta">
                  token {claim.token.slice(0, 8)}… · {claim.building ?? 'no building'} · by {claim.spawnedBy ?? '?'}
                  {claim.eventName ? ` · ${claim.eventName}` : ''} · {new Date(claim.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
