// qr-catalog Edge Function — admin-only QR print catalog.
//
// Mirrors backend QrCatalogController + QrCatalogExporter:
//   GET  /functions/v1/qr-catalog?format=json|csv   -> print catalog (live)
//   POST /functions/v1/qr-catalog/regenerate        -> idempotent re-export
//
// Admin gate matches AdminRoleChecker: the caller must be an authenticated
// user whose profiles.role = 'ADMIN'.

import { createClient } from "npm:@supabase/supabase-js@2";
import { deterministicCore, sign } from "../_shared/qr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QR_SIGNING_SECRET = Deno.env.get("QR_SIGNING_SECRET") ?? "7c1e9d4a2f6b8c3d5e7a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e";

interface QrPrintEntry {
  cardName: string;
  oracleId: string;
  tokenCore: string;
  fullToken: string;
  ownershipType: string;
  rarity: string;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(entries: QrPrintEntry[]): string {
  const lines = ["cardName,oracleId,tokenCore,fullToken,ownershipType,rarity"];
  for (const e of entries) {
    lines.push(
      [csvEscape(e.cardName), csvEscape(e.oracleId), e.tokenCore, e.fullToken, e.ownershipType, csvEscape(e.rarity)].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

async function generateCatalog(supabase: ReturnType<typeof createClient>): Promise<QrPrintEntry[]> {
  const { data: cards, error } = await supabase
    .from("cards")
    .select("id, forge_name, oracle_id, rarity, ownership_type");

  if (error) throw error;

  const entries: QrPrintEntry[] = [];
  for (const card of cards ?? []) {
    const core = await deterministicCore(card.id);
    const fullToken = await sign(core, QR_SIGNING_SECRET);
    const { error: ensureError } = await supabase.rpc("ensure_print_claim", {
      p_card_id: card.id,
      p_core: core,
      p_token: fullToken,
    });
    if (ensureError) throw ensureError;
    entries.push({
      cardName: card.forge_name,
      oracleId: card.oracle_id,
      tokenCore: core,
      fullToken,
      ownershipType: card.ownership_type,
      rarity: card.rarity,
    });
  }

  // QrCatalogExporter sorts by cardName case-insensitive.
  entries.sort((a, b) => a.cardName.toLowerCase().localeCompare(b.cardName.toLowerCase()));
  return entries;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return json(401, { status: 401, message: "Missing bearer token" });
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user?.id) {
    return json(401, { status: 401, message: "Unauthorized" });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError || !profile || profile.role !== "ADMIN") {
    return json(403, { status: 403, message: "Access Denied" });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  const isRegenerate = req.method === "POST" && url.pathname.endsWith("/regenerate");

  if (req.method !== "GET" && !isRegenerate) {
    return json(405, { status: 405, message: "Method Not Allowed" });
  }

  try {
    const entries = await generateCatalog(supabase);

    if (isRegenerate) {
      return json(200, { cards: entries.length, dir: "qr-catalog" });
    }

    if (format.toLowerCase() === "csv") {
      return new Response(toCsv(entries), {
        status: 200,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }

    return json(200, entries);
  } catch (e) {
    return json(500, { status: 500, message: e instanceof Error ? e.message : "Catalog generation failed" });
  }
});