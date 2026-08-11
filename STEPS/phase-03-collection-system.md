# Phase 3: Collection System & Ownership Database

## Objective
Implement card metadata definitions, ownership models (Unlimited, Unlock, Unique), player collections, and inventory management.

## Detailed Tasks
1. **Metadata & Card Database**
   - Create `cards` table storing oracle id, forge name, rarity, ownership type (`UNLIMITED`, `UNLOCK`, `UNIQUE`), set, mana value, types, colors, image URL, discoverable status, and spawn region.
   - Import core card metadata from Magic JSON / Forge data.
2. **Ownership Tables & Models**
   - Implement `player_unlocks` table (player_id, card_id, unlocked_date).
   - Implement `unique_cards` table (physical_uuid, owner_id, history log, serial number, claimed status).
   - Define business logic for Unlimited cards (always accessible in collection).
3. **Collection API Service (`CollectionService`)**
   - `getCollection(playerId)`: Returns all owned cards across unlimited, unlocked, and unique categories.
   - `owns(playerId, cardId)` / `quantity(playerId, cardId)`: Validates ownership counts.
   - `discover(playerId, cardId)`: Records scan discovery without duplicating unlocks.
4. **Testing**
   - Unit tests verifying unlock addition, unlimited card fallback, and unique card ownership tracking.
