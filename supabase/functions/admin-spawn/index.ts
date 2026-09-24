// Admin spawn Edge Function — mints signed QR claim tokens for a card.
//
// Auth:    REQUIRES the caller's Supabase JWT; profiles.role must be 'ADMIN'.
// Body:    { cardId, quantity?, building?, expiresAt?, eventId? }
// Returns: 201 [{ id, token, cardId, forgeName, building, expiresAt, status,
//          eventId, eventName, spawnedBy, createdAt }] — `token` is the QR text.
// Errors:  400 bad input, 401 no session, 403 not admin, 404 card/event missing,
//          500 insert failure / signing not configured.
//
// Random 12-char core from the token alphabet (rejection-sampled, no modulo
// bias), signed "V1.<CORE>.<SIG>", quantity 1..100, optional building / expiry
// / event, spawned_by = admin, plus a SPAWN feed entry and game_log row.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearer, errorJson, json, preflight } from "../_shared/http.ts";
import { sign, signingSecret, TOKEN_ALPHABET, TOKEN_LENGTH } from "../_shared/qr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_MINT_QUANTITY = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function randomCore(): string {
  // largest multiple of the alphabet size below 256, to avoid modulo bias
  const limit = 256 - (256 % TOKEN_ALPHABET.length);
  let s = "";
  while (s.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && s.length < TOKEN_LENGTH) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
    }
  }
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return errorJson(405, "Method Not Allowed");

  let secret: string;
  try {
    secret = signingSecret();
  } catch (e) {
    console.error(e);
    return errorJson(500, "QR signing is not configured");
  }

  const jwt = bearer(req);
  if (!jwt) return errorJson(401, "Missing bearer token");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !user?.id) return errorJson(401, "Unauthorized");

  const { data: admin, error: adminError } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (adminError) return errorJson(500, "Could not verify admin role");
  if (!admin || admin.role !== "ADMIN") return errorJson(403, "Admin access required");

  let body: {
    cardId?: unknown;
    quantity?: unknown;
    building?: unknown;
    expiresAt?: unknown;
    eventId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return errorJson(400, "Invalid JSON body");
  }

  if (typeof body?.cardId !== "string" || !UUID_RE.test(body.cardId)) {
    return errorJson(400, "cardId is required");
  }
  const quantity = body.quantity == null ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) return errorJson(400, "quantity must be at least 1");
  if (quantity > MAX_MINT_QUANTITY) return errorJson(400, `quantity must not exceed ${MAX_MINT_QUANTITY}`);

  const building = typeof body.building === "string" && body.building.trim() ? body.building.trim() : null;
  if (building && building.length > 80) return errorJson(400, "building must be at most 80 characters");

  let expiresAt: string | null = null;
  if (body.expiresAt != null && body.expiresAt !== "") {
    const t = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (Number.isNaN(t)) return errorJson(400, "expiresAt must be an ISO timestamp");
    if (t <= Date.now()) return errorJson(400, "expiresAt must be in the future");
    expiresAt = new Date(t).toISOString();
  }

  let eventId: string | null = null;
  if (body.eventId != null && body.eventId !== "") {
    if (typeof body.eventId !== "string" || !UUID_RE.test(body.eventId)) return errorJson(400, "eventId must be a uuid");
    eventId = body.eventId;
  }

  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("id, forge_name")
    .eq("id", body.cardId)
    .maybeSingle();
  if (cardError) return errorJson(500, cardError.message);
  if (!card) return errorJson(404, `Card not found: ${body.cardId}`);

  let eventName: string | null = null;
  if (eventId) {
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, name")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) return errorJson(500, eventError.message);
    if (!event) return errorJson(404, `Event not found: ${eventId}`);
    eventName = event.name;
  }

  const minted: Record<string, unknown>[] = [];
  for (let i = 0; i < quantity; i++) {
    let inserted: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const core = randomCore();
      const token = await sign(core, secret);
      const { data, error } = await supabase
        .from("claims")
        .insert({
          id: crypto.randomUUID(),
          token,
          token_core: core,
          card_id: card.id,
          building,
          expires_at: expiresAt,
          status: "ACTIVE",
          event_id: eventId,
          spawned_by: user.id,
        })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") continue; // token_core collision; retry
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

  const message = `spawned ${quantity} token(s) for ${card.forge_name}` + (building ? ` at ${building}` : "");
  const [feed, log] = await Promise.all([
    supabase.rpc("add_feed_entry", { p_type: "SPAWN", p_text: message, p_player: user.id, p_card: card.id }),
    supabase.from("game_log").insert({
      kind: "SPAWN",
      player_id: user.id,
      card_id: card.id,
      ref_id: eventId,
      detail: { quantity, building, expiresAt, claimIds: minted.map((m) => m.id) },
    }),
  ]);
  if (feed.error) console.error("feed entry failed", feed.error);
  if (log.error) console.error("game_log insert failed", log.error);

  return json(201, minted);
});
