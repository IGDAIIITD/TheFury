import { useEffect, useMemo, useState } from 'react'
import {
  browseCards,
  createDeck,
  deleteDeck,
  getCollection,
  getDeck,
  listDecks,
  toggleFavorite,
  updateDeck,
  validateDeck,
} from '../api/endpoints'
import { colorIdentityOf, colorSwatches, swatchBg, swatchFg } from '../lib/colors'
import { CardArt } from '../lib/scryfall'
import type { CardDto, CollectionEntryDto, DeckCardDto, DeckDto, DeckProblemDto } from '../api/types'

interface LineItem {
  card: CardDto
  quantity: number
}

interface EditedDeck {
  id: string | null
  name: string
  formatCode: string
  commanderCardId: string | null
  lines: LineItem[]
}

type CatalogFilter = 'all' | 'favorites'

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
const MANA_CURVES = ['0', '1', '2', '3', '4+']

const emptyDeck = (): EditedDeck => ({
  id: null,
  name: 'New Deck',
  formatCode: 'STANDARD',
  commanderCardId: null,
  lines: [],
})

function toSaveInput(deck: EditedDeck) {
  return {
    name: deck.name,
    formatCode: deck.formatCode,
    commanderCardId: deck.commanderCardId,
    cards: deck.lines.map((l) => ({ cardId: l.card.id, quantity: l.quantity })),
  }
}

export default function DeckBuilderPage() {
  const [cards, setCards] = useState<CardDto[]>([])
  const [collection, setCollection] = useState<CollectionEntryDto[]>([])
  const [decks, setDecks] = useState<DeckDto[]>([])
  const [deck, setDeck] = useState<EditedDeck>(emptyDeck())
  const [search, setSearch] = useState('')
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all')
  const [colors, setColors] = useState<Set<string>>(new Set())
  const [curves, setCurves] = useState<Set<string>>(new Set())
  const [commanderEligibleOnly, setCommanderEligibleOnly] = useState(false)
  const [result, setResult] = useState<{ valid: boolean; problems: DeckProblemDto[] } | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedId, setLoadedId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([browseCards(), getCollection(), listDecks()])
      .then(([cardList, owned, deckList]) => {
        setCards(cardList)
        setCollection(owned)
        setDecks(deckList)
      })
      .catch(() => setNotice('Failed to load data.'))
  }, [])

  const ownedMap = useMemo(() => {
    const map = new Map<string, CollectionEntryDto>()
    for (const e of collection) {
      map.set(e.cardId, e)
    }
    return map
  }, [collection])

  const lineMap = useMemo(() => {
    const map = new Map<string, LineItem>()
    for (const l of deck.lines) {
      map.set(l.card.id, l)
    }
    return map
  }, [deck.lines])

  const totalCards = useMemo(() => deck.lines.reduce((sum, l) => sum + l.quantity, 0), [deck.lines])

  const toggleColor = (c: string) => {
    setColors((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  const toggleCurve = (cv: string) => {
    setCurves((prev) => {
      const next = new Set(prev)
      if (next.has(cv)) next.delete(cv)
      else next.add(cv)
      return next
    })
  }

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
    const q = search.toLowerCase()
    return cards.filter((card) => {
      const entry = ownedMap.get(card.id)
      const owned = entry ? entry.quantity : 0
      if (owned === 0) return false

      const inDeck = lineMap.get(card.id)?.quantity ?? 0
      if (owned !== 2147483647 && inDeck >= owned) return false

      if (q && !card.forgeName.toLowerCase().includes(q)) return false
      const isFav = entry?.favorite ?? false

      if (catalogFilter === 'favorites' && !isFav) return false
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

      return true
    })
  }, [cards, ownedMap, lineMap, search, catalogFilter, colors, curves, commanderEligibleOnly])

  const loadDeck = async (id: string) => {
    try {
      const d = await getDeck(id)
      const cardById = new Map(cards.map((c) => [c.id, c]))
      setDeck({
        id: d.id,
        name: d.name,
        formatCode: d.formatCode,
        commanderCardId: d.commanderCardId,
        lines: d.cards
          .map((dc: DeckCardDto) => {
            const card = cardById.get(dc.cardId)
            return card ? { card, quantity: dc.quantity } : null
          })
          .filter((l): l is LineItem => l !== null),
      })
      setLoadedId(id)
      setResult(null)
      setNotice('')
    } catch {
      setNotice('Could not load that deck.')
    }
  }

  const newDeck = () => {
    setDeck(emptyDeck())
    setLoadedId(null)
    setResult(null)
    setNotice('')
  }

  const addCard = (card: CardDto) => {
    setDeck((prev) => {
      const existing = lineMap.get(card.id)
      if (existing) {
        return {
          ...prev,
          lines: prev.lines.map((l) => (l.card.id === card.id ? { ...l, quantity: l.quantity + 1 } : l)),
        }
      }
      return { ...prev, lines: [...prev.lines, { card, quantity: 1 }] }
    })
    setResult(null)
  }

  const setQuantity = (cardId: string, quantity: number) => {
    setDeck((prev) => {
      if (quantity <= 0) {
        return { ...prev, lines: prev.lines.filter((l) => l.card.id !== cardId) }
      }
      return {
        ...prev,
        lines: prev.lines.map((l) => (l.card.id === cardId ? { ...l, quantity } : l)),
      }
    })
    setResult(null)
  }

  const setCommander = (cardId: string | null) => {
    setDeck((prev) => ({ ...prev, commanderCardId: cardId }))
    setResult(null)
  }

  const validate = async () => {
    setBusy(true)
    setNotice('')
    try {
      const res = await validateDeck(
        deck.formatCode,
        deck.commanderCardId,
        deck.lines.map((l) => ({ cardId: l.card.id, quantity: l.quantity })),
      )
      setResult({ valid: res.valid, problems: res.problems })
    } catch {
      setNotice('Validation failed on the server.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setNotice('')
    try {
      const input = toSaveInput(deck)
      const saved = deck.id ? await updateDeck(deck.id, input) : await createDeck(input)
      setDeck((prev) => ({ ...prev, id: saved.id, name: saved.name }))
      setLoadedId(saved.id)
      setResult(null)
      setDecks(await listDecks())
      setNotice('Deck saved.')
    } catch (err) {
      const data = (err as { response?: { data?: { message?: string; details?: DeckProblemDto[] } } }).response?.data
      if (data?.details) {
        setResult({ valid: false, problems: data.details })
        setNotice('')
      } else {
        setNotice(data?.message ?? 'Save failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (loadedId === id) {
      newDeck()
    }
    await deleteDeck(id)
    setDecks(await listDecks())
  }

  const formatChanged = (code: string) => {
    setDeck((prev) => ({
      ...prev,
      formatCode: code,
      commanderCardId: prev.commanderCardId && code !== 'COMMANDER' ? null : prev.commanderCardId,
    }))
    setResult(null)
  }

  const commander = deck.commanderCardId ? lineMap.get(deck.commanderCardId) ?? null : null

  return (
    <div className="page">
      <h2>Deck Builder</h2>

      <div className="filters">
        <select value={deck.formatCode} onChange={(e) => formatChanged(e.target.value)}>
          <option value="STANDARD">Standard</option>
          <option value="COMMANDER">Commander</option>
        </select>
        <input
          value={deck.name}
          onChange={(e) => setDeck((prev) => ({ ...prev, name: e.target.value }))}
          style={{ minWidth: 180 }}
        />
        <input
          placeholder="Filter catalog…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 160 }}
        />
        <span
          className={`chip ${catalogFilter === 'favorites' ? 'active' : ''}`}
          onClick={() => setCatalogFilter((f) => (f === 'favorites' ? 'all' : 'favorites'))}
        >
          ⭐ Favorites
        </span>
        <span
          className={`chip ${commanderEligibleOnly ? 'active' : ''}`}
          onClick={() => setCommanderEligibleOnly((v) => !v)}
        >
          Commander Eligible
        </span>
        <span style={{ width: 4 }} />
        {COLORS.map((c) => (
          <span
            key={c}
            className={`chip ${colors.has(c) ? 'active' : ''}`}
            onClick={() => toggleColor(c)}
          >
            {c === 'C' ? 'C' : c}
          </span>
        ))}
        <span style={{ width: 4 }} />
        {MANA_CURVES.map((cv) => (
          <span
            key={cv}
            className={`chip ${curves.has(cv) ? 'active' : ''}`}
            onClick={() => toggleCurve(cv)}
          >
            {cv}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={save} disabled={busy}>
          Save
        </button>
        <button className="btn ghost" onClick={validate} disabled={busy}>
          Validate
        </button>
        <button className="btn ghost" onClick={newDeck}>
          New
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 14 }}>Total: {totalCards}</span>
      </div>

      {deck.formatCode === 'COMMANDER' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>Commander (99+1)</h3>
          <div className="filters">
            <span className="chip" style={{ cursor: 'default' }}>
              {commander ? commander.card.forgeName : 'No commander set'}
            </span>
            {cards
              .filter((c) => c.commanderEligible)
              .map((c) => (
                <span
                  key={c.id}
                  className={`chip ${deck.commanderCardId === c.id ? 'active' : ''}`}
                  onClick={() => setCommander(c.id)}
                >
                  {c.forgeName}
                </span>
              ))}
            <span className="chip" onClick={() => setCommander(null)}>
              None
            </span>
          </div>
        </div>
      )}

      {notice && (
        <div className="problem good">
          {notice} <span style={{ cursor: 'pointer' }} onClick={() => setNotice('')}>×</span>
        </div>
      )}
      {result && (
        <div className={`problem ${result.valid ? 'good' : ''}`}>
          {result.valid ? 'Deck is valid!' : 'Deck has problems:'}
        </div>
      )}
      {result &&
        !result.valid &&
        result.problems.map((p, i) => (
          <div key={i} className="problem">
            {p.code}: {p.message}
          </div>
        ))}

      <div className="deck-layout">
        <div className="panel">
          <h3>Catalog</h3>
          <div className="card-grid compact">
            {filtered.length === 0 && <div className="empty">No cards match.</div>}
            {filtered.map((card) => {
              const entry = ownedMap.get(card.id)
              const owned = entry ? entry.quantity : 0
              const isFav = entry?.favorite ?? false
              const inDeck = lineMap.get(card.id)?.quantity ?? 0
              return (
                <div key={card.id} className="card-tile" onClick={() => addCard(card)}>
                  <CardArt name={card.forgeName} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="name">
                      {card.manaValue !== null && card.manaValue > 0 && <span className="mana">{card.manaValue}</span>}{' '}
                      {card.forgeName}
                    </div>
                    {owned > 0 && (
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
                  <div className="meta">{card.types ?? ''}</div>
                  <div className="owned" style={{ color: 'var(--good)' }}>
                    Owned: {owned === 2147483647 ? '∞' : owned}
                  </div>
                  <div className="meta" style={{ color: 'var(--accent-2)' }}>In deck: {inDeck}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="panel">
          <h3>Deck</h3>
          <div style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 13 }}>
            {deck.lines.length} different cards · {totalCards} total
          </div>
          {deck.lines.length === 0 && <div className="empty">Click a card to add it.</div>}
          {deck.lines.map((l) => (
            <div key={l.card.id} className="deck-row">
              <span className="qty">{l.quantity}</span>
              <span className="grow">{l.card.forgeName}</span>
              {deck.commanderCardId === l.card.id && (
                <span style={{ color: 'var(--warn)', fontSize: 12, fontWeight: 700 }}>Commander</span>
              )}
              <button
                className="btn ghost"
                style={{ padding: '4px 10px' }}
                onClick={() => setQuantity(l.card.id, l.quantity - 1)}
              >
                −
              </button>
              <button
                className="btn ghost"
                style={{ padding: '4px 10px' }}
                onClick={() => setQuantity(l.card.id, l.quantity + 1)}
              >
                +
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3>Saved Decks</h3>
        {decks.length === 0 && <div className="empty">No saved decks yet.</div>}
        {decks.map((d) => (
          <div key={d.id} className="deck-row">
            <span className="grow">
              <span style={{ fontWeight: 700 }}>{d.name}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{d.formatCode}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                {d.cards.reduce((s, c) => s + c.quantity, 0)} cards
              </span>
            </span>
            <button className="btn ghost" onClick={() => loadDeck(d.id)}>
              Open
            </button>
            <button className="btn ghost danger" onClick={() => remove(d.id)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
