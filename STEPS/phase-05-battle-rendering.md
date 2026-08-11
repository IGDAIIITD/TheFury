# Phase 5: Battle Adapter & Web Battle Board

## Objective
Implement the server-side battle adapter managing headless Forge instances and build the custom web-based battle board rendering state via WebSockets.

## Detailed Tasks
1. **Battle Adapter Service**
   - Implement `BattleAdapter` interface: `startGame()`, `finishGame()`, `reportWinner()`, `reportDisconnect()`, `reportConcede()`.
   - Manage process lifecycle for running headless Forge matches tied to player UUIDs and deck IDs.
2. **WebSocket Game State Streaming**
   - Establish WebSocket endpoints for live match communication (`/ws/match/{matchId}`).
   - Stream game state diffs (hand sizes, battlefield permanents, life totals, stack, priority) from headless Forge to players.
   - Accept player action payloads (tap, cast, target, pass priority) over WebSocket and forward to Forge.
3. **Web Battle Board Prototype**
   - Build a minimal 1v1 combat-only prototype (focusing on life totals, hand, and basic battlefield representation without complex stack/triggers initially).
   - Implement reconnect-on-resume logic for mobile PWA lifecycle suspension.
4. **Testing**
   - Simulate end-to-end headless match execution between two bots or test accounts with WebSocket state synchronization.
