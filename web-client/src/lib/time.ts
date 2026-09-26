/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** Milliseconds left until `untilMs`, never negative. */
export function remainingMs(untilMs: number, now = Date.now()): number {
  return Math.max(0, untilMs - now)
}

/** 83_000 -> "1:23". */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
