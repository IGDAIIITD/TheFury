// Shared QR/claim helpers for Edge Functions.
// Faithful port of backend QrCodeSigner + ClaimService deterministic core:
//   TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" (31 chars, no I/L/O/0/1)
//   core = deterministic 12-char token from SHA-256("cf-print:" + cardId)
//   token = "V1.<CORE>.<UPPER_HEX_HMAC_SHA256('V1.<CORE>')>"

export const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TOKEN_LENGTH = 12;
const VERSION = "V1";

/**
 * The HMAC secret (project secret QR_SIGNING_SECRET). There is deliberately no
 * default: the old hard-coded fallback lived in git, so any deployment without
 * the secret set would accept tokens anyone could forge. Callers turn the throw
 * into a 500.
 */
export function signingSecret(): string {
  const secret = Deno.env.get("QR_SIGNING_SECRET") ?? "";
  if (secret.length < 32) {
    throw new Error("QR_SIGNING_SECRET is not configured (need >= 32 chars)");
  }
  return secret;
}

async function importSecret(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHexUpper(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Deterministic token core for a card id. Mirrors ClaimService.deterministicCore. */
export async function deterministicCore(cardId: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(`cf-print:${cardId}`)),
  );
  let v =
    (BigInt(digest[0] ?? 0) << 40n) |
    (BigInt(digest[1] ?? 0) << 32n) |
    (BigInt(digest[2] ?? 0) << 24n) |
    (BigInt(digest[3] ?? 0) << 16n) |
    (BigInt(digest[4] ?? 0) << 8n) |
    BigInt(digest[5] ?? 0);
  let sb = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    sb += TOKEN_ALPHABET[Number(v % BigInt(TOKEN_ALPHABET.length))];
    v /= BigInt(TOKEN_ALPHABET.length);
  }
  return sb;
}

/** Sign a core -> "V1.<CORE>.<HEXSIG>". Mirrors QrCodeSigner.sign. */
export async function sign(core: string, secret: string): Promise<string> {
  const key = await importSecret(secret);
  const hmac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${VERSION}.${core}`),
  );
  return `${VERSION}.${core}.${toHexUpper(hmac)}`;
}

/**
 * Returns the embedded core if payload is well-formed and the signature is
 * valid, else null. Mirrors QrCodeSigner.verify incl. constant-time compare
 * (crypto.subtle.verify is constant-time).
 */
export async function verifyToken(payload: string, secret: string): Promise<string | null> {
  const normalized = payload.trim().toUpperCase();
  const parts = normalized.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || parts[1].length === 0) {
    return null;
  }
  // HMAC-SHA256 = 32 bytes = 64 hex chars; reject anything else before verifying.
  if (!/^[0-9A-F]{64}$/.test(parts[2])) {
    return null;
  }
  const key = await importSecret(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(parts[2]),
    new TextEncoder().encode(`${VERSION}.${parts[1]}`),
  );
  return ok ? parts[1] : null;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}