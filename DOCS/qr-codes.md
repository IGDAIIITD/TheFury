# QR codes

## Token format

```
V1.<CORE>.<SIG>
│  │      └─ HMAC-SHA256("V1.<CORE>", QR_SIGNING_SECRET), 64 uppercase hex chars
│  └─ 12 chars from ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no I, L, O, 0, 1)
└─ version
```

The **QR image encodes the whole token** as plain text. The Scan page sends it to the `claim` Edge Function,
which verifies the signature before touching the database. Tampered tokens are rejected.

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

1. Sign in as an admin (see [operations.md](operations.md#make-someone-an-admin)).
2. Get your access token: on https://igdaiiitd.github.io/TheFury/ while signed in, open the browser console and run
   ```js
   JSON.parse(localStorage.getItem('sb-prjsiywvhxqnsvsmfgxm-auth-token')).access_token
   ```
   (it expires after about an hour; reload the site to refresh it). Then download the catalog:
   ```bash
   curl -H "apikey: <publishable key>" -H "Authorization: Bearer <admin access token>" \
     https://prjsiywvhxqnsvsmfgxm.supabase.co/functions/v1/qr-catalog > qr-catalog.json
   ```
3. The file is `[{ "cardName": "...", "qrContent": "V1...." }, ...]`. Generate one QR code per entry from
   `qrContent` (any QR generator or a label/mail-merge tool) and print the card name under it.

**Multiple copies.** A player gets one copy of an UNLOCK card per *different* code they scan, up to 4. To let
players collect full playsets, export with `?copies=4` (or 2–3):

```bash
curl … "https://prjsiywvhxqnsvsmfgxm.supabase.co/functions/v1/qr-catalog?copies=4" > qr-catalog.json
```

Each UNLOCK card then gets 4 entries `{ "cardName", "copy": 1..4, "qrContent" }`, each a different code.
Print them separately and hide them in different places. UNLIMITED and UNIQUE cards still get one code each.
Copy 1 is the same code as a plain export, so previously printed codes stay valid.

Codes are deterministic, so re-exporting never changes existing printed codes. They stay valid as long as
`QR_SIGNING_SECRET` isn't rotated.

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
