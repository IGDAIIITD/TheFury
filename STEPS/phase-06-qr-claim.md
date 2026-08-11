# Phase 6: QR Code Claim Flow & Camera Integration

## Objective
Implement QR code token generation, secure claim validation, discovery tracking, and client-side camera scanning inside the Unified PWA.

## Detailed Tasks
1. **QR & Claim Backend Schema & Service**
   - Create `claims` table (token, card_id, building_id, expires_at, status, event_id).
   - Implement `POST /api/v1/claim` endpoint:
     - Validate token validity and expiration.
     - Check if player already claimed (increment discovery count if so; unlock card + award XP if first time).
2. **Client-Side Camera Scan Tab**
   - Integrate client-side QR decoding library (`jsQR` or `zxing-js`) using browser `getUserMedia` API over HTTPS.
   - Build Scan tab route in the PWA with camera permission prompts and live viewfinder.
   - Automatically POST scanned token to `/claim` and display unlock/reward animation payload.
3. **Testing**
   - Test claim lifecycle: valid claim, duplicate claim (discovery increment), expired token rejection, and HTTPS requirement verification.

## Implementation Notes & Deviations
- **Schema**: uses `building` (varchar) instead of the plan's `building_id`; no `event_id` column. No event scoping yet; add a migration if event-bound claims are needed.
- **HTTPS requirement**: `getUserMedia` only works on a secure context. `http://localhost:17170` counts as secure; a LAN IP (`http://192.168.x.x:17170`) does **not**, so the camera reports "unsupported" and the page falls back to the manual code-entry form (also covered by unit tests via the jsdom environment, which has no `mediaDevices`).
- **Unique cards**: serials are minted via `max(serial)+1` (not `count+1`) to avoid colliding with seeded rows; re-claiming a claimed unique returns 409, expired/revoked 410, unknown 404.
- **Success animation**: unlock result shows a `reveal-badge` pop on the `✦` icon plus a `reveal-sheet` pulse on the outcome panel (`index.css` keyframes).

