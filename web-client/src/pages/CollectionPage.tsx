import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { browseCards, getCollection, toggleFavorite } from '../api/endpoints'
import { colorIdentityOf, colorSwatches, swatchBg, swatchFg } from '../lib/colors'
import { CardArt } from '../lib/scryfall'
import { Chip, FilterBar, FilterGroup } from '../components/Filters'
import { CACHE_KEYS, cacheGet, cacheSet } from '../lib/idb'
import type { CardDto, CollectionEntryDto } from '../api/types'

type OwnedFilter = 'all' | 'owned' | 'missing' | 'recent' | 'favorites'

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
const MANA_CURVES = ['0', '1', '2', '3', '4+']
const RARITY_COLORS: Record<string, string> = {
  common: '#6f6459',
  uncommon: '#6b8193',
  rare: '#b8892a',
  mythic: '#d2601a',
}
const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Mythic']
/** Cards rendered before "See all" (keeps the first paint and image downloads light). */
const INITIAL_VISIBLE = 25
/** An UNLOCK card gives one copy per distinct code scanned, up to this many (apply_claim). */
const MAX_UNLOCK_COPIES = 4

export default function CollectionPage() {
  const [cards, setCards] = useState<CardDto[]>([])
  const [collection, setCollection] = useState<CollectionEntryDto[]>([])
  const [search, setSearch] = useState('')
  const [ownedFilter, setOwnedFilter] = useState<OwnedFilter>('owned')
  const [colors, setColors] = useState<Set<string>>(new Set())
  const [curves, setCurves] = useState<Set<string>>(new Set())
  const [commanderEligibleOnly, setCommanderEligibleOnly] = useState(false)
  const [sets, setSets] = useState<Set<string>>(new Set())
  const [rarities, setRarities] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const [cachedCards, cachedCollection] = await Promise.all([
        cacheGet<CardDto[]>(CACHE_KEYS.cards),
        cacheGet<CollectionEntryDto[]>(CACHE_KEYS.collection),
      ])
      if (!mounted) return
      if (cachedCards) setCards(cachedCards)
      if (cachedCollection) setCollection(cachedCollection)
      try {
        const [cardList, owned] = await Promise.all([browseCards(), getCollection()])
        if (!mounted) return
        setCards(cardList)
        setCollection(owned)
        void cacheSet(CACHE_KEYS.cards, cardList)
        void cacheSet(CACHE_KEYS.collection, owned)
      } catch (err) {
        if (mounted && !cachedCards && !cachedCollection) {
          setError('Failed to load collection.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const ownedMap = useMemo(() => {
    const map = new Map<string, CollectionEntryDto>()
    for (const e of collection) {
      map.set(e.cardId, e)
    }
    return map
  }, [collection])

  const toggleColor = useCallback((color: string) => {
    setColors((prev) => {
      const next = new Set(prev)
      if (next.has(color)) next.delete(color)
      else next.add(color)
      return next
    })
  }, [])

  const toggleCurve = useCallback((curve: string) => {
    setCurves((prev) => {
      const next = new Set(prev)
      if (next.has(curve)) next.delete(curve)
      else next.add(curve)
      return next
    })
  }, [])

  const toggleSet = useCallback((setCode: string) => {
    setSets((prev) => {
      const next = new Set(prev)
      if (next.has(setCode)) next.delete(setCode)
      else next.add(setCode)
      return next
    })
  }, [])

  const toggleRarity = useCallback((rarity: string) => {
    setRarities((prev) => {
      const next = new Set(prev)
      if (next.has(rarity)) next.delete(rarity)
      else next.add(rarity)
      return next
    })
  }, [])

  const availableSets = useMemo(() => {
    return [...new Set(cards.map((c) => c.setCode).filter((s): s is string => !!s))].sort()
  }, [cards])

  const availableRarities = useMemo(() => {
    const found = new Set(cards.map((c) => c.rarity).filter((r): r is string => !!r))
    return RARITY_ORDER.filter((r) => found.has(r)).concat(
      [...found].filter((r) => !RARITY_ORDER.includes(r)).sort(),
    )
  }, [cards])

  const onToggleFav = async (e: React.MouseEvent, cardId: string) => {
    e.stopPropagation()
    try {
      const newFav = await toggleFavorite(cardId)
      setCollection((prev) =>
        prev.map((entry) => (entry.cardId === cardId ? { ...entry, favorite: newFav } : entry)),
      )
    } catch {
      // ignore
    }
  }

  const filtered = useMemo(() => {
    return cards.filter((card) => {
      if (search && !card.forgeName.toLowerCase().includes(search.toLowerCase())) {
        return false
      }
      const entry = ownedMap.get(card.id)
      const owned = entry !== undefined
      const isFav = entry?.favorite ?? false

      if (ownedFilter === 'owned' && !owned) return false
      if (ownedFilter === 'missing' && owned) return false
      if (ownedFilter === 'recent' && !(entry && entry.discoveredCount > 0)) return false
      if (ownedFilter === 'favorites' && !isFav) return false

      if (commanderEligibleOnly && !card.commanderEligible) return false

      const cardColors = card.colors ? card.colors.split('').filter((c) => c !== '') : []
      if (colors.size > 0) {
        const match = [...colors].some((c) => (c === 'C' ? cardColors.length === 0 : cardColors.includes(c)))
        if (!match) return false
      }

      const mv = card.manaValue ?? 0
      if (curves.size > 0) {
        const match = [...curves].some((cv) => {
          if (cv === '4+') return mv >= 4
          return mv === parseInt(cv, 10)
        })
        if (!match) return false
      }

      if (sets.size > 0 && (!card.setCode || !sets.has(card.setCode))) return false
      if (rarities.size > 0 && (!card.rarity || !rarities.has(card.rarity))) return false

      return true
    })
  }, [cards, ownedMap, search, ownedFilter, colors, curves, commanderEligibleOnly, sets, rarities])

  const totalOwned = useMemo(() => collection.length, [collection])
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE)

  if (loading) return <div className="page">Loading…</div>
  if (error) return <div className="page empty">{error}</div>

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2>Collection</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/collection/events" className="btn ghost">
            Events
          </Link>
          <Link to="/collection/trades" className="btn ghost">
            ↔ Trades
          </Link>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        {totalOwned} unique cards owned · {cards.length} cards in the catalog
      </p>

      <input
        className="filter-search"
        placeholder="Search cards…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <FilterBar>
        <FilterGroup label="Show" tone="show">
          {(
            [
              ['all', 'All'],
              ['owned', 'Owned'],
              ['missing', 'Missing'],
              ['recent', 'Recently found'],
              ['favorites', 'Favorites'],
            ] as [OwnedFilter, string][]
          ).map(([key, label]) => (
            <Chip
              key={key}
              active={ownedFilter === key}
              onClick={() => setOwnedFilter((current) => (current === key ? 'all' : key))}
            >
              {label}
            </Chip>
          ))}
          <Chip active={commanderEligibleOnly} onClick={() => setCommanderEligibleOnly((v) => !v)}>
            Commander
          </Chip>
        </FilterGroup>
        <FilterGroup label="Color" tone="color">
          {COLORS.map((c) => (
            <Chip key={c} active={colors.has(c)} onClick={() => toggleColor(c)} color={swatchBg(c)} title={colorIdentityOf(c === 'C' ? null : c)}>
              <span className="chip-dot" style={{ background: swatchBg(c) }} aria-hidden />
              {c === 'C' ? 'Colorless' : colorIdentityOf(c)}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Mana value" tone="mana">
          {MANA_CURVES.map((cv) => (
            <Chip key={cv} active={curves.has(cv)} onClick={() => toggleCurve(cv)}>
              {cv}
            </Chip>
          ))}
        </FilterGroup>
        {availableSets.length > 0 && (
          <FilterGroup label="Set" tone="set">
            {availableSets.map((set) => (
              <Chip key={set} active={sets.has(set)} onClick={() => toggleSet(set)}>
                {set}
              </Chip>
            ))}
          </FilterGroup>
        )}
        {availableRarities.length > 0 && (
          <FilterGroup label="Rarity" tone="rarity">
            {availableRarities.map((r) => (
              <Chip key={r} active={rarities.has(r)} onClick={() => toggleRarity(r)} color={RARITY_COLORS[r.toLowerCase()]}>
                {r}
              </Chip>
            ))}
          </FilterGroup>
        )}
      </FilterBar>

      <div className="card-grid">
        {filtered.length === 0 && <div className="empty">No cards match.</div>}
        {visible.map((card) => {
          const entry = ownedMap.get(card.id)
          const owned = entry !== undefined
          const quantity = entry ? entry.quantity : 0
          const discovered = entry ? entry.discoveredCount : 0
          const isFav = entry?.favorite ?? false
          const label = !owned
            ? card.requiresUnlock
              ? 'Missing · scan once for unlimited'
              : 'Missing'
            : card.ownershipType === 'UNLIMITED'
              ? 'Unlimited'
              : card.ownershipType === 'UNLOCK'
                ? `Owned: ${quantity} of ${MAX_UNLOCK_COPIES}`
                : `Owned: ${quantity}`
          return (
            <div key={card.id} className={`card-tile ${owned ? '' : 'missing'}`}>
              <CardArt name={card.forgeName} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="name">
                  {card.manaValue !== null && card.manaValue > 0 && (
                    <span className="mana">{card.manaValue}</span>
                  )}{' '}
                  {card.forgeName}
                </div>
                {owned && (
                  <span
                    onClick={(e) => onToggleFav(e, card.id)}
                    style={{ cursor: 'pointer', fontSize: 16 }}
                    title={isFav ? 'Unfavorite' : 'Favorite'}
                  >
                    {isFav ? '⭐' : '☆'}
                  </span>
                )}
              </div>
              <div className="identity">
                {colorSwatches(card.colors).map((c) => (
                  <span
                    key={c}
                    className="swatch"
                    style={{ background: swatchBg(c), color: swatchFg(c) }}
                  >
                    {c}
                  </span>
                ))}
                <span className="meta">{colorIdentityOf(card.colors)}</span>
              </div>
              <div className="meta">
                {card.types ?? ''} · {card.rarity ?? ''}
              </div>
              <div className="meta ownership-line">
                Ownership: {card.ownershipType}
                {card.requiresUnlock ? ' (scan once)' : ''}
              </div>
              <div className="owned" style={{ color: owned ? 'var(--good)' : 'var(--muted)' }}>
                {label}
                {discovered > 0 && <span style={{ color: 'var(--warn)' }}> · found ×{discovered}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {!showAll && filtered.length > INITIAL_VISIBLE && (
        <div className="card-grid-more">
          <button className="btn" onClick={() => setShowAll(true)}>
            See all ({filtered.length})
          </button>
        </div>
      )}
    </div>
  )
}
