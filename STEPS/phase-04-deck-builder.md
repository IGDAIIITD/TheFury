# Phase 4: Deck Builder & Server-Side Validation

## Objective
Build the web deck builder interface and secure server-side deck validation enforcing copy limits, ownership constraints, formats, and bans.

## Detailed Tasks
1. **Deck Persistence & Schema**
   - Create `decks` table (deck_id, player_id, name, format, decklist json/items, created_at, updated_at).
2. **Backend Deck Validation Service**
   - Implement `POST /api/v1/decks` validation logic:
     - Check card ownership (`CollectionService.owns` and quantity limits).
     - Check format constraints (e.g., Commander 99+1, Standard 4-copy limit, Basic lands unlimited).
     - Check banned/restricted lists and active event restrictions.
3. **Web Deck Builder UI**
   - Implement collection filtering (Owned, Missing, Recently Found, Favorites, Commander Eligible, Color filters, Mana curve).
   - Interactive deck editor allowing card addition/removal with live ownership feedback (e.g., `Counterspell (Owned: 2)`).
4. **Testing**
   - Test validation edge cases: submitting unowned cards, exceeding copy limits, or violating format rules.
