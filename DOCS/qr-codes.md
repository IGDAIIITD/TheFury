# QR codes

## Token format

```
V1.<CORE>.<SIG>
│  │      └─ HMAC-SHA256("V1.<CORE>", QR_SIGNING_SECRET), 64 uppercase hex chars
│  └─ 12 chars from ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no I, L, O, 0, 1)
└─ version
```

The **QR image encodes the whole token** as plain text. The Scan page sends it to the `claim` Edge Function,
which verifies the signature before touching the database. Tampered tokens are rejected. The scanner decodes
~8 frames a second on a frame scaled to at most 960 px, and ignores QR codes that are not card tokens (it shows
"That QR code isn't a The Fury card" and keeps scanning).

## Two kinds of codes

| | Printed catalog codes | Spawned codes |
| --- | --- | --- |
| Made by | `qr-catalog` export | `admin-spawn` (admin console → Spawns) |
| Core | deterministic from the card id and copy number | random |
| Per card | 1, or up to 4 for UNLOCK cards (`?copies=4`) | as many as you mint |
| Extras | — | building, expiry, event |
| Reusable? | UNLOCK: yes, each player gets one copy per code · UNIQUE: first scan only | same rules per card type |
| Type the 12-char core by hand? | **no**, must be scanned (the core is guessable from public data) | **yes** (random, rate-limited) |

What a scan does depends on the card's ownership type; see [game-rules.md](game-rules.md#scanning-claims).

## Printing the catalog

The whole catalog is exported by one script on the host PC (service-role key from the root `.env`):

```powershell
cd scripts
npm ci                      # once: installs the QR encoder
node export-qr-catalog.mjs --with-art
```

It calls `qr-catalog` (4 codes per UNLOCK card by default; the function creates the claim row for every code,
so codes work the moment they are exported) and writes into `card-art/` (gitignored):

| File | What |
| --- | --- |
| `cards.json` | `[{ cardName, copy, qrContent }]`: exactly what each QR encodes |
| `cards.csv` | the same plus the rule text ("Scan once, unlock forever", "Copy 2 of 4 · up to 4", "One of a kind: first scan wins"), ownership type, rarity, token core, oracle id |
| `qr/<card-slug>[-<copy>].png` | one 600 px QR image per code (error correction M) |
| `print-sheet.html` | every code with its card art, name and rule, 3 per row on A4: open it in a browser and print |
| `<card-slug>.jpg` | the card art, for every card (`--with-art` downloads what's missing) |

Current catalog (2026-09-28): **999 codes for 342 cards**: 219 UNLOCK cards × 4, 104 scan-once UNLIMITED cards,
19 UNIQUE cards. The 15 free starter cards are left out (everyone owns them; `--include-free` adds them).

Options: `--copies 1..4` (codes per UNLOCK card), `--out <dir>`, `--no-images`, and `--offline` to re-render the
images and the sheet from an existing `cards.csv` without calling Supabase. Instead of the service-role key, an
admin's access token also works: `QR_EXPORT_TOKEN=<token> node export-qr-catalog.mjs`.

**Multiple copies.** A player gets one copy of an UNLOCK card per *different* code they scan, up to 4, so print
all 4 codes of a card and hide them in different places. Copy 1 is the same code as a plain one-per-card export,
so earlier prints stay valid. Codes are deterministic: re-exporting never changes a printed code, and they stay
valid as long as `QR_SIGNING_SECRET` isn't rotated.

**Direct download** (without the script): `GET /functions/v1/qr-catalog?copies=4` (JSON) or `&format=csv`, with
`Authorization: Bearer <admin access token or service-role key>`.

> The `card-art/cards.json` from before 2026-09-26 (104 cards, `fullToken` fields) was signed with the old
> default secret: **none of those codes work**. Use a fresh export.

## Spawning codes for an event or a building

Admin console → **Spawns**: pick a card, quantity, optional building (shows up in the "active buildings"
analytics and in the player's "buildings visited"), optional expiry and event. Each spawned claim returns
the signed token (encode it as a QR) and its 12-character core (it can be printed as text for manual entry).

## Testing a code

```bash
curl -X POST -H "apikey: <publishable key>" -H "Authorization: Bearer <user access token>" \
  -H "Content-Type: application/json" -d '{"token":"V1.XXXX.YYYY"}' \
  https://prjsiywvhxqnsvsmfgxm.supabase.co/functions/v1/claim
```

Status codes are listed in [edge-functions.md](edge-functions.md#claim).
