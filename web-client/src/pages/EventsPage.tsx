import { useEffect, useMemo, useRef, useState } from 'react'
import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import { getActiveEvents, getFeedHistory, listEvents } from '../api/endpoints'
import type { EventDto, FeedEntryDto, FeedType } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { CACHE_KEYS, cacheGet, cacheSet } from '../lib/idb'

const TYPE_LABEL: Record<FeedType, string> = {
  DISCOVERY: 'Discovery',
  ACHIEVEMENT: 'Achievement',
  EVENT: 'Event',
  SPAWN: 'Spawn',
  TRADE: 'Trade',
}

const TYPE_ICON: Record<FeedType, string> = {
  DISCOVERY: '✦',
  ACHIEVEMENT: '🏅',
  EVENT: '📅',
  SPAWN: '🎟️',
  TRADE: '↔',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function feedKey(entry: FeedEntryDto): string {
  return `${entry.type}:${entry.createdAt}:${entry.message}`
}

function EventCard({ event }: { event: EventDto }) {
  const now = Date.now()
  const started = new Date(event.startTime).getTime() <= now
  const ended = new Date(event.endTime).getTime() < now
  const status = event.active ? 'LIVE' : ended ? 'ENDED' : started ? 'LIVE' : 'UPCOMING'
  const statusColor = status === 'LIVE' ? 'var(--good)' : status === 'ENDED' ? 'var(--muted)' : 'var(--warn)'

  return (
    <div className="panel" style={{ borderColor: status === 'LIVE' ? 'var(--good)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ margin: 0 }}>{event.name}</h3>
        <span
          className="chip active"
          style={{
            background: 'transparent',
            color: statusColor,
            border: `1px solid ${statusColor}`,
          }}
        >
          {status}
        </span>
      </div>
      <p className="meta" style={{ color: 'var(--muted)', margin: '8px 0' }}>
        {formatTime(event.startTime)} → {formatTime(event.endTime)}
      </p>
      <p className="meta" style={{ margin: '4px 0' }}>
        <strong style={{ color: 'var(--warn)' }}>×{event.bonusMultiplier} bonus</strong> · allowed sets:{' '}
        {event.allowedSets.length > 0 ? event.allowedSets.join(', ') : 'all'}
      </p>
      {status === 'LIVE' && (
        <p className="meta" style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
          Decks are locked to the allowed sets above for matches under this event.
        </p>
      )}
    </div>
  )
}

export default function EventsPage() {
  const { token } = useAuth()
  const [events, setEvents] = useState<EventDto[]>([])
  const [activeEvents, setActiveEvents] = useState<EventDto[]>([])
  const [feed, setFeed] = useState<FeedEntryDto[]>([])
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')
  const seenRef = useRef<Set<string>>(new Set())
  const feedElRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listEvents(), getActiveEvents(), getFeedHistory()])
      .then(async ([all, active, history]) => {
        if (cancelled) return
        setEvents(all)
        setActiveEvents(active)
        const merged = history.length > 0 ? history : ((await cacheGet<FeedEntryDto[]>(CACHE_KEYS.feed)) ?? [])
        merged.forEach((entry) => seenRef.current.add(feedKey(entry)))
        setFeed(merged)
        cacheSet(CACHE_KEYS.feed, merged)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load events and feed.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!token) return
    const socketUrl = `${window.location.protocol}//${window.location.host}/ws/match`
    const client = new Client({
      webSocketFactory: () => new SockJS(socketUrl),
      connectHeaders: { Authorization: `Bearer ${token}` },
      reconnectDelay: 5000,
      onConnect: () => {
        client.subscribe('/topic/feed', (msg) => {
          const entry = JSON.parse(msg.body) as FeedEntryDto
          setFeed((current) => {
            if (seenRef.current.has(feedKey(entry))) return current
            seenRef.current.add(feedKey(entry))
            const next = [entry, ...current].slice(0, 50)
            cacheSet(CACHE_KEYS.feed, next)
            return next
          })
        })
        setLive(true)
      },
      onWebSocketClose: () => setLive(false),
    })
    client.activate()
    return () => {
      client.deactivate()
    }
  }, [token])

  const [upcoming, ended] = useMemo(() => {
    const now = Date.now()
    const isActive = new Map(activeEvents.map((e) => [e.id, true]))
    return [
      events.filter((e) => !isActive.has(e.id) && new Date(e.startTime).getTime() > now),
      events.filter((e) => !isActive.has(e.id) && new Date(e.endTime).getTime() <= now),
    ]
  }, [events, activeEvents])

  const scrollToBottom = () => {
    const el = feedElRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return (
    <div className="page">
      <h2>Events</h2>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>
        Campus-wide events with set-locked decks and bonus XP. Follow the live feed for activity.
      </p>

      {activeEvents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {activeEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {activeEvents.length === 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>No live event right now</h3>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Check back soon — events appear here when they go live.
          </p>
        </div>
      )}

      <h3 style={{ margin: '24px 0 0' }}>
        Live feed{' '}
        <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
          {live ? '· connected' : '· offline (last known)'}
        </span>
      </h3>
      <div
        ref={feedElRef}
        className="panel"
        style={{ marginTop: 8, maxHeight: 420, overflowY: 'auto' }}
        onScroll={scrollToBottom}
      >
        {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
        {feed.length === 0 && !error && (
          <p style={{ color: 'var(--muted)', margin: 0 }}>No activity yet — scan cards, win battles, and trade to fill this feed.</p>
        )}
        {feed.map((entry, idx) => (
          <div key={`${feedKey(entry)}:${idx}`} style={{ padding: '6px 0', borderBottom: idx === feed.length - 1 ? 'none' : '1px solid var(--border)' }}>
            <span style={{ marginRight: 8 }}>{TYPE_ICON[entry.type]}</span>
            <span className="meta" style={{ color: 'var(--accent-2)', fontWeight: 600 }}>
              {TYPE_LABEL[entry.type]}
            </span>
            <span className="meta" style={{ color: 'var(--muted)' }}>
              {entry.playerName ? `${entry.playerName} ` : ''}— {entry.message}
            </span>
            <span className="meta" style={{ float: 'right', color: 'var(--muted)', fontSize: 11 }}>
              {formatTime(entry.createdAt)}
            </span>
          </div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 0' }}>Upcoming</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {upcoming.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </>
      )}

      {ended.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 0' }}>Past events</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {ended.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
