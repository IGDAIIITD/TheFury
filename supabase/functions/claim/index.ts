// Claim Edge Function — consumes a signed QR token for an authenticated player.
//
// Auth:    REQUIRES the caller's Supabase JWT (Authorization: Bearer). The user
//          id is resolved from the verified session via the service-role client.
// Body:    { "token": "V1.<CORE>.<SIG>" }  (exactly what the QR code encodes), or a
//          typed 12-char code for admin-spawned tokens (see below).
// Errors:  400 bad/forged token, 401 no session, 403 banned, 404 unknown token,
//          409 unique already claimed, 410 expired/revoked, 429 rate limited.
// Rate:    token bucket per user, capacity 30 / refill 2 per sec (best effort:
//          buckets live per isolate).
//
// Signed tokens are verified (HMAC-SHA256, constant time) before any DB access.
// Unsigned codes are accepted only for admin-spawned claims: print-catalog
// cores are derived from public card ids, so accepting those unsigned would let
// anyone claim every card.
// apply_claim is service-role only, so this function is the only way in.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearer, errorJson, json, preflight } from "../_shared/http.ts";
import { signingSecret, TOKEN_ALPHABET, TOKEN_LENGTH, verifyToken } from "../_shared/qr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BARE_CORE_RE = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`);

const CLAIM_CAPACITY = 30;
const CLAIM_REFILL_PER_SEC = 2.0;

class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefillMs) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
      this.lastRefillMs = now;
    }
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  secondsUntilRefill(): number {
    const missing = Math.max(0, 1 - this.tokens);
    return Math.ceil(missing / this.refillPerSecond);
  }
}

const buckets = new Map<string, TokenBucket>();

function bucketFor(key: string): TokenBucket {
  let b = buckets.get(key);
  if (!b) {
    b = new TokenBucket(CLAIM_CAPACITY, CLAIM_REFILL_PER_SEC);
    buckets.set(key, b);
  }
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return errorJson(405, "Method Not Allowed");

  let secret: string;
  try {
    secret = signingSecret();
  } catch (e) {
    console.error(e);
    return errorJson(500, "Claiming is not configured");
  }

  const jwt = bearer(req);
  if (!jwt) return errorJson(401, "Missing bearer token");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !user?.id) return errorJson(401, "Unauthorized");
  const playerId = user.id;

  const bucket = bucketFor(`claim:user:${playerId}`);
  if (!bucket.tryConsume()) {
    return errorJson(429, "Too Many Requests", { "Retry-After": String(bucket.secondsUntilRefill()) });
  }

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "Invalid JSON body");
  }
  if (!body || typeof body.token !== "string" || body.token.trim() === "") {
    return errorJson(400, "token is required");
  }
  if (body.token.length > 256) return errorJson(400, "Invalid or forged claim token");

  const normalized = body.token.trim().toUpperCase();
  let core: string | null;
  if (normalized.includes(".")) {
    core = await verifyToken(normalized, secret);
  } else {
    // Typed code (manual entry). Only admin-spawned tokens qualify: their cores
    // are random (~59 bits) and rate-limited. Print-catalog cores are derived
    // from public card ids, so those must arrive signed (scanned). Missing and
    // print-catalog cores get the same 400 so this is not an existence oracle.
    core = null;
    if (BARE_CORE_RE.test(normalized)) {
      const { data: row, error } = await supabase
        .from("claims")
        .select("spawned_by")
        .eq("token_core", normalized)
        .maybeSingle();
      if (error) {
        console.error("claim lookup failed", error);
        return errorJson(500, "Claim failed");
      }
      if (row?.spawned_by) core = normalized;
    }
  }
  if (core === null) return errorJson(400, "Invalid or forged claim token");

  const { data, error } = await supabase.rpc("apply_claim", { p_core: core, p_player: playerId });
  if (error) {
    // error.code is the SQLSTATE ('CF404', ...) raised via `using errcode`.
    const code: string = error.code ?? "";
    if (code.startsWith("CF")) {
      const status = Number(code.slice(2));
      if (status >= 400 && status < 500) return errorJson(status, error.message ?? "Claim failed");
    }
    console.error("apply_claim failed", error);
    return errorJson(500, "Claim failed");
  }

  return json(200, data);
});
