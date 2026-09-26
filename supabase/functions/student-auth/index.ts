// student-auth Edge Function: roll-number sign-in support for the login screen.
//
// Auth:    none (called before the player has a session). Deploy with --no-verify-jwt.
// Body:    { "action": "check",    "rollNo": "2026001", "firstName": "Aadi" }
//            -> 200 { status: "NEW" | "REGISTERED", rollNo, name, program, degreeLevel, batch }
//          { "action": "register", "rollNo": "2026001", "firstName": "Aadi", "password": "…",
//            "nickname": "optional display name" }
//            -> 201 { email }   (the client then signs in with email + password)
// Errors:  400 bad input / weak password / bad nickname, 403 first name doesn't match, 404 roll not in the
//          roster, 409 roll already registered, 429 rate limited.
//
// The roster (`students`) and student_roll_status() are service-role only. Accounts are
// created through the admin API with app_metadata.roll_no, which a public sign-up can't set;
// handle_new_user then fills the profile from the roster. Passwords go straight to Supabase
// Auth (bcrypt); this function never stores or logs them.

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorJson, json, preflight } from "../_shared/http.ts";
import { rollEmail } from "../_shared/roll.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ROLL_RE = /^[0-9]{7}$/;
const MIN_PASSWORD = 8;
// Optional display name chosen at sign-up (otherwise the roster name is shown).
const NICKNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,23}$/u;

// Best-effort per-IP limit (buckets live per isolate): slows down guessing first names.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, { start: number; count: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  h.count += 1;
  return h.count > MAX_PER_WINDOW;
}

type RollStatus = {
  status: "NOT_FOUND" | "NAME_MISMATCH" | "NEW" | "REGISTERED";
  rollNo?: string;
  name?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return errorJson(405, "Use POST.");

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return errorJson(429, "Too many attempts. Wait a minute and try again.");

  let body: { action?: string; rollNo?: string; firstName?: string; password?: string; nickname?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "Invalid JSON body.");
  }
  const rollNo = String(body.rollNo ?? "").trim();
  const firstName = String(body.firstName ?? "").trim();
  if (!ROLL_RE.test(rollNo)) return errorJson(400, "Roll numbers are 7 digits, e.g. 2026001.");
  if (!firstName) return errorJson(400, "Enter your first name.");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("student_roll_status", { p_roll: rollNo, p_first_name: firstName });
  if (error) {
    console.error("student_roll_status failed", error.message);
    return errorJson(500, "Could not check the roll number. Try again.");
  }
  const status = data as RollStatus;
  if (status.status === "NOT_FOUND") return errorJson(404, "That roll number isn't in the student list.");
  if (status.status === "NAME_MISMATCH") return errorJson(403, "That first name doesn't match this roll number.");

  if (body.action === "check") return json(200, status);
  if (body.action !== "register") return errorJson(400, 'action must be "check" or "register".');

  if (status.status === "REGISTERED") return errorJson(409, "This roll number already has an account. Log in instead.");
  const password = String(body.password ?? "");
  if (password.length < MIN_PASSWORD) {
    return errorJson(400, `Choose a password of at least ${MIN_PASSWORD} characters.`);
  }

  const nickname = String(body.nickname ?? "").trim().replace(/\s+/g, " ");
  if (nickname && !NICKNAME_RE.test(nickname)) {
    return errorJson(400, "Nicknames are 2–24 letters, numbers, spaces or . _ ' -");
  }

  const email = rollEmail(rollNo);
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { roll_no: rollNo },
    user_metadata: { display_name: status.name },
  });
  if (created.error) {
    // Lost a race with another registration for the same roll.
    if (/already|exists|registered/i.test(created.error.message)) {
      return errorJson(409, "This roll number already has an account. Log in instead.");
    }
    console.error("createUser failed", created.error.message);
    return errorJson(500, "Could not create the account. Try again.");
  }

  // The roster link happens in a trigger (migration 19). Never leave an unlinked account behind:
  // it would hold the synthetic email while the roll still reads as NEW.
  const userId = created.data.user?.id;
  const { data: profile } = await admin.from("profiles").select("roll_no").eq("id", userId).maybeSingle();
  if (profile?.roll_no !== rollNo) {
    console.error("roll link missing for new user", userId);
    if (userId) await admin.auth.admin.deleteUser(userId);
    return errorJson(500, "Could not create the account. Try again.");
  }
  if (nickname) {
    const { error: nickError } = await admin.from("profiles").update({ display_name: nickname }).eq("id", userId);
    if (nickError) console.error("nickname update failed", nickError.message); // keep the roster name
  }
  return json(201, { email });
});
