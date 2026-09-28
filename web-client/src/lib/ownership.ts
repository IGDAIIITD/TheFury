import type { CardDto } from '../api/types'

/** Copies of an UNLOCK card a player can hold: one per distinct printed code (apply_claim). */
export const MAX_UNLOCK_COPIES = 4

/** How a card is obtained, in plain words (same rules as owned_copies() in SQL). */
export function ownershipRule(card: Pick<CardDto, 'ownershipType' | 'requiresUnlock'>): string {
  switch (card.ownershipType) {
    case 'UNLIMITED':
      return card.requiresUnlock ? 'Scan once, unlock forever' : 'Free for everyone'
    case 'UNLOCK':
      return `Scan a code per copy (up to ${MAX_UNLOCK_COPIES})`
    case 'UNIQUE':
      return 'One of a kind: first scan wins'
    default:
      return ''
  }
}

/**
 * The status line on a collection tile. Missing cards say how to get them, so every
 * missing card reads the same way whatever its type.
 */
export function ownershipStatus(
  card: Pick<CardDto, 'ownershipType' | 'requiresUnlock'>,
  quantity: number | null,
): { owned: boolean; label: string } {
  if (quantity === null) {
    const how =
      card.ownershipType === 'UNLIMITED'
        ? 'scan once, unlock forever'
        : card.ownershipType === 'UNLOCK'
          ? `scan to collect (up to ${MAX_UNLOCK_COPIES})`
          : card.ownershipType === 'UNIQUE'
            ? 'one of a kind, first scan wins'
            : 'scan to collect'
    return { owned: false, label: `Missing · ${how}` }
  }
  switch (card.ownershipType) {
    case 'UNLIMITED':
      return { owned: true, label: 'Unlimited copies' }
    case 'UNLOCK':
      return {
        owned: true,
        label:
          quantity >= MAX_UNLOCK_COPIES
            ? `Owned ${quantity} of ${MAX_UNLOCK_COPIES}`
            : `Owned ${quantity} of ${MAX_UNLOCK_COPIES} · scan another code for more`,
      }
    case 'UNIQUE':
      return { owned: true, label: quantity > 1 ? `Owned ×${quantity} (one of a kind)` : 'Owned (one of a kind)' }
    default:
      return { owned: true, label: `Owned: ${quantity}` }
  }
}
