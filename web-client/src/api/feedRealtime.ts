import { toFeedEntry } from './endpoints'
import { supabase } from './supabaseClient'
import type { FeedEntryDto } from './types'

interface FeedRow {
  type: string
  text: string
  player_name: string | null
  created_at: string
}

/**
 * Subscribe to new rows in `activity_feed` via Supabase Realtime.
 * Returns an unsubscribe function.
 */
export function subscribeToFeed(
  onEntry: (entry: FeedEntryDto) => void,
  onStatus?: (live: boolean) => void,
): () => void {
  const channel = supabase
    .channel('activity_feed')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_feed' },
      (payload) => {
        onEntry(toFeedEntry(payload.new as FeedRow))
      },
    )
    .subscribe((status) => {
      onStatus?.(status === 'SUBSCRIBED')
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}
