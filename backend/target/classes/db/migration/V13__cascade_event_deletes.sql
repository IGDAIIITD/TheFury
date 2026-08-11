-- Phase 9: deleting an event cascades to its spawned claims and event matches.
ALTER TABLE claims DROP CONSTRAINT fk_claims_event;
ALTER TABLE claims ADD CONSTRAINT fk_claims_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE matches DROP CONSTRAINT fk_matches_event;
ALTER TABLE matches ADD CONSTRAINT fk_matches_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;
