import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import {
  acceptTrade,
  cancelTrade,
  createTrade,
  declineTrade,
  getIncomingTrades,
  getMyUniqueCards,
  getOutgoingTrades,
  getPlayerUniqueCards,
  searchPlayers,
} from '../api/tradeEndpoints'
import type { PlayerSummaryDto, TradeCardDto, TradeDto, UniqueCardDto } from '../api/types'

const POLL_MS = 15_000

function StatusLabel({ status }: { status: TradeDto['status'] }) {
  const map: Record<TradeDto['status'], string> = {
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    DECLINED: 'Declined',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  }
  return <span className={`chip ${status === 'PENDING' ? 'active' : ''}`}>{map[status]}</span>
}

function BundleList({ cards }: { cards: TradeCardDto[] }) {
  if (cards.length === 0) return <span style={{ color: 'var(--muted)' }}>—</span>
  return (
    <span>
      {cards.map((c) => (
        <span key={c.physicalUuid}>
          {c.forgeName} <span className="meta">#{c.serialNumber}</span>
          {cards.indexOf(c) < cards.length - 1 ? ', ' : ''}
        </span>
      ))}
    </span>
  )
}

function SelectableCard({
  card,
  selected,
  onToggle,
}: {
  card: UniqueCardDto
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={`card-tile ${selected ? '' : 'missing'}`}
      onClick={onToggle}
      style={{ cursor: 'pointer', borderColor: selected ? 'var(--good)' : undefined }}
    >
      <div className="name">{card.forgeName}</div>
      <div className="meta">
        {card.setCode ?? 'no set'} · serial #{card.serialNumber} · {card.rarity ?? ''}
      </div>
      <div className="owned" style={{ color: selected ? 'var(--good)' : 'var(--muted)' }}>
        {selected ? 'Selected' : 'Select'}
      </div>
    </div>
  )
}

export default function TradePage() {
  const { player } = useAuth()
  const myId = player?.id ?? ''

  const [myUniques, setMyUniques] = useState<UniqueCardDto[]>([])
  const [incoming, setIncoming] = useState<TradeDto[]>([])
  const [outgoing, setOutgoing] = useState<TradeDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlayerSummaryDto[]>([])
  const [partner, setPartner] = useState<PlayerSummaryDto | null>(null)
  const [partnerUniques, setPartnerUniques] = useState<UniqueCardDto[]>([])
  const [offered, setOffered] = useState<Set<string>>(new Set())
  const [requested, setRequested] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [composeError, setComposeError] = useState('')

  const loadTrades = useCallback(async () => {
    try {
      const [inc, out] = await Promise.all([getIncomingTrades(), getOutgoingTrades()])
      setIncoming(inc)
      setOutgoing(out)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [uniq] = await Promise.all([getMyUniqueCards(), loadTrades()])
        if (!mounted) return
        setMyUniques(uniq)
      } catch (err) {
        if (mounted) setError((err as Error).message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => {
      void loadTrades()
    }, POLL_MS)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [loadTrades])

  const onSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearchResults(await searchPlayers(query.trim()))
  }, [query])

  const pickPartner = useCallback(
    async (p: PlayerSummaryDto) => {
      setPartner(p)
      setPartnerUniques([])
      setOffered(new Set())
      setRequested(new Set())
      setComposeError('')
      setNotice('')
      try {
        setPartnerUniques(await getPlayerUniqueCards(p.id))
      } catch (err) {
        setComposeError((err as Error).message)
      }
    },
    [],
  )

  const toggleOffered = useCallback((uuid: string) => {
    setOffered((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }, [])

  const toggleRequested = useCallback((uuid: string) => {
    setRequested((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }, [])

  const onCreate = useCallback(async () => {
    if (!partner || offered.size === 0 || requested.size === 0) return
    setBusy(true)
    setComposeError('')
    setNotice('')
    try {
      await createTrade({
        receiverId: partner.id,
        offeredPhysicalUuids: [...offered],
        requestedPhysicalUuids: [...requested],
      })
      setNotice('Trade offered. Waiting for the other player to respond.')
      setOffered(new Set())
      setRequested(new Set())
      setPartnerUniques([])
      setPartner(null)
      setQuery('')
      await loadTrades()
    } catch (err) {
      setComposeError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [partner, offered, requested, loadTrades])

  const onAccept = useCallback(
    async (trade: TradeDto) => {
      setBusy(true)
      setError('')
      try {
        await acceptTrade(trade.id)
        await Promise.all([loadTrades(), getMyUniqueCards().then(setMyUniques)])
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [loadTrades],
  )

  const onDecline = useCallback(
    async (trade: TradeDto) => {
      setBusy(true)
      setError('')
      try {
        await declineTrade(trade.id)
        await loadTrades()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [loadTrades],
  )

  const onCancel = useCallback(
    async (trade: TradeDto) => {
      setBusy(true)
      setError('')
      try {
        await cancelTrade(trade.id)
        await loadTrades()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [loadTrades],
  )

  const canCreate = !!partner && offered.size > 0 && requested.size > 0

  if (loading) return <div className="page">Loading…</div>

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2>Uniques Trading</h2>
        <Link to="/collection" className="btn ghost">
          ← Back to Collection
        </Link>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        Offer bundles of unique cards. Pending trades refresh automatically.
      </p>

      {error && <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div>}
      {notice && <div className="empty" style={{ color: 'var(--good)' }}>{notice}</div>}

      <h3>Incoming offers</h3>
      {incoming.length === 0 && <div className="empty">No incoming offers.</div>}
      {incoming.map((trade) => (
        <div key={trade.id} className="card-tile" style={{ marginBottom: 8 }}>
          <div className="name">
            {trade.sender.displayName} offers you <BundleList cards={trade.offered} /> for your{' '}
            <BundleList cards={trade.requested} />
          </div>
          <div className="meta">
            <StatusLabel status={trade.status} /> · expires{' '}
            {trade.expiresAt ? new Date(trade.expiresAt).toLocaleString() : '—'}
          </div>
          {trade.status === 'PENDING' && (
            <div style={{ marginTop: 8 }}>
              <button className="btn" disabled={busy} onClick={() => void onAccept(trade)}>
                Accept
              </button>{' '}
              <button className="btn ghost" disabled={busy} onClick={() => void onDecline(trade)}>
                Decline
              </button>
            </div>
          )}
        </div>
      ))}

      <h3>Outgoing offers</h3>
      {outgoing.length === 0 && <div className="empty">No outgoing offers.</div>}
      {outgoing.map((trade) => (
        <div key={trade.id} className="card-tile" style={{ marginBottom: 8 }}>
          <div className="name">
            You offer <BundleList cards={trade.offered} /> for {trade.receiver.displayName}'s{' '}
            <BundleList cards={trade.requested} />
          </div>
          <div className="meta">
            <StatusLabel status={trade.status} /> · expires{' '}
            {trade.expiresAt ? new Date(trade.expiresAt).toLocaleString() : '—'}
          </div>
          {trade.status === 'PENDING' && (
            <div style={{ marginTop: 8 }}>
              <button className="btn ghost" disabled={busy} onClick={() => void onCancel(trade)}>
                Cancel offer
              </button>
            </div>
          )}
        </div>
      ))}

      <h3>New offer</h3>
      <div className="filters" style={{ marginBottom: 12 }}>
        <input
          placeholder="Find a player by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSearch()
          }}
          style={{ minWidth: 220 }}
        />
        <button className="btn ghost" onClick={() => void onSearch()}>
          Search
        </button>
      </div>
      {searchResults.length > 0 && !partner && (
        <div style={{ marginBottom: 12 }}>
          {searchResults
            .filter((p) => p.id !== myId)
            .map((p) => (
              <span key={p.id} className="chip active" onClick={() => void pickPartner(p)} style={{ cursor: 'pointer' }}>
                {p.displayName} · {p.degreeLevel ?? ''} {p.specialization ?? ''}
              </span>
            ))}
          {searchResults.every((p) => p.id === myId) && (
            <div className="empty">Only you match. Try another name.</div>
          )}
        </div>
      )}

      {partner && (
        <>
          <p>
            Trading with <strong>{partner.displayName}</strong>{' '}
            <span className="meta">
              ({partner.degreeLevel ?? ''} {partner.specialization ?? ''})
            </span>{' '}
            <button className="btn ghost" onClick={() => setPartner(null)}>
              Change partner
            </button>
          </p>
          {partnerUniques.length === 0 && (
            <div className="empty">This player has no unique cards to trade.</div>
          )}

          <h4>You offer ({offered.size})</h4>
          {myUniques.length === 0 && <div className="empty">You have no unique cards to offer.</div>}
          <div className="card-grid">
            {myUniques.map((c) => (
              <SelectableCard
                key={c.physicalUuid}
                card={c}
                selected={offered.has(c.physicalUuid)}
                onToggle={() => toggleOffered(c.physicalUuid)}
              />
            ))}
          </div>

          <h4>You request from {partner.displayName} ({requested.size})</h4>
          <div className="card-grid">
            {partnerUniques.map((c) => (
              <SelectableCard
                key={c.physicalUuid}
                card={c}
                selected={requested.has(c.physicalUuid)}
                onToggle={() => toggleRequested(c.physicalUuid)}
              />
            ))}
          </div>

          {composeError && <div className="empty" style={{ color: 'var(--danger)' }}>{composeError}</div>}
          <button className="btn" disabled={!canCreate || busy} onClick={() => void onCreate()}>
            Offer {offered.size} for {requested.size}
          </button>
        </>
      )}
    </div>
  )
}
