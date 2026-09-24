import { EdgeFunctionError, callEdgeFunction } from './supabaseClient'
import type { ClaimResult } from './types'

export class ClaimApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ClaimApiError'
    this.status = status
  }
}

export async function claimToken(token: string): Promise<ClaimResult> {
  const trimmed = token.trim().toUpperCase()
  try {
    return await callEdgeFunction<ClaimResult>('claim', { token: trimmed })
  } catch (err) {
    if (err instanceof EdgeFunctionError) {
      throw new ClaimApiError(err.status, err.message)
    }
    const status = (err as { status?: number })?.status ?? 0
    const message = (err as { message?: string })?.message
    throw new ClaimApiError(status, message ?? `Claim failed (${status})`)
  }
}
