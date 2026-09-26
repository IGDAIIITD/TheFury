// Roll-number accounts are ordinary Supabase Auth email users with a synthetic address.
// No mail is ever sent to it (mailer_autoconfirm is on). The web client builds the same
// address in web-client/src/api/rollAuth.ts: keep ROLL_EMAIL_DOMAIN in sync.
export const ROLL_EMAIL_DOMAIN = "students.thefury.app";

export function rollEmail(rollNo: string): string {
  return `${rollNo.trim()}@${ROLL_EMAIL_DOMAIN}`;
}
