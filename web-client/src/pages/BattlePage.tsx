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

interface GameEvent {
  id: number
  text: string
  kind: 'life' | 'zone' | 'phase' | 'turn' | 'system'
}

const PHASE_LABELS: Record<string, string> = {
  UNTAP: 'Untap',
  UPKEEP: 'Upkeep',
  DRAW: 'Draw',
  MAIN1: 'Main 1',
  COMBAT_BEGIN: 'Beginning of Combat',
  COMBAT_ATTACKERS_DECLARE_ATTACKERS: 'Declare Attackers',
  COMBAT_BLOCKERS_DECLARE_BLOCKERS: 'Declare Blockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'First-Strike Damage',
  COMBAT_DAMAGE: 'Combat Damage',
  COMBAT_END: 'End of Combat',
  MAIN2: 'Main 2',
  END: 'End Step',
  CLEANUP: 'Cleanup',
}

const friendlyPhase = (p: string | null | undefined) =>
  p ? (PHASE_LABELS[p] ?? p.replace(/_/g, ' ')) : '—'

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
    const activePlayer = state.players[state.activePlayerIndex]
    const isMyTurn = me ? me.hasPriority : false
    const iWon =
      state.winnerId != null ? state.winnerId === player?.id : state.winnerName === me?.name

    return (
      <div className="page">
        <h2>Live Combat Board</h2>
        <div className="filters">
          <span className="chip active">Match: {activeMatch.id.slice(0, 8)}…</span>
          <span className="chip">Turn {state.turn}</span>
          <span className="chip">Phase: {friendlyPhase(state.phase)}</span>
          <span className="chip" style={{ background: isMyTurn ? 'var(--good)' : 'var(--panel)', color: '#fff' }}>
            {isMyTurn ? 'Your Priority' : `${activePlayer?.name ?? 'Opponent'}'s Turn`}
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

        {info && (
          <div className="problem good" style={{ marginBottom: 16 }}>
            {info} <span style={{ cursor: 'pointer' }} onClick={() => setInfo('')}>×</span>
          </div>
        )}

        <PlayerPanel
          playerState={opponent}
          lifeDelta={lifeDeltas[opponent?.index ?? 1]?.delta}
          align="opponent"
        />

        <div className="panel" style={{ marginBottom: 20, textAlign: 'center' }}>
          <h3>Stack</h3>
          {state.stack.length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: 12 }}>Stack is empty.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
              {state.stack.map((item, i) => (
                <div key={i} className="card-tile" style={{ textAlign: 'left', borderColor: 'var(--accent)', cursor: 'default' }}>
                  <div className="name">{item.cardName ?? 'Ability'}</div>
                  <div className="meta">Stack Item</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <PlayerPanel
          playerState={me}
          lifeDelta={lifeDeltas[me?.index ?? 0]?.delta}
          align="you"
          revealHand
        />

        <div className="panel" style={{ marginBottom: 20 }}>
          <h3>Game Log</h3>
          <div
            style={{
              maxHeight: 180,
              overflowY: 'auto',
              fontSize: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingRight: 6,
            }}
          >
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
        </div>

        {state.pendingChoice && !over && (
          <ChoicePanel choice={state.pendingChoice} onSend={sendChoice} />
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

function PlayerPanel({
  playerState,
  lifeDelta,
  align,
  revealHand = false,
}: {
  playerState: MatchPlayerState | undefined
  lifeDelta?: number
  align: 'you' | 'opponent'
  revealHand?: boolean
}) {
  const name = playerState?.name ?? (align === 'you' ? 'You' : 'Opponent')
  const life = playerState?.life ?? 0
  const accent = align === 'you' ? 'rgba(61,220,151,0.08)' : 'rgba(255,93,115,0.08)'

  return (
    <div className="panel" style={{ marginBottom: 20, textAlign: 'center', background: accent }}>
      <h3>{name}</h3>
      <div style={{ fontSize: 36, fontWeight: 800, color: align === 'you' ? 'var(--good)' : 'var(--bad)' }}>
        ❤️ {life} HP
        {lifeDelta !== undefined && <LifePill delta={lifeDelta} />}
      </div>
      <div style={{ color: 'var(--muted)', marginTop: 6 }}>
        Hand: {playerState?.handSize ?? 0} · Library: {playerState?.librarySize ?? 0} · Graveyard:{' '}
        {playerState?.graveyard?.length ?? 0}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, textAlign: 'left' }}>Battlefield:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {(playerState?.battlefield ?? []).map((card) => (
            <BattleCard key={card.id} card={card} />
          ))}
          {(playerState?.battlefield ?? []).length === 0 && (
            <div className="empty" style={{ padding: 10 }}>
              Battlefield empty
            </div>
          )}
        </div>
      </div>

      {revealHand && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, textAlign: 'left' }}>
            Hand ({playerState?.handSize ?? 0}):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {(playerState?.hand ?? []).map((card) => (
              <BattleCard key={card.id} card={card} />
            ))}
            {(playerState?.hand ?? []).length === 0 && (
              <div className="empty" style={{ padding: 10 }}>
                Hand empty
              </div>
            )}
          </div>
        </div>
      )}

      {playerState && (playerState.graveyard?.length ?? 0) > 0 && (
        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Graveyard:</div>
          <div
            style={{
              maxHeight: 90,
              overflowY: 'auto',
              fontSize: 12,
              color: 'var(--muted)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            {playerState.graveyard.map((c) => (
              <span key={c.id} className="chip" style={{ fontSize: 11 }}>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ChoicePanel({
  choice,
  onSend,
}: {
  choice: PendingChoice
  onSend: (requestId: number, indices: number[]) => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const isSingle = choice.maxCount === 1

  useEffect(() => {
    setSelected(new Set())
  }, [choice.requestId])

  const toggle = (i: number) => {
    if (isSingle) {
      setSelected(new Set([i]))
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) {
        next.delete(i)
      } else {
        next.add(i)
      }
      return next
    })
  }

  const submit = () => onSend(choice.requestId, Array.from(selected).sort((a, b) => a - b))
  const canSubmit = selected.size >= choice.minCount

  return (
    <div className="panel" style={{ marginTop: 20, border: '1px solid var(--accent)' }}>
      <h3 style={{ color: 'var(--accent)' }}>Your Decision</h3>
      <div style={{ color: 'var(--muted)', marginBottom: 12 }}>{choice.prompt}</div>
      {isSingle ? (
        <div className="filters" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {choice.options.map((opt, i) => (
            <button key={i} className="btn" onClick={() => onSend(choice.requestId, [i])}>
              {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 8,
              maxHeight: 260,
              overflowY: 'auto',
              marginBottom: 12,
            }}
          >
            {choice.options.map((opt, i) => {
              const active = selected.has(i)
              return (
                <span
                  key={i}
                  className={active ? 'chip active' : 'chip'}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggle(i)}
                >
                  {active ? '✓ ' : ''}
                  {opt.label}
                </span>
              )
            })}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>
            {choice.minCount === 0
              ? 'You may select zero or more, then confirm.'
              : `Select at least ${choice.minCount}.`}
          </div>
          <div className="filters" style={{ justifyContent: 'center' }}>
            <button className="btn" disabled={!canSubmit} onClick={submit}>
              Confirm ({selected.size}/{choice.maxCount})
            </button>
            {choice.cancellable && (
              <button className="btn" onClick={() => onSend(choice.requestId, [])}>
                Skip
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
