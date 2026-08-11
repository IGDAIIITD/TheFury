import api from './client'
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
    const { data } = await api.post<ClaimResult>('/claim', { token: trimmed })
    return data
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status ?? 0
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    throw new ClaimApiError(status, message ?? `Claim failed (${status})`)
  }
}
