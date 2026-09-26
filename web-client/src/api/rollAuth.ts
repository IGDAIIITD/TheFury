import { callEdgeFunction } from './supabaseClient'

/**
 * Roll-number sign-in. Roll accounts are Supabase Auth users with a synthetic email
 * (never mailed). Keep ROLL_EMAIL_DOMAIN in sync with supabase/functions/_shared/roll.ts.
 */
export const ROLL_EMAIL_DOMAIN = 'students.thefury.app'

export const ROLL_RE = /^[0-9]{7}$/

export function rollEmail(rollNo: string): string {
  return `${rollNo.trim()}@${ROLL_EMAIL_DOMAIN}`
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
 * Check a roll number + first name against the student roster (student-auth Edge
 * Function). Throws EdgeFunctionError: 404 unknown roll, 403 name mismatch, 429 too many tries.
 */
export function checkRoll(rollNo: string, firstName: string): Promise<RollStatus> {
  return callEdgeFunction<RollStatus>('student-auth', { action: 'check', rollNo: rollNo.trim(), firstName })
}

/** Create the account for a NEW roll with the chosen password; returns its sign-in email. */
export async function registerRoll(rollNo: string, firstName: string, password: string): Promise<string> {
  const res = await callEdgeFunction<{ email: string }>('student-auth', {
    action: 'register',
    rollNo: rollNo.trim(),
    firstName,
    password,
  })
  return res.email
}
