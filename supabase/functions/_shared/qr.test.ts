// deno test supabase/functions/_shared/qr.test.ts
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { deterministicCore, sign, signingSecret, verifyToken } from "./qr.ts";

const SECRET = "0123456789abcdef0123456789abcdef-test-only";
const GRIZZLY_BEARS = "11111111-1111-4111-8111-111111111101";

Deno.test("deterministic core matches SQL card_print_core (hosted DB value)", async () => {
  assertEquals(await deterministicCore(GRIZZLY_BEARS), "NBS8FE8VTBAA");
});

Deno.test("printed copies: copy 1 is the legacy core, copies 2-4 are distinct", async () => {
  assertEquals(await deterministicCore(GRIZZLY_BEARS, 1), "NBS8FE8VTBAA");
  const cores = await Promise.all([1, 2, 3, 4].map((n) => deterministicCore(GRIZZLY_BEARS, n)));
  assertEquals(new Set(cores).size, 4);
  assertEquals(await deterministicCore(GRIZZLY_BEARS, 3), cores[2]); // stable across runs
  await assertRejects(() => deterministicCore(GRIZZLY_BEARS, 0));
});

Deno.test("sign → verify round-trips and is case/whitespace tolerant", async () => {
  const token = await sign("NBS8FE8VTBAA", SECRET);
  assert(/^V1\.NBS8FE8VTBAA\.[0-9A-F]{64}$/.test(token));
  assertEquals(await verifyToken(token, SECRET), "NBS8FE8VTBAA");
  assertEquals(await verifyToken(`  ${token.toLowerCase()}\n`, SECRET), "NBS8FE8VTBAA");
});

Deno.test("forged, tampered and unsigned tokens are rejected", async () => {
  const token = await sign("NBS8FE8VTBAA", SECRET);
  const [v, core, sig] = token.split(".");
  assertEquals(await verifyToken(`${v}.${core}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`, SECRET), null);
  assertEquals(await verifyToken(`${v}.AAAAAAAAAAAA.${sig}`, SECRET), null);
  assertEquals(await verifyToken(token, SECRET + "x"), null);
  assertEquals(await verifyToken("NBS8FE8VTBAA", SECRET), null);
  assertEquals(await verifyToken(`${v}.${core}.ABC`, SECRET), null);
  assertEquals(await verifyToken(`${v}.${core}.${"Z".repeat(64)}`, SECRET), null);
  assertEquals(await verifyToken(`V2.${core}.${sig}`, SECRET), null);
});

Deno.test("signingSecret fails closed without a real secret", () => {
  Deno.env.delete("QR_SIGNING_SECRET");
  assertThrows(() => signingSecret());
  Deno.env.set("QR_SIGNING_SECRET", "short");
  assertThrows(() => signingSecret());
  Deno.env.set("QR_SIGNING_SECRET", SECRET);
  assertEquals(signingSecret(), SECRET);
});
