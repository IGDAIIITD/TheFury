import { callEdgeFunction } from './supabaseClient'

/**
 * Roster-id sign-in. B.Tech and M.Tech rolls are Supabase Auth users with a synthetic
 * email (never mailed); PhD students have no roll number, so their IIITD address is both
 * the roster id and the sign-in email. Keep ROLL_EMAIL_DOMAIN in sync with
 * supabase/functions/_shared/roll.ts and rollEmail() identical to it.
 */
export const ROLL_EMAIL_DOMAIN = 'students.thefury.app'

export const ROLL_RE = /^(\d{7}|MT\d{5}|[^@\s]+@iiitd\.ac\.in)$/i

const ROLL_ID_RE = /^(\d{7}|MT\d{5})$/i

export function rollEmail(rollNo: string): string {
  const id = rollNo.trim().toLowerCase()
  return ROLL_ID_RE.test(id) ? `${id}@${ROLL_EMAIL_DOMAIN}` : id
}

export interface RollStatus {
  status: 'NEW' | 'REGISTERED'
  rollNo: string
  name: string
  program: string
  degreeLevel: string
  batch: number
}

/**
 * Check a roster id + first name against the student roster (student-auth Edge
 * Function). Throws EdgeFunctionError: 404 unknown id, 403 name mismatch, 429 too many tries.
 */
export function checkRoll(rollNo: string, firstName: string): Promise<RollStatus> {
  return callEdgeFunction<RollStatus>('student-auth', { action: 'check', rollNo: rollNo.trim(), firstName })
}

/**
 * Create the account for a NEW id with the chosen password and an optional nickname
 * (shown instead of the roster name); returns its sign-in email.
 */
export async function registerRoll(
  rollNo: string,
  firstName: string,
  password: string,
  nickname?: string,
): Promise<string> {
  const res = await callEdgeFunction<{ email: string }>('student-auth', {
    action: 'register',
    rollNo: rollNo.trim(),
    firstName,
    password,
    nickname: nickname?.trim() || undefined,
  })
  return res.email
}
