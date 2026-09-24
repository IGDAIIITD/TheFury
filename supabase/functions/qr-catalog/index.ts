// qr-catalog Edge Function — admin-only QR print catalog.
//
//   GET  /functions/v1/qr-catalog              -> JSON, one entry per card:
//          [{ "cardName": "Grizzly Bears", "qrContent": "V1.<CORE>.<SIG>" }, ...]
//        qrContent is exactly the text to encode in the printed QR code (the
//        scanner sends it verbatim to the claim function).
//   GET  /functions/v1/qr-catalog?format=csv   -> CSV with the same two columns
//        first, then tokenCore/ownershipType/rarity/oracleId for print sorting.
//   POST /functions/v1/qr-catalog/regenerate   -> ensure a claim row exists for
//        every card; returns { cards: n }.
//
// Tokens are deterministic (core = f(cardId), signed with QR_SIGNING_SECRET), so
// re-exporting always yields the same codes and new cards simply appear.
// Caller must be signed in with profiles.role = 'ADMIN'.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { bearer, errorJson, json, preflight, text } from "../_shared/http.ts";
import { deterministicCore, sign, signingSecret } from "../_shared/qr.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CatalogRow {
  cardName: string;
  qrContent: string;
  tokenCore: string;
  ownershipType: string;
  rarity: string;
  oracleId: string;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: CatalogRow[]): string {
  const lines = ["cardName,qrContent,tokenCore,ownershipType,rarity,oracleId"];
  for (const r of rows) {
    lines.push([r.cardName, r.qrContent, r.tokenCore, r.ownershipType, r.rarity, r.oracleId].map(csvEscape).join(","));
  }
  return lines.join("\n") + "\n";
}

async function generateCatalog(supabase: SupabaseClient, secret: string): Promise<CatalogRow[]> {
  const { data: cards, error } = await supabase
    .from("cards")
    .select("id, forge_name, oracle_id, rarity, ownership_type");
  if (error) throw error;

  // One ensure_print_claim round-trip per card; run them in parallel batches so
  // a catalog of several hundred cards stays well inside the function time limit.
  const BATCH = 25;
  const rows: CatalogRow[] = [];
  const list = cards ?? [];
  for (let i = 0; i < list.length; i += BATCH) {
    rows.push(...await Promise.all(list.slice(i, i + BATCH).map(async (card) => {
      const core = await deterministicCore(card.id);
      const qrContent = await sign(core, secret);
      const { error: ensureError } = await supabase.rpc("ensure_print_claim", {
        p_card_id: card.id,
        p_core: core,
        p_token: qrContent,
      });
      if (ensureError) throw ensureError;
      return {
        cardName: card.forge_name,
        qrContent,
        tokenCore: core,
        ownershipType: card.ownership_type,
        rarity: card.rarity ?? "",
        oracleId: card.oracle_id,
      };
    })));
  }
  rows.sort((a, b) => a.cardName.toLowerCase().localeCompare(b.cardName.toLowerCase()));
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const url = new URL(req.url);
  const isRegenerate = req.method === "POST" && url.pathname.endsWith("/regenerate");
  if (req.method !== "GET" && !isRegenerate) return errorJson(405, "Method Not Allowed");

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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return errorJson(500, "Could not verify admin role");
  if (!profile || profile.role !== "ADMIN") return errorJson(403, "Access Denied");

  try {
    const rows = await generateCatalog(supabase, secret);
    if (isRegenerate) return json(200, { cards: rows.length });
    if ((url.searchParams.get("format") ?? "json").toLowerCase() === "csv") {
      return text(200, toCsv(rows), "text/csv; charset=utf-8");
    }
    return json(200, rows.map(({ cardName, qrContent }) => ({ cardName, qrContent })));
  } catch (e) {
    console.error("catalog generation failed", e);
    return errorJson(500, "Catalog generation failed");
  }
});
