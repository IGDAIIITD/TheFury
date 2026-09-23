import { useEffect, useRef, useState } from 'react'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import {
  createMatch,
  createLobby,
  joinMatch,
  getBattleFeatures,
  listMatches,
  concedeMatch,
  getMatchState,
} from '../api/battleEndpoints'
import { listDecks } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import type { MatchDto, MatchState, PendingChoice, MatchPlayerState } from '../api/battleTypes'
import type { DeckDto } from '../api/types'
import BattleCard from '../components/BattleCard'
import {
  friendlyPhase,
  phaseStrip,
  instructionFor,
  matchOptionsToCards,
  interactiveZones,
  isImmediateChoice,
  primaryActionLabel,
  isInCombatPhase,
  manaList,
} from './battleUi'
import type { BattleInstruction, MatchZone, OptionMatch } from './battleUi'

interface GameEvent {
  id: number
  text: string
  kind: 'life' | 'zone' | 'phase' | 'turn' | 'system'
}

function LifePill({ delta }: { delta: number }) {
  const color = delta < 0 ? 'var(--bad)' : 'var(--good)'
  const text = delta < 0 ? `−${-delta}` : `+${delta}`
  return (
    <span
      style={{
        color,
        fontWeight: 800,
        fontSize: 20,
        marginLeft: 8,
        animation: 'pulse 1.2s ease',
      }}
    >
      {text}
    </span>
  )
}

function HealthBar({ life, maxLife = 20 }: { life: number; maxLife?: number }) {
  const pct = Math.max(0, Math.min(100, (life / maxLife) * 100))
  const color = pct > 60 ? 'var(--good)' : pct > 30 ? '#f0ad4e' : 'var(--bad)'
  return (
    <div className="health-bar-vertical">
      <span className="health-bar-number" style={{ color }}>{life}</span>
      <div className="health-bar-track">
        <div
          className="health-bar-fill"
          style={{ height: `${pct}%`, background: color }}
        />
      </div>
      <span className="health-bar-label">HP</span>
    </div>
  )
}

function ManaBars({ pool }: { pool: Record<string, number> | null | undefined }) {
  const pips = manaList(pool)
  if (pool == null || pips.length === 0) return null
  const maxCount = Math.max(...pips.map((p) => p.count), 1)
  const colorMap: Record<string, string> = {
    W: '#f9faf4',
    U: '#0e68ab',
    B: '#2b2a2e',
    R: '#d3202a',
    G: '#00733e',
    C: '#9ca3af',
  }
  return (
    <div className="mana-bars" aria-label="Mana pool">
      {pips.map((p) => (
        <div key={p.color} className="mana-bar-row">
          <span className="mana-bar-icon" aria-hidden>{p.emoji}</span>
          <div className="mana-bar-track">
            <div
              className="mana-bar-fill"
              style={{
                width: `${(p.count / maxCount) * 100}%`,
                background: colorMap[p.color] ?? '#9ca3af',
              }}
            />
          </div>
          <span className="mana-bar-count">{p.count}</span>
        </div>
      ))}
    </div>
  )
}

function eventColor(kind: GameEvent['kind']) {
  switch (kind) {
    case 'life':
      return 'var(--bad)'
    case 'phase':
      return 'var(--accent)'
    case 'turn':
      return 'var(--good)'
    default:
      return 'var(--muted)'
  }
}

function PhaseStrip({ phase }: { phase: string | null }) {
  const steps = phaseStrip(phase)
  return (
    <div className="phase-strip" aria-label="Turn steps">
      {steps.map((s) => (
        <div
          key={s.key}
          className={`phase-step${s.active ? ' active' : ''}${s.inCombat && s.key === 'COMBAT_BEGIN' ? ' in-combat' : ''}`}
        >
          {s.label}
        </div>
      ))}
    </div>
  )
}

function InstructionBanner({ instruction }: { instruction: BattleInstruction }) {
  return (
    <div className={`instruction-banner ${instruction.tone}`}>
      <div className="instruction-title">{instruction.title}</div>
      {instruction.detail && <div className="instruction-detail">{instruction.detail}</div>}
    </div>
  )
}

function OpponentRow({
  opponent,
  lifeDelta,
}: {
  opponent: MatchPlayerState
  lifeDelta?: number
}) {
  return (
    <div className="panel opponent-row">
      <div className="opponent-content">
        <HealthBar life={opponent.life} />
        <div className="opponent-info">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="opponent-name">{opponent.name}</span>
            {lifeDelta !== undefined && <LifePill delta={lifeDelta} />}
          </div>
          <span className="opponent-meta">
            Hand {opponent.handSize} · Library {opponent.librarySize} · Graveyard {opponent.graveyard?.length ?? 0}
          </span>
          <ManaBars pool={opponent.mana} />
        </div>
      </div>
    </div>
  )
}

function ActionBar({
  choice,
  textOptions,
  hasCardOptions,
  selected,
  canConfirm,
  onSend,
}: {
  choice: PendingChoice
  textOptions: OptionMatch[]
  hasCardOptions: boolean
  selected: Set<number>
  canConfirm: boolean
  onSend: (indices: number[]) => void
}) {
  const immediate = isImmediateChoice(choice)
  const primary = primaryActionLabel(choice)
  const canSkip = choice.cancellable || choice.minCount === 0
  const confirmRow = hasCardOptions && !!primary && !immediate && selected.size > 0
  const showPass = hasCardOptions && choice.type === 'play' && canSkip
  const showLoneSkip = canSkip && !confirmRow && !showPass && textOptions.length === 0

  const hint =
    choice.type === 'play'
      ? 'Tap a card in your hand (or an ability on your board) to play it, or pass.'
      : immediate
        ? 'Tap a card to choose it.'
        : selected.size === 0
          ? 'Tap cards to select them.'
          : `Tap the cards you want, then press ${primary}.`

  const confirm = () => onSend(Array.from(selected).sort((a, b) => a - b))

  return (
    <div className="battle-actionbar">
      {textOptions.length > 0 && (
        <div className="battle-text-options">
          {textOptions.map((m) => (
            <button key={m.optionIndex} className="btn" onClick={() => onSend([m.optionIndex])}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {confirmRow && (
        <div className="battle-confirm-row">
          <button className="btn primary" disabled={!canConfirm} onClick={confirm}>
            {primary} ({selected.size}/{choice.maxCount})
          </button>
          {canSkip && (
            <button className="btn" onClick={() => onSend([])}>
              Skip
            </button>
          )}
        </div>
      )}

      {showPass && (
        <div className="battle-confirm-row">
          <button className="btn" onClick={() => onSend([])}>
            Pass Priority
          </button>
        </div>
      )}

      {showLoneSkip && (
        <div className="battle-confirm-row">
          <button className="btn" onClick={() => onSend([])}>
            {choice.type === 'play' ? 'Pass' : 'Skip'}
          </button>
        </div>
      )}

      {(hasCardOptions || textOptions.length > 0) && <div className="battle-action-hint">{hint}</div>}
    </div>
  )
}

export default function BattlePage() {
  const { player, token } = useAuth()
  const [matches, setMatches] = useState<MatchDto[]>([])
  const [decks, setDecks] = useState<DeckDto[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [activeMatch, setActiveMatch] = useState<MatchDto | null>(null)
  const [gameState, setGameState] = useState<MatchState | null>(null)
  const [info, setInfo] = useState('')
  const [notice, setNotice] = useState('')
  const [aiEnabled, setAiEnabled] = useState(false)
  const clientRef = useRef<Client | null>(null)

  const [events, setEvents] = useState<GameEvent[]>([])
  const [lifeDeltas, setLifeDeltas] = useState<Record<number, { delta: number }>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showArt, setShowArt] = useState(() => localStorage.getItem('cf_card_display') === 'art')
  const eventSeq = useRef(0)
  const prevStateRef = useRef<MatchState | null>(null)
  const resumingRef = useRef(false)

  useEffect(() => {
    Promise.all([listMatches(), listDecks(), getBattleFeatures()])
      .then(([mList, dList, feats]) => {
        setMatches(mList)
        setDecks(dList)
        setAiEnabled(feats.aiBattlesEnabled)
        if (dList.length > 0) setSelectedDeckId(dList[0].id)
      })
      .catch(() => setNotice('Failed to load battle data.'))
  }, [])

  const myIndex = (() => {
    if (!activeMatch || !player) return 0
    return activeMatch.player1Id === player.id ? 0 : 1
  })()

  // WebSocket connection + catch-up fetch for reconnect
  useEffect(() => {
    if (!activeMatch || !player || !token) return

    getMatchState(activeMatch.id)
      .then(setGameState)
      .catch(() => {})

    const socketUrl = `${window.location.protocol}//${window.location.host}/ws/match`
    const client = new Client({
      webSocketFactory: () => new SockJS(socketUrl),
      connectHeaders: { Authorization: `Bearer ${token}` },
      reconnectDelay: 5000,
      onConnect: () => {
        client.subscribe(`/topic/match/${activeMatch.id}/p${myIndex}`, (msg) => {
          const parsed = JSON.parse(msg.body)
          if (parsed.type === 'info') {
            setInfo(parsed.message as string)
            return
          }
          setGameState(parsed)
          if (parsed.gameOver) {
            listMatches().then(setMatches).catch(() => {})
          }
        })
      },
    })
    clientRef.current = client
    client.activate()

    return () => {
      client.deactivate()
      clientRef.current = null
    }
  }, [activeMatch, player, token, myIndex])

  // Reconnect-on-resume: a backgrounded/suspended tab can silently kill the
  // socket and pause JS timers, so on return we immediately re-establish the
  // connection and re-sync the board from REST instead of waiting on the
  // STOMP reconnectDelay (which only ticks while the page is alive).
  useEffect(() => {
    if (!activeMatch) return

    const resume = () => {
      if (resumingRef.current) return
      resumingRef.current = true
      const client = clientRef.current
      if (client && !client.connected && !client.active) {
        client.activate()
      }
      getMatchState(activeMatch.id)
        .then(setGameState)
        .catch(() => {})
      listMatches().then(setMatches).catch(() => {})
      window.setTimeout(() => {
        resumingRef.current = false
      }, 1000)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume()
    }
    const onPageHide = () => {
      clientRef.current?.deactivate()
    }

    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeMatch])

  // While waiting for an opponent to join a lobby, poll for the game starting.
  useEffect(() => {
    if (!activeMatch || activeMatch.status !== 'PENDING') return
    const id = setInterval(async () => {
      try {
        const s = await getMatchState(activeMatch.id)
        if (Array.isArray(s.players) && s.players.length > 0 && !s.gameOver) {
          setGameState(s)
        }
      } catch {
        // lobby not running yet
      }
    }, 3000)
    return () => clearInterval(id)
  }, [activeMatch])

  // Derive a lightweight event feed + life deltas by diffing consecutive snapshots.
  useEffect(() => {
    if (!gameState || !Array.isArray(gameState.players) || gameState.players.length === 0) {
      prevStateRef.current = gameState ?? null
      return
    }
    const prev = prevStateRef.current
    prevStateRef.current = gameState
    if (!prev || !Array.isArray(prev.players) || prev.players.length === 0) return

    const next: GameEvent[] = []
    const deltas: Record<number, { delta: number }> = {}

    if (gameState.turn !== prev.turn) {
      next.push({ id: eventSeq.current++, kind: 'turn', text: `Turn ${gameState.turn} begins.` })
    }
    if (gameState.phase && gameState.phase !== prev.phase) {
      next.push({ id: eventSeq.current++, kind: 'phase', text: `Phase: ${friendlyPhase(gameState.phase)}` })
    }

    for (const p of gameState.players) {
      const oldP = prev.players.find((o) => o.index === p.index)
      if (!oldP) continue

      const lifeDelta = p.life - oldP.life
      if (lifeDelta !== 0) {
        deltas[p.index] = { delta: lifeDelta }
        next.push({
          id: eventSeq.current++,
          kind: 'life',
          text: lifeDelta < 0
            ? `${p.name} loses ${-lifeDelta} life → ${p.life}.`
            : `${p.name} gains ${lifeDelta} life → ${p.life}.`,
        })
      }

      for (const c of p.battlefield) {
        if (!oldP.battlefield.some((o) => o.id === c.id)) {
          next.push({ id: eventSeq.current++, kind: 'zone', text: `${p.name} plays ${c.name}.` })
        }
      }
      for (const c of oldP.battlefield) {
        if (!p.battlefield.some((o) => o.id === c.id)) {
          next.push({ id: eventSeq.current++, kind: 'zone', text: `${p.name}'s ${c.name} leaves the battlefield.` })
        }
      }
    }

    if (next.length) {
      setEvents((ev) => [...ev, ...next].slice(-60))
    }
    if (Object.keys(deltas).length) {
      setLifeDeltas((prevDeltas) => ({ ...prevDeltas, ...deltas }))
    }
  }, [gameState])

  // Fade out life delta pills shortly after they appear.
  useEffect(() => {
    if (Object.keys(lifeDeltas).length === 0) return
    const t = setTimeout(() => setLifeDeltas({}), 2600)
    return () => clearTimeout(t)
  }, [lifeDeltas])

  // Reset card selection whenever a new decision arrives.
  const pendingRequestId = gameState?.pendingChoice?.requestId
  useEffect(() => {
    setSelected(new Set())
  }, [pendingRequestId])

  // Auto-skip when only mana-ability taps remain (auto-tap handles payment).
  useEffect(() => {
    if (!gameState?.pendingChoice || gameState.pendingChoice.type !== 'play') return
    const choice = gameState.pendingChoice
    const me = gameState.players?.find((p) => p.index === myIndex) ?? gameState.players?.[0]
    const opponent = gameState.players?.find((p) => p.index !== myIndex) ?? gameState.players?.[1]
    const mats = matchOptionsToCards(choice, {
      hand: me?.hand ?? [],
      battlefield: me?.battlefield ?? [],
      opponent: opponent?.battlefield ?? [],
    }, gameState.phase)
    const nonMana = mats.filter((m) => m.zone !== 'none' && !m.manaAbility)
    if (nonMana.length === 0) {
      sendChoice(choice.requestId, [])
    }
  }, [gameState?.pendingChoice, gameState?.players, gameState?.phase, myIndex])

  const sendChoice = (requestId: number, indices: number[]) => {
    const client = clientRef.current
    if (!client || !activeMatch) return
    client.publish({
      destination: `/app/match/${activeMatch.id}/action`,
      body: JSON.stringify({
        actionType: 'CHOICE',
        payload: { requestId, selectedIndices: indices },
      }),
    })
  }

  const startVsAi = async () => {
    if (!selectedDeckId) return setNotice('Please select a deck first.')
    try {
      const m = await createMatch(selectedDeckId)
      setActiveMatch(m)
      setGameState(null)
      setMatches(await listMatches())
    } catch {
      setNotice('Failed to start match.')
    }
  }

  const startLobby = async () => {
    if (!selectedDeckId) return setNotice('Please select a deck first.')
    try {
      const m = await createLobby(selectedDeckId)
      setActiveMatch(m)
      setGameState(null)
      setNotice('')
      setMatches(await listMatches())
    } catch {
      setNotice('Failed to create battle lobby.')
    }
  }

  const joinLobby = async () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return setNotice('Enter a battle code to join.')
    if (!selectedDeckId) return setNotice('Please select a deck first.')
    try {
      const m = await joinMatch(code, selectedDeckId)
      setActiveMatch(m)
      setGameState(null)
      setNotice('')
      setMatches(await listMatches())
    } catch {
      setNotice('Failed to join battle. Check the code.')
    }
  }

  const handleConcede = async () => {
    if (!activeMatch) return
    try {
      await concedeMatch(activeMatch.id)
      setActiveMatch(null)
      setGameState(null)
      setMatches(await listMatches())
    } catch {
      setNotice('Failed to concede.')
    }
  }

  const backToLobby = async () => {
    setActiveMatch(null)
    setGameState(null)
    setInfo('')
    setEvents([])
    setLifeDeltas({})
    setMatches(await listMatches())
  }

  if (activeMatch) {
    const over =
      gameState?.gameOver === true ||
      gameState?.status === 'COMPLETED' ||
      gameState?.status === 'CONCEDED'

    // Waiting for an opponent to join the lobby.
    if (gameState?.status === 'PENDING' || (gameState === null && !over)) {
      return (
        <div className="page">
          <h2>Battle Lobby</h2>
          <div className="panel" style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
              Share this code — your opponent enters it to join this battle.
            </div>
            <div
              style={{
                fontSize: 42,
                fontWeight: 800,
                letterSpacing: 8,
                fontFamily: 'monospace',
                color: 'var(--good)',
              }}
            >
              {activeMatch.battleCode ?? '—'}
            </div>
            <div style={{ color: 'var(--muted)', marginTop: 12 }}>
              Waiting for opponent to join{info ? ` — ${info}` : ''}…
            </div>
          </div>
          <div className="filters" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={backToLobby}>
              Cancel
            </button>
          </div>
        </div>
      )
    }

    // Terminal state with no live board snapshot.
    if (!Array.isArray(gameState?.players) || gameState!.players.length === 0) {
      return (
        <div className="page">
          <h2>Live Combat Board</h2>
          <div className="panel" style={{ marginBottom: 20, textAlign: 'center' }}>
            <h3>{gameState?.winnerName ?? 'Match over'}</h3>
            <div style={{ color: 'var(--muted)' }}>{gameState?.winCondition ?? gameState?.status}</div>
          </div>
          <button className="btn" onClick={backToLobby}>
            Back to Lobby
          </button>
        </div>
      )
    }

    const state = gameState!
    const me = state.players.find((p) => p.index === myIndex) ?? state.players[0]
    const opponent = state.players.find((p) => p.index !== myIndex) ?? state.players[1]
    const activePlayer = state.players[state.activePlayerIndex] ?? me
    const isMyTurn = me ? me.hasPriority : false
    const instruction = instructionFor(state, me, opponent)
    const choice = state.pendingChoice

    const matches = choice
      ? matchOptionsToCards(choice, {
          hand: me?.hand ?? [],
          battlefield: me?.battlefield ?? [],
          opponent: opponent?.battlefield ?? [],
        }, state.phase)
      : []
    const optionIndexByCard = new Map<string, number>()
    for (const m of matches) {
      for (const id of m.cardIds) {
        const key = `${m.zone}:${id}`
        if (!optionIndexByCard.has(key)) optionIndexByCard.set(key, m.optionIndex)
      }
    }
    const optionFor = (zone: MatchZone, id: number) => optionIndexByCard.get(`${zone}:${id}`)
    const zones = choice ? interactiveZones(choice) : []
    const zoneActive = (z: MatchZone) => zones.includes(z)

    const onTapCard = (zone: MatchZone, id: number) => {
      if (!choice) return
      const i = optionFor(zone, id)
      if (i === undefined) return
      if (isImmediateChoice(choice)) {
        sendChoice(choice.requestId, [i])
      } else {
        setSelected((prev) => {
          const n = new Set(prev)
          if (n.has(i)) n.delete(i)
          else n.add(i)
          return n
        })
      }
    }

    const isCardSelected = (zone: MatchZone, id: number) => {
      const i = optionFor(zone, id)
      return i !== undefined && selected.has(i)
    }

    const renderTile = (zone: MatchZone, card: { id: number; name: string; type?: string | null; cost?: string | null; power?: number; toughness?: number; tapped?: boolean; attacking?: boolean; blocking?: boolean; damage?: number; text?: string | null }) => {
      const optIdx = optionFor(zone, card.id)
      const interactive = !!choice && zoneActive(zone) && optIdx !== undefined
      const emphasis =
        zone === 'battlefield' || zone === 'opponent'
          ? card.attacking
            ? 'attack'
            : card.blocking
              ? 'block'
              : undefined
          : undefined
      return (
        <BattleCard
          key={card.id}
          card={card}
          selectable={interactive}
          selected={isCardSelected(zone, card.id)}
          disabled={!!choice && !interactive}
          emphasis={emphasis}
          showArt={showArt}
          onClick={() => onTapCard(zone, card.id)}
        />
      )
    }

    const inCombat = isInCombatPhase(state.phase)
    const allCards = [...(me?.hand ?? []), ...(me?.battlefield ?? [])]
    const textOptions = matches.filter((m) => {
      if (m.zone !== 'none') return false
      if (!inCombat && m.cardIds.length > 0) {
        const card = allCards.find((c) => m.cardIds.includes(c.id))
        if (card?.type?.toLowerCase() === 'instant') return false
      }
      return true
    })
    const hasCardOptions = matches.some((m) => m.zone !== 'none')
    const canConfirm = selected.size >= (choice?.minCount ?? 0)

    const iWon =
      state.winnerId != null ? state.winnerId === player?.id : state.winnerName === me?.name

    return (
      <div className="page">
        <div className="battle-topbar">
          <h2 style={{ marginBottom: 4 }}>Live Combat</h2>
          <div className="filters" style={{ flexWrap: 'wrap' }}>
            <span className="chip">Turn {state.turn}</span>
            <span className="chip">{friendlyPhase(state.phase)}</span>
            <span
              className="chip"
              style={{
                background: isMyTurn ? 'var(--good)' : 'var(--panel)',
                color: isMyTurn ? '#fff' : 'var(--muted)',
              }}
            >
              {isMyTurn ? 'Your priority' : `${activePlayer?.name ?? 'Opponent'}'s turn`}
            </span>
            <span
              className="chip"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const next = !showArt
                setShowArt(next)
                localStorage.setItem('cf_card_display', next ? 'art' : 'text')
              }}
            >
              {showArt ? '🖼️ Art' : '📝 Text'}
            </span>
            <span style={{ flex: 1 }} />
            {over ? (
              <button className="btn" onClick={backToLobby}>
                Back to Lobby
              </button>
            ) : (
              <button className="btn danger" onClick={handleConcede}>
                Concede
              </button>
            )}
          </div>
        </div>

        <PhaseStrip phase={state.phase} />

        {info && (
          <div className="problem good" style={{ marginBottom: 16 }}>
            {info} <span style={{ cursor: 'pointer' }} onClick={() => setInfo('')}>×</span>
          </div>
        )}

        <InstructionBanner instruction={instruction} />

        <OpponentRow opponent={opponent} lifeDelta={lifeDeltas[opponent?.index ?? 1]?.delta} />

        <div className="panel battle-zone" id="opponent-battlefield">
          <div className="battle-zone-head">
            <h3>Your Opponent's Battlefield</h3>
            <span className="chip">{opponent.battlefield.length} permanents</span>
          </div>
          {opponent.battlefield.length === 0 ? (
            <div className="empty" style={{ padding: 10 }}>
              Nothing on the battlefield yet.
            </div>
          ) : (
            <div className="battle-grid">{opponent.battlefield.map((c) => renderTile('opponent', c))}</div>
          )}
        </div>

        <div className="panel player-stats-panel">
          <HealthBar life={me?.life ?? 0} />
          <div className="player-stats-info">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="player-stats-name">{me?.name ?? 'You'}</span>
              {lifeDeltas[me?.index ?? 0] && (
                <LifePill delta={lifeDeltas[me!.index].delta} />
              )}
            </div>
            <ManaBars pool={me?.mana} />
          </div>
        </div>

        <div className="panel battle-zone">
          <div className="battle-zone-head">
            <h3>Your Battlefield</h3>
            <span className="chip">{me?.battlefield.length ?? 0} permanents</span>
          </div>
          {me && me.battlefield.length === 0 ? (
            <div className="empty" style={{ padding: 10 }}>
              Nothing on the battlefield yet.
            </div>
          ) : (
            <div className="battle-grid">{me?.battlefield.map((c) => renderTile('battlefield', c))}</div>
          )}
        </div>

        {state.stack.length > 0 && (
          <div className="stack-line">
            <span className="meta">Stack: </span>
            {state.stack.map((s, i) => (
              <span key={i} className="chip">
                {s.cardName ?? 'Ability'}
              </span>
            ))}
          </div>
        )}

        <div className="panel battle-zone">
          <div className="battle-zone-head">
            <h3>Your Hand</h3>
            <span className="chip">{me?.hand.length ?? 0} cards</span>
          </div>
          {me && me.hand.length === 0 ? (
            <div className="empty" style={{ padding: 10 }}>
              Hand empty.
            </div>
          ) : (
            <div className="battle-hand">{me?.hand.map((c) => renderTile('hand', c))}</div>
          )}
        </div>

        {choice && !over && (
          <ActionBar
            choice={choice}
            textOptions={textOptions}
            hasCardOptions={hasCardOptions}
            selected={selected}
            canConfirm={canConfirm}
            onSend={(indices) => sendChoice(choice.requestId, indices)}
          />
        )}

        <details className="panel battle-log">
          <summary>Game Log</summary>
          <div className="battle-log-body">
            {events.length === 0 ? (
              <div style={{ color: 'var(--muted)', padding: 8 }}>The match has just begun.</div>
            ) : (
              [...events].reverse().map((e) => (
                <div key={e.id} style={{ color: eventColor(e.kind) }}>
                  <span style={{ opacity: 0.55, marginRight: 8 }}>
                    {new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                  </span>
                  {e.text}
                </div>
              ))
            )}
          </div>
        </details>

        {over && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(8, 12, 20, 0.86)',
            }}
          >
            <div
              className="panel"
              style={{
                textAlign: 'center',
                maxWidth: 460,
                width: '90%',
                border: `1px solid ${iWon ? 'var(--good)' : 'var(--bad)'}`,
              }}
            >
              <h2 style={{ fontSize: 42, margin: 0, color: iWon ? 'var(--good)' : 'var(--bad)' }}>
                {iWon ? 'You Win!' : 'You Lose'}
              </h2>
              <div style={{ fontSize: 20, marginTop: 10 }}>
                {state.winnerName ?? 'Match over'}
              </div>
              <div style={{ color: 'var(--muted)', marginTop: 8 }}>
                {state.winCondition ?? state.status ?? 'Match over'}
              </div>
              <div className="filters" style={{ justifyContent: 'center', marginTop: 24, marginBottom: 4 }}>
                <button className="btn" onClick={backToLobby}>
                  Back to Lobby
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const pendingLobbies = matches.filter((m) => m.status === 'PENDING')
  const activeMatches = matches.filter((m) => m.status === 'ACTIVE')

  return (
    <div className="page">
      <h2>Battle Lobby</h2>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>Queue for a headless 1v1 combat match.</p>

      {notice && (
        <div className="problem good" style={{ marginBottom: 16 }}>
          {notice} <span style={{ cursor: 'pointer' }} onClick={() => setNotice('')}>×</span>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3>Battle Setup</h3>
        {decks.length === 0 ? (
          <div className="empty">You need a saved deck before battling. Build one in the Deck Builder!</div>
        ) : (
          <>
            <div className="filters" style={{ marginBottom: 12 }}>
              <select
                value={selectedDeckId}
                onChange={(e) => setSelectedDeckId(e.target.value)}
                style={{ minWidth: 220 }}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.formatCode})
                  </option>
                ))}
              </select>
              <button className="btn" onClick={startLobby}>
                Create Battle Lobby
              </button>
            </div>
            <div className="filters">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter battle code"
                style={{ minWidth: 180, textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'monospace' }}
                maxLength={6}
              />
              <button className="btn" onClick={joinLobby}>
                Join Battle
              </button>
            </div>
            {aiEnabled && (
              <div className="filters" style={{ marginTop: 12 }}>
                <button className="btn" onClick={startVsAi}>
                  Start AI Battle
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {pendingLobbies.length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <h3>My Open Lobbies</h3>
          {pendingLobbies.map((m) => (
            <div key={m.id} className="deck-row">
              <span className="grow">
                <span style={{ fontWeight: 700 }}>Waiting…</span>
                <span style={{ color: 'var(--good)', marginLeft: 12, fontFamily: 'monospace', letterSpacing: 2 }}>
                  Code: {m.battleCode}
                </span>
                <span style={{ color: 'var(--muted)', marginLeft: 12 }}>
                  Created: {new Date(m.createdAt).toLocaleTimeString()}
                </span>
              </span>
              <button className="btn" onClick={() => setActiveMatch(m)}>
                View
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h3>Match History</h3>
        {matches.length === 0 && <div className="empty">No matches played yet.</div>}
        {matches.map((m) => (
          <div key={m.id} className="deck-row">
            <span className="grow">
              <span style={{ fontWeight: 700 }}>Match {m.id.slice(0, 8)}…</span>
              <span style={{ color: 'var(--muted)', marginLeft: 12 }}>Status: {m.status}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 12 }}>
                Created: {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </span>
            {activeMatches.some((a) => a.id === m.id) && (
              <button
                className="btn"
                onClick={() => {
                  setActiveMatch(m)
                  setGameState(null)
                }}
              >
                Reconnect
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
