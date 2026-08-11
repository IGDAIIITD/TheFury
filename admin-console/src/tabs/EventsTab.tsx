import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { CreateEventInput, EventDto } from '../types'

interface EventForm {
  name: string
  allowedSets: string
  bonusMultiplier: string
  startTime: string
  endTime: string
}

const EMPTY: EventForm = {
  name: '',
  allowedSets: '',
  bonusMultiplier: '2',
  startTime: '',
  endTime: '',
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromInput(value: string): string {
  return value.length === 16 ? `${value}:00` : value
}

function statusOf(event: EventDto): 'LIVE' | 'UPCOMING' | 'ENDED' {
  const now = Date.now()
  if (new Date(event.endTime).getTime() < now) return 'ENDED'
  if (new Date(event.startTime).getTime() <= now) return 'LIVE'
  return 'UPCOMING'
}

export default function EventsTab() {
  const [events, setEvents] = useState<EventDto[]>([])
  const [form, setForm] = useState<EventForm>(EMPTY)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<EventDto | null>(null)
  const [editForm, setEditForm] = useState<EventForm>(EMPTY)

  const load = useCallback(() => {
    api
      .get<EventDto[]>('/admin/events')
      .then(setEvents)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load events'))
  }, [])

  useEffect(load, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const payload: CreateEventInput = {
      name: form.name.trim(),
      allowedSets: form.allowedSets
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      bonusMultiplier: Number(form.bonusMultiplier) || 1,
      startTime: fromInput(form.startTime),
      endTime: fromInput(form.endTime),
    }
    try {
      await api.post<EventDto>('/admin/events', payload)
      setForm(EMPTY)
      setNotice(`Event "${payload.name}" created.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (event: EventDto) => {
    setEditing(event)
    setEditForm({
      name: event.name,
      allowedSets: event.allowedSets.join(', '),
      bonusMultiplier: String(event.bonusMultiplier),
      startTime: toLocalInput(event.startTime),
      endTime: toLocalInput(event.endTime),
    })
  }

  const saveEdit = async (event: EventDto) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.put<EventDto>(`/admin/events/${event.id}`, {
        name: editForm.name.trim(),
        allowedSets: editForm.allowedSets
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        bonusMultiplier: Number(editForm.bonusMultiplier) || 1,
        startTime: fromInput(editForm.startTime),
        endTime: fromInput(editForm.endTime),
      })
      setEditing(null)
      setNotice('Event updated.')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (event: EventDto) => {
    if (!window.confirm(`Delete event "${event.name}"?`)) return
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/events/${event.id}`)
      setNotice('Event deleted.')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const field = (key: keyof EventForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  })

  const editField = (key: keyof EventForm) => ({
    value: editForm[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditForm((f) => ({ ...f, [key]: e.target.value })),
  })

  return (
    <div>
      <h2>Events</h2>
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="meta" style={{ color: 'var(--good)' }}>{notice}</p>}

      <form className="panel" onSubmit={create}>
        <h3>Create event</h3>
        <div className="form-grid">
          <div className="field span-2">
            <label>Name</label>
            <input required placeholder="e.g. Race Week" {...field('name')} />
          </div>
          <div className="field">
            <label>Allowed sets (comma-separated, empty = all)</label>
            <input placeholder="RACE, UNLIMITED" {...field('allowedSets')} />
          </div>
          <div className="field">
            <label>Bonus multiplier</label>
            <input type="number" step="0.1" min="1" {...field('bonusMultiplier')} />
          </div>
          <div className="field">
            <label>Starts</label>
            <input type="datetime-local" required {...field('startTime')} />
          </div>
          <div className="field">
            <label>Ends</label>
            <input type="datetime-local" required {...field('endTime')} />
          </div>
        </div>
        <button className="btn" disabled={busy} type="submit">
          Create event
        </button>
      </form>

      <div className="panel">
        <h3>All events</h3>
        {events.length === 0 && <p className="empty">No events yet.</p>}
        {events.map((event) => {
          const status = statusOf(event)
          const badgeClass = status === 'LIVE' ? 'good' : status === 'UPCOMING' ? 'warn' : 'meta'
          const isEditing = editing?.id === event.id
          return (
            <div className="row" key={event.id}>
              {isEditing ? (
                <>
                  <div className="field grow">
                    <input {...editField('name')} />
                  </div>
                  <div className="field grow">
                    <input placeholder="Sets" {...editField('allowedSets')} />
                  </div>
                  <div className="field" style={{ width: 90 }}>
                    <input type="number" step="0.1" min="1" {...editField('bonusMultiplier')} />
                  </div>
                  <div className="field">
                    <input type="datetime-local" {...editField('startTime')} />
                  </div>
                  <div className="field">
                    <input type="datetime-local" {...editField('endTime')} />
                  </div>
                  <button className="btn small" disabled={busy} onClick={() => saveEdit(event)}>
                    Save
                  </button>
                  <button className="btn small ghost" disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="grow">
                    <strong>{event.name}</strong>{' '}
                    <span className={`badge ${badgeClass}`}>{status}</span>
                    <div className="meta">
                      ×{event.bonusMultiplier} bonus · sets: {event.allowedSets.length ? event.allowedSets.join(', ') : 'all'}{' '}
                      · {new Date(event.startTime).toLocaleString()} → {new Date(event.endTime).toLocaleString()}
                    </div>
                  </div>
                  <button className="btn small ghost" onClick={() => startEdit(event)}>
                    Edit
                  </button>
                  <button className="btn small danger" onClick={() => remove(event)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
