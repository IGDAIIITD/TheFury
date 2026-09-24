// Shared HTTP helpers for Edge Functions.
//
// Every response (not just the OPTIONS preflight) must carry the CORS headers:
// the PWA calls these functions cross-origin from GitHub Pages, and a browser
// discards any response without Access-Control-Allow-Origin — the client then
// sees a generic network error instead of e.g. "already claimed". Auth is a
// bearer token (no cookies), so a wildcard origin is safe.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Max-Age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function errorJson(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json(status, { status, message }, headers);
}

export function text(status: number, body: string, contentType: string): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}

/** Bearer token from the Authorization header, or "" when absent. */
export function bearer(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
