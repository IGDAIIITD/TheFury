import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Client } from '@stomp/stompjs'
import {
  createMatch,
  createLobby,
  joinMatch,
  getBattleFeatures,
  concedeMatch,
  getMatchState,
  getMatch,
  cancelLobby,
} from '../api/battleEndpoints'
import { battleWsUrl, battleToken } from '../api/battleConfig'
import { getMyMatchHistory, listDecks, type MatchHistoryDto, type MatchResult } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import { LOBBY_TTL_MS, type CardEntry, type MatchDto, type MatchState, type PendingChoice, type MatchPlayerState } from '../api/battleTypes'
import { formatCountdown, remainingMs, timeAgo } from '../lib/time'
import type { DeckDto } from '../api/types'
import BattleCard from '../components/BattleCard'
import { scryfallArtUrl } from '../lib/scryfall'
import { mockMatch, mockState } from './battleFixture'
import {
  friendlyPhase,
  phaseStrip,
  instructionFor,
  matchOptionsToCards,
  interactiveZones,
  isImmediateChoice,
  primaryActionLabel,
  isInCombatPhase,
  isAutoPass,
  availableMana,
  healthSegments,
  MANA_COLORS,
  MANA_NAMES,
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

const isLand = (card: CardEntry) => /\bland\b/i.test(card.type ?? '')

/** A battlefield: lands in a compact row under the other permanents. */
function Battlefield({ cards, render }: { cards: CardEntry[]; render: (c: CardEntry) => React.ReactNode }) {
  const lands = cards.filter(isLand)
  const others = cards.filter((c) => !isLand(c))
  return (
    <>
      {others.length > 0 && <div className="battle-grid">{others.map(render)}</div>}
      {lands.length > 0 && <div className="battle-lands">{lands.map(render)}</div>}
    </>
  )
}

/** Horizontal life bar: one solid segment per life point out of 20. */
export function HealthBar({ life }: { life: number }) {
  const { filled, total, overflow } = healthSegments(life)
  const tone = filled <= 5 ? 'critical' : filled <= 10 ? 'hurt' : 'healthy'
  return (
    <div className={`health-bar ${tone}`} role="meter" aria-label="Life" aria-valuenow={life} aria-valuemin={0} aria-valuemax={total}>
      <div className="health-bar-segments">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`health-seg${i < filled ? ' on' : ''}`} />
        ))}
      </div>
      <span className="health-bar-number">
        {life}
        {overflow > 0 && <small> (+{overflow})</small>}
      </span>
    </div>
  )
}

/** Mana you can spend right now, per color: untapped sources + floating mana. */
export function ManaPanel({
  battlefield,
  pool,
}: {
  battlefield: MatchPlayerState['battlefield'] | undefined
  pool: Record<string, number> | null | undefined
}) {
  const mana = availableMana(battlefield, pool)
  return (
    <div className="mana-panel" aria-label={`Mana available: ${mana.total}`}>
      {MANA_COLORS.map((c) => (
        <span
          key={c}
          className={`mana-orb mana-${c}${mana.byColor[c] === 0 ? ' empty' : ''}`}
          title={`${MANA_NAMES[c]}: ${mana.byColor[c]}`}
          aria-label={`${MANA_NAMES[c]} ${mana.byColor[c]}`}
        >
          <span className="mana-orb-letter" aria-hidden>{c}</span>
          <span className="mana-orb-count">{mana.byColor[c]}</span>
        </span>
      ))}
      <span className="mana-total">
        {mana.total} mana
        {mana.floating > 0 && <em> · {mana.floating} floating</em>}
      </span>
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

/** Name, life bar and available mana for one player (opponent on top, you below). */
function PlayerStrip({
  player,
  lifeDelta,
  mine,
}: {
  player: MatchPlayerState
  lifeDelta?: number
  mine?: boolean
}) {
  return (
    <div className={`panel player-strip${mine ? ' mine' : ''}`}>
      <div className="player-strip-head">
        <span className="player-strip-name">{mine ? `${player.name} (you)` : player.name}</span>
        {lifeDelta !== undefined && <LifePill delta={lifeDelta} />}
        <span className="player-strip-meta">
          {mine ? '' : `Hand ${player.handSize} · `}Library {player.librarySize} · Graveyard {player.graveyard?.length ?? 0}
        </span>
      </div>
      <HealthBar life={player.life} />
      <ManaPanel battlefield={player.battlefield} pool={player.mana} />
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

/** The engine's error body is { code, message }; surface its message when present. */
function engineMessage(err: unknown): string | null {
  const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : null
}

/** The match this tab is in, so a reload can reconnect to it. */
const ACTIVE_MATCH_KEY = 'cf_active_match'
/** Coalesce bursts of engine snapshots (auto-passed steps) into one render per window. */
const STATE_THROTTLE_MS = 150

const RESULT_LABEL: Record<MatchResult, string> = {
  WON: 'Won',
  LOST: 'Lost',
  DRAW: 'Draw',
  ACTIVE: 'In progress',
  WAITING: 'Waiting',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
}

function xpLabel(h: MatchHistoryDto): string {
  if (h.xp > 0) return `+${h.xp} XP`
  return h.result === 'WON' || h.result === 'LOST' || h.result === 'DRAW' ? '+0 XP' : '—'
}

const forgetActiveMatch = () => {
  try {
    localStorage.removeItem(ACTIVE_MATCH_KEY)
  } catch {
    // storage unavailable
  }
}

/** Dev only: /battle?mock renders a canned board (no engine); stripped from production builds. */
const MOCK = import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock')

export default function BattlePage() {
  const { player } = useAuth()
  const [history, setHistory] = useState<MatchHistoryDto[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const joinButtonRef = useRef<HTMLButtonElement | null>(null)
  const [resuming, setResuming] = useState(() => !MOCK && !!localStorage.getItem(ACTIVE_MATCH_KEY))
  const [now, setNow] = useState(() => Date.now())
  const [lobbyClosed, setLobbyClosed] = useState(false)
  const pendingStateRef = useRef<MatchState | null>(null)
  const throttleTimer = useRef<number | null>(null)
  const autoPassedRef = useRef<number | null>(null)
  const [decks, setDecks] = useState<DeckDto[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeMatch, setActiveMatch] = useState<MatchDto | null>(MOCK ? mockMatch() : null)
  const [gameState, setGameState] = useState<MatchState | null>(MOCK ? mockState() : null)
  const [info, setInfo] = useState('')
  const [notice, setNotice] = useState('')
  const [aiEnabled, setAiEnabled] = useState(false)
  const clientRef = useRef<Client | null>(null)

  const [events, setEvents] = useState<GameEvent[]>([])
  const [lifeDeltas, setLifeDeltas] = useState<Record<number, { delta: number }>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showArt, setShowArt] = useState(() => localStorage.getItem('cf_card_display') !== 'text')
  const [inspecting, setInspecting] = useState<string | null>(null)
  const eventSeq = useRef(0)
  const prevStateRef = useRef<MatchState | null>(null)
  const resumingRef = useRef(false)

  const refreshHistory = useCallback(() => {
    getMyMatchHistory()
      .then(setHistory)
      .catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([listDecks(), getBattleFeatures()])
      .then(([dList, feats]) => {
        setDecks(dList)
        setAiEnabled(feats.aiBattlesEnabled)
        if (dList.length > 0) setSelectedDeckId(dList[0].id)
      })
      .catch(() => setNotice('Failed to load battle data.'))
    refreshHistory()
  }, [refreshHistory])

  // /battle?join=CODE (from the open-battles feed): prefill the code; the player picks a deck and joins.
  useEffect(() => {
    const code = searchParams.get('join')
    if (!code) return
    setJoinCode(code.toUpperCase().slice(0, 6))
    setNotice(`Joining battle ${code.toUpperCase()}: pick your deck, then press Join Battle.`)
    setSearchParams({}, { replace: true })
    window.setTimeout(() => joinButtonRef.current?.focus(), 0)
  }, [searchParams, setSearchParams])

  // After a reload, go straight back into the match this tab was playing.
  useEffect(() => {
    if (MOCK) return
    const id = localStorage.getItem(ACTIVE_MATCH_KEY)
    if (!id) return
    getMatch(id)
      .then((m) => {
        if (m.status === 'ACTIVE' || m.status === 'PENDING') setActiveMatch(m)
        else forgetActiveMatch()
      })
      .catch(() => {
        // engine unreachable: keep the key and offer Rejoin from the history
      })
      .finally(() => setResuming(false))
  }, [])

  useEffect(() => {
    if (activeMatch && !MOCK) {
      try {
        localStorage.setItem(ACTIVE_MATCH_KEY, activeMatch.id)
      } catch {
        // storage unavailable: reload just returns to the lobby
      }
    }
  }, [activeMatch])

  /**
   * Engine auto-passes produce bursts of snapshots a few ms apart; rendering each one made
   * the board flicker. The first snapshot renders at once, the rest of a burst collapse
   * into the newest one per STATE_THROTTLE_MS. Game over always renders immediately.
   */
  const applyState = useCallback((next: MatchState) => {
    if (next.gameOver) {
      if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current)
      throttleTimer.current = null
      pendingStateRef.current = null
      setGameState(next)
      return
    }
    if (throttleTimer.current === null) {
      setGameState(next)
      const flush = () => {
        const queued = pendingStateRef.current
        pendingStateRef.current = null
        if (queued) {
          setGameState(queued)
          throttleTimer.current = window.setTimeout(flush, STATE_THROTTLE_MS)
        } else {
          throttleTimer.current = null
        }
      }
      throttleTimer.current = window.setTimeout(flush, STATE_THROTTLE_MS)
    } else {
      pendingStateRef.current = next
    }
  }, [])

  useEffect(
    () => () => {
      if (throttleTimer.current !== null) window.clearTimeout(throttleTimer.current)
    },
    [],
  )

  const myIndex = (() => {
    if (!activeMatch || !player || MOCK) return 0
    return activeMatch.player1Id === player.id ? 0 : 1
  })()

  // WebSocket connection + catch-up fetch for reconnect
  useEffect(() => {
    if (!activeMatch || !player || MOCK) return

    let cancelled = false
    let stompClient: Client | null = null

    getMatchState(activeMatch.id)
      .then(applyState)
      .catch(() => {})

    battleToken().then((wsToken) => {
      if (cancelled) return
      if (!wsToken) return

      const client = new Client({
        // native WebSocket (ws:// or wss://); the engine's plain STOMP endpoint
        brokerURL: battleWsUrl(),
        connectHeaders: { Authorization: `Bearer ${wsToken}` },
        reconnectDelay: 5000,
        onConnect: () => {
          client.subscribe(`/topic/match/${activeMatch.id}/p${myIndex}`, (msg) => {
            const parsed = JSON.parse(msg.body)
            if (parsed.type === 'info') {
              setInfo(parsed.message as string)
              return
            }
            applyState(parsed)
            if (parsed.gameOver) {
              forgetActiveMatch()
              refreshHistory()
            }
          })
          // Subscribing is what the engine treats as "back": re-sync the board and any
          // decision that was requested while this tab was away.
          getMatchState(activeMatch.id)
            .then(applyState)
            .catch(() => {})
        },
      })
      stompClient = client
      clientRef.current = client
      client.activate()
    })

    return () => {
      cancelled = true
      stompClient?.deactivate()
      clientRef.current = null
    }
  }, [activeMatch, player, myIndex, applyState, refreshHistory])

  // Reconnect-on-resume: a backgrounded/suspended tab can silently kill the
  // socket and pause JS timers, so on return we immediately re-establish the
  // connection and re-sync the board from REST instead of waiting on the
  // STOMP reconnectDelay (which only ticks while the page is alive).
  useEffect(() => {
    if (!activeMatch || MOCK) return

    const resume = () => {
      if (resumingRef.current) return
      resumingRef.current = true
      const client = clientRef.current
      if (client && !client.connected && !client.active) {
        client.activate()
      }
      getMatchState(activeMatch.id)
        .then(applyState)
        .catch(() => {})
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
  }, [activeMatch, applyState])

  // While waiting for an opponent to join a lobby, poll for the game starting.
  useEffect(() => {
    if (!activeMatch || activeMatch.status !== 'PENDING' || lobbyClosed || MOCK) return
    const id = setInterval(async () => {
      try {
        const s = await getMatchState(activeMatch.id)
        if (s.status === 'EXPIRED' || s.status === 'CANCELLED') {
          setLobbyClosed(true)
          forgetActiveMatch()
        } else if (Array.isArray(s.players) && s.players.length > 0 && !s.gameOver) {
          applyState(s)
        }
      } catch {
        // lobby not running yet
      }
    }, 3000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(id)
      clearInterval(tick)
    }
  }, [activeMatch, lobbyClosed, applyState])

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
    if (isAutoPass(choice, mats) && autoPassedRef.current !== choice.requestId) {
      autoPassedRef.current = choice.requestId
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

  // One lobby request at a time: starting/joining a game takes a moment on the
  // engine (deck conversion + Forge start), and a second click used to send a
  // duplicate request (e.g. a join that then failed with 409).
  const lobbyAction = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setNotice(engineMessage(err) ?? fallback)
    } finally {
      setBusy(false)
    }
  }

  const startVsAi = () => {
    if (!selectedDeckId) return setNotice('Please select a deck first.')
    return lobbyAction(async () => {
      const m = await createMatch(selectedDeckId)
      setActiveMatch(m)
      setGameState(null)
      refreshHistory()
    }, 'Failed to start match.')
  }

  const startLobby = () => {
    if (!selectedDeckId) return setNotice('Please select a deck first.')
    return lobbyAction(async () => {
      const m = await createLobby(selectedDeckId)
      setActiveMatch(m)
      setGameState(null)
      setNotice('')
      refreshHistory()
    }, 'Failed to create battle lobby.')
  }

  const joinLobby = () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return setNotice('Enter a battle code to join.')
    if (!selectedDeckId) return setNotice('Please select a deck first.')
    return lobbyAction(async () => {
      const m = await joinMatch(code, selectedDeckId)
      setActiveMatch(m)
      setGameState(null)
      setJoinCode('')
      setNotice('')
      refreshHistory()
    }, 'Failed to join battle. Check the code.')
  }

  const handleConcede = () => {
    if (!activeMatch) return
    return lobbyAction(async () => {
      await concedeMatch(activeMatch.id)
      forgetActiveMatch()
      setActiveMatch(null)
      setGameState(null)
      refreshHistory()
    }, 'Failed to concede.')
  }

  const backToLobby = () => {
    forgetActiveMatch()
    setActiveMatch(null)
    setGameState(null)
    setLobbyClosed(false)
    setInfo('')
    setEvents([])
    setLifeDeltas({})
    refreshHistory()
  }

  /** Host leaves the waiting room: the lobby closes and leaves the open-battles feed. */
  const closeLobby = () => {
    if (!activeMatch) return
    const id = activeMatch.id
    return lobbyAction(async () => {
      await cancelLobby(id)
      backToLobby()
    }, 'Could not close the lobby.')
  }

  const rejoin = (matchId: string) =>
    lobbyAction(async () => {
      const m = await getMatch(matchId)
      if (m.status !== 'ACTIVE' && m.status !== 'PENDING') {
        refreshHistory()
        throw new Error('That battle has ended.')
      }
      setGameState(null)
      setLobbyClosed(false)
      setActiveMatch(m)
    }, 'Could not rejoin that battle.')

  if (activeMatch) {
    const over =
      gameState?.gameOver === true ||
      gameState?.status === 'COMPLETED' ||
      gameState?.status === 'CONCEDED'

    const lobbyExpiresAt = Date.parse(activeMatch.createdAt) + LOBBY_TTL_MS
    const lobbyLeft = Number.isNaN(lobbyExpiresAt) ? null : remainingMs(lobbyExpiresAt, now)
    const lobbyGone =
      lobbyClosed ||
      gameState?.status === 'EXPIRED' ||
      gameState?.status === 'CANCELLED' ||
      (activeMatch.status === 'PENDING' && lobbyLeft === 0 && !gameState?.players?.length)

    if (lobbyGone) {
      return (
        <div className="page">
          <h2>Battle Lobby</h2>
          <div className="panel" style={{ textAlign: 'center', marginBottom: 20 }}>
            <h3>Lobby closed</h3>
            <div className="meta">Nobody joined within 2 minutes. Create a new lobby to try again.</div>
          </div>
          <div className="filters" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={backToLobby}>
              Back to Lobby
            </button>
          </div>
        </div>
      )
    }

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
            {lobbyLeft !== null && activeMatch.status === 'PENDING' && (
              <div className="lobby-countdown" aria-live="polite">
                Closes in <strong>{formatCountdown(lobbyLeft)}</strong>
              </div>
            )}
          </div>
          <div className="filters" style={{ justifyContent: 'center' }}>
            <button className="btn ghost" onClick={closeLobby} disabled={busy}>
              Close lobby
            </button>
          </div>
        </div>
      )
    }

    // Terminal state with no live board snapshot.
    if (!Array.isArray(gameState?.players) || gameState!.players.length === 0) {
      const lost = gameState?.status === 'ACTIVE' && !gameState.gameOver
      return (
        <div className="page">
          <h2>Live Combat Board</h2>
          <div className="panel" style={{ marginBottom: 20, textAlign: 'center' }}>
            <h3>{lost ? 'This battle is no longer running' : gameState?.winnerName ?? 'Match over'}</h3>
            <div style={{ color: 'var(--muted)' }}>
              {lost
                ? 'The battle server restarted and live matches were lost. Start a new battle.'
                : gameState?.winCondition ?? gameState?.status}
            </div>
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
    const pendingChoice = state.pendingChoice
    const allMatches = pendingChoice
      ? matchOptionsToCards(pendingChoice, {
          hand: me?.hand ?? [],
          battlefield: me?.battlefield ?? [],
          opponent: opponent?.battlefield ?? [],
        }, state.phase)
      : []
    // Decisions the client passes on its own are shown as "waiting", not as a prompt.
    const autoPass = isAutoPass(pendingChoice, allMatches)
    const choice = autoPass ? null : pendingChoice
    const matches = autoPass ? [] : allMatches
    const isMyTurn = !!choice
    const instruction = autoPass
      ? instructionFor({ ...state, pendingChoice: null }, me && { ...me, hasPriority: false }, opponent)
      : instructionFor(state, me, opponent)
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
          small={zone !== 'hand' && isLand(card)}
          onClick={() => onTapCard(zone, card.id)}
          onInspect={() => setInspecting(card.name)}
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
              {isMyTurn ? 'Your move' : `${activePlayer?.name ?? 'Opponent'}'s turn`}
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
              <button className="btn danger" onClick={handleConcede} disabled={busy}>
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

        <PlayerStrip player={opponent} lifeDelta={lifeDeltas[opponent?.index ?? 1]?.delta} />

        <div className="panel battle-zone" id="opponent-battlefield">
          <div className="battle-zone-head">
            <h3>Opponent's Battlefield</h3>
            <span className="chip">{opponent.battlefield.length} permanents</span>
          </div>
          {opponent.battlefield.length === 0 ? (
            <div className="empty" style={{ padding: 10 }}>
              Nothing on the battlefield yet.
            </div>
          ) : (
            <Battlefield cards={opponent.battlefield} render={(c) => renderTile('opponent', c)} />
          )}
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
            <Battlefield cards={me?.battlefield ?? []} render={(c) => renderTile('battlefield', c)} />
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

        {me && <PlayerStrip player={me} lifeDelta={lifeDeltas[me.index]?.delta} mine />}

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
            <div className="battle-hand" aria-label="Your hand">{me?.hand.map((c) => renderTile('hand', c))}</div>
          )}
        </div>

        {!over &&
          (choice ? (
            <ActionBar
              choice={choice}
              textOptions={textOptions}
              hasCardOptions={hasCardOptions}
              selected={selected}
              canConfirm={canConfirm}
              onSend={(indices) => sendChoice(choice.requestId, indices)}
            />
          ) : (
            <div className="battle-actionbar idle" aria-live="polite">
              Waiting for {opponent?.name ?? 'your opponent'}…
            </div>
          ))}

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

        {inspecting && (
          <div className="card-inspect" onClick={() => setInspecting(null)} role="dialog" aria-label={inspecting}>
            <img src={scryfallArtUrl(inspecting)} alt={inspecting} />
            <span className="card-inspect-hint">Tap anywhere to close</span>
          </div>
        )}

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

  const openMine = history.filter((h) => h.result === 'ACTIVE' || h.result === 'WAITING')

  return (
    <div className="page">
      <h2>Battle</h2>

      {notice && (
        <div className="problem good" style={{ marginBottom: 16 }}>
          {notice} <span style={{ cursor: 'pointer' }} onClick={() => setNotice('')}>×</span>
        </div>
      )}

      {resuming && <div className="panel resume-banner">Reconnecting to your battle…</div>}
      {!resuming &&
        openMine.map((h) => (
          <div key={h.matchId} className="panel resume-banner">
            <span className="grow">{h.result === 'ACTIVE' ? 'You have a battle in progress.' : 'Your lobby is still open.'}</span>
            <button className="btn" onClick={() => rejoin(h.matchId)} disabled={busy}>
              Rejoin
            </button>
          </div>
        ))}

      <div className="panel battle-setup">
        <div className="battle-setup-head">
          <h3>Battle Setup</h3>
          {decks.length > 0 && (
            <select
              className="deck-select"
              aria-label="Deck"
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.formatCode})
                </option>
              ))}
            </select>
          )}
        </div>
        {decks.length === 0 ? (
          <div className="empty">You need a saved deck before battling. Build one in the Deck Builder!</div>
        ) : (
          <>
            <div className="battle-join-row">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Battle code"
                aria-label="Battle code"
                maxLength={6}
              />
              <button ref={joinButtonRef} className="btn" onClick={joinLobby} disabled={busy}>
                Join Battle
              </button>
            </div>
            <div className="battle-or">
              <span>or</span>
            </div>
            <button className="btn battle-create" onClick={startLobby} disabled={busy}>
              Create Battle Lobby
            </button>
            {aiEnabled && (
              <button className="btn ghost battle-create" onClick={startVsAi} disabled={busy}>
                Practice vs Campus Bot
              </button>
            )}
            <p className="meta battle-setup-note">
              A new lobby shows up on the Events page, where anyone can join it with one tap. It closes after 2
              minutes if nobody does.
            </p>
          </>
        )}
      </div>

      <div className="panel">
        <h3>Match History</h3>
        {history.length === 0 ? (
          <div className="empty">No matches played yet.</div>
        ) : (
          <div className="history-list">
            {history.map((h) => (
              <div key={h.matchId} className="history-row">
                <span className={`result-badge ${h.result.toLowerCase()}`}>{RESULT_LABEL[h.result] ?? h.result}</span>
                <span className="history-xp">{xpLabel(h)}</span>
                <span className="history-time">{timeAgo(h.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
