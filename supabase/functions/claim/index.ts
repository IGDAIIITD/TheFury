// Claim Edge Function — consumes a signed QR token for an authenticated player.
//
// Auth:    REQUIRES the caller's Supabase JWT (Authorization: Bearer). The user
//          id (sub) is resolved from the verified session via service-role client.
// Body:    { "token": "<V1.CORE.SIG | bare core>" }
// Errors:  CF400->400, CF403->403, CF404->404, CF409->409, CF410->410.
// Rate:    claim scope, capacity 30 / refill 2.0 per sec PER USER+IP (token
//          bucket, same shape as backend RateLimitFilter). 429 + Retry-After.
//
// Loyalty to backend semantics:
//   * @NotBlank(token)  -> 400 "token is required"
//   * signed tokens verified via HMAC-SHA256 constant-time (QrCodeSigner.verify)
//   * bare cores accepted as-is (legacy claims.token_core path)
//   * apply_claim RPC is service-role only, so clients cannot bypass verification

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyToken } from "../_shared/qr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET") ?? "7c1e9d4a2f6b8c3d5e7a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e";

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

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function errorJson(status: number, message: string, headers: Record<string, string> = {}) {
  return json(status, { status, message } satisfies { status: number; message: string }, headers);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type" },
    });
  }
  if (req.method !== "POST") {
    return errorJson(405, "Method Not Allowed");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return errorJson(401, "Missing bearer token");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user?.id) {
    return errorJson(401, "Unauthorized");
  }
  const playerId = user.id;

  // Fall back to IP when we somehow lack a user identity (shouldn't happen past
  // auth, kept for RateLimitFilter parity).
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
  const identity = playerId ? `user:${playerId}` : `ip:${ip}`;
  const bucket = bucketFor(`claim:${identity}`);
  if (!bucket.tryConsume()) {
    return errorJson(429, "Too Many Requests", { "Retry-After": String(bucket.secondsUntilRefill()) });
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "Invalid JSON body");
  }
  if (!body || typeof body.token !== "string" || body.token.trim() === "") {
    return errorJson(400, "token is required");
  }
  const raw = body.token;
  const normalized = raw.trim().toUpperCase();

  let core: string | null;
  if (normalized.includes(".")) {
    core = await verifyToken(normalized, QR_SIGNING_SECRET);
    if (core === null) {
      return errorJson(400, "Invalid or forged claim token");
    }
  } else {
    core = normalized;
  }

  const { data, error } = await supabase.rpc("apply_claim", {
    p_core: core,
    p_player: playerId,
  });

  if (error) {
    // error.code is the SQLSTATE ('CF404', ...) set via `using errcode`.
    const code: string = error.code ?? "";
    if (code.startsWith("CF")) {
      const status = Number(code.slice(2));
      if (status >= 400 && status < 500) {
        return errorJson(status, error.message ?? "Claim failed");
      }
    }
    return errorJson(500, error.message ?? "Claim failed");
  }

  return json(200, data);
});