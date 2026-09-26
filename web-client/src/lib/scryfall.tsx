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
 * Renders card art (lazy-loaded) with a hidden-on-error fallback.
 */
export function CardArt({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const [error, setError] = useState(false)
  if (error) return null
  return (
    <img
      className={className ?? 'card-art'}
      src={scryfallArtUrl(name)}
      alt={name}
      loading="lazy"
      draggable={false}
      onError={() => setError(true)}
    />
  )
}
