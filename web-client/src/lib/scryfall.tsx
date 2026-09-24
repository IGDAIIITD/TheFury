import { useState } from 'react'

/** Supabase Storage base for the card-art bucket, when the env var is set. */
const STORAGE_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/card-art`
  : ''

/** Returns the card-art URL for a given card name (storage first, local fallback). */
export function scryfallArtUrl(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return STORAGE_BASE ? `${STORAGE_BASE}/${slug}.jpg` : `/card-art/${slug}.jpg`
}

/**
 * Renders card art with hidden-on-error fallback. Grids of many cards keep the
 * default lazy loading; always-visible boards (battle) pass loading="eager".
 */
export function CardArt({
  name,
  className,
  loading = 'lazy',
}: {
  name: string
  className?: string
  loading?: 'lazy' | 'eager'
}) {
  const [error, setError] = useState(false)
  if (error) return null
  return (
    <img
      className={className ?? 'card-art'}
      src={scryfallArtUrl(name)}
      alt={name}
      loading={loading}
      draggable={false}
      onError={() => setError(true)}
    />
  )
}
