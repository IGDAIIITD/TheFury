// Admin spawn Edge Function — mints signed QR claim tokens for a card.
//
// Auth:    REQUIRES the caller's Supabase JWT (Authorization: Bearer); the
//          caller's profile must have role = 'ADMIN'.
// Body:    { cardId, quantity?, building?, expiresAt?, eventId? }
// Errors:  400 bad input, 401 missing/invalid token, 403 not admin, 404 card/
//          event not found, 500 insert failure.
//
// Mirrors backend AdminClaimController.mint / ClaimService.mint: random 12-char
// core from TOKEN_ALPHABET, signed "V1.<CORE>.<SIG>", quantity capped at 100,
// optional building/expiry/event, spawned_by = admin, plus a SPAWN feed entry.

import { createClient } from "npm:@supabase/supabase-js@2";
import { sign } from "../_shared/qr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QR_SIGNING_SECRET =
  Deno.env.get("QR_SIGNING_SECRET") ?? "7c1e9d4a2f6b8c3d5e7a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e";

const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 12;
const MAX_MINT_QUANTITY = 100;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function errorJson(status: number, message: string) {
  return json(status, { status, message });
}

function randomCore(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    s += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return errorJson(405, "Method Not Allowed");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) return errorJson(401, "Missing bearer token");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(jwt);
  if (userError || !user?.id) return errorJson(401, "Unauthorized");

  const { data: admin, error: adminError } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (adminError) return errorJson(500, adminError.message);
  if (!admin || admin.role !== "ADMIN") return errorJson(403, "Admin access required");

  let body: {
    cardId?: string;
    quantity?: number;
    building?: string | null;
    expiresAt?: string | null;
    eventId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "Invalid JSON body");
  }

  if (!body?.cardId || typeof body.cardId !== "string") {
    return errorJson(400, "cardId is required");
  }
  const quantity = body.quantity == null ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return errorJson(400, "quantity must be at least 1");
  }
  if (quantity > MAX_MINT_QUANTITY) {
    return errorJson(400, `quantity must not exceed ${MAX_MINT_QUANTITY}`);
  }

  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("id, forge_name")
    .eq("id", body.cardId)
    .maybeSingle();
  if (cardError) return errorJson(500, cardError.message);
  if (!card) return errorJson(404, `Card not found: ${body.cardId}`);

  let eventName: string | null = null;
  if (body.eventId) {
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, name")
      .eq("id", body.eventId)
      .maybeSingle();
    if (eventError) return errorJson(500, eventError.message);
    if (!event) return errorJson(404, `Event not found: ${body.eventId}`);
    eventName = event.name;
  }

  const building = body.building?.trim() ? body.building.trim() : null;
  const expiresAt = body.expiresAt ?? null;
  const minted: Record<string, unknown>[] = [];

  for (let i = 0; i < quantity; i++) {
    let inserted: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const core = randomCore();
      const full = await sign(core, QR_SIGNING_SECRET);
      const { data, error } = await supabase
        .from("claims")
        .insert({
          id: crypto.randomUUID(),
          token: full,
          token_core: core,
          card_id: card.id,
          building,
          expires_at: expiresAt,
          status: "ACTIVE",
          event_id: body.eventId ?? null,
          spawned_by: user.id,
        })
        .select("*")
        .single();
      if (error) {
        // 23505 = unique_violation on token_core; retry with a new core.
        if (error.code === "23505") continue;
        return errorJson(500, error.message);
      }
      inserted = data;
    }
    if (!inserted) return errorJson(500, "Could not allocate a unique claim token");
    minted.push({
      id: inserted.id,
      token: inserted.token,
      cardId: card.id,
      forgeName: card.forge_name,
      building: inserted.building,
      expiresAt: inserted.expires_at,
      status: inserted.status,
      eventId: inserted.event_id,
      eventName,
      spawnedBy: admin.display_name,
      createdAt: inserted.created_at,
    });
  }

  const text =
    `spawned ${quantity} token(s) for ${card.forge_name}` + (building ? ` at ${building}` : "");
  await supabase.rpc("add_feed_entry", {
    p_type: "SPAWN",
    p_text: text,
    p_player: user.id,
    p_card: card.id,
  });

  return json(201, minted);
});
