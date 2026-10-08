// Roster-id accounts are ordinary Supabase Auth email users with a synthetic address
// (for B.Tech/M.Tech rolls) or with the student's own IIITD address (PhD: the institute
// lists no roll numbers, so the address is both the roster id and the sign-in email).
// No mail is ever sent to the synthetic address (mailer_autoconfirm is on). The web
// client builds the same address in web-client/src/api/rollAuth.ts: keep both in sync.
export const ROLL_EMAIL_DOMAIN = "students.thefury.app";

const ROLL_ID_RE = /^(\d{7}|MT\d{5})$/i;

export function rollEmail(rollNo: string): string {
  const id = rollNo.trim().toLowerCase();
  return ROLL_ID_RE.test(id) ? `${id}@${ROLL_EMAIL_DOMAIN}` : id;
}
