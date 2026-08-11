-- Seeds the two battle/e2e demo accounts used across the seed scripts and
-- e2e drivers. Their UUIDs are fixed because seed_rg_combat_decks.sql and
-- seed_cohorts.sql reference them by id/email. Both log in with password123.
-- Idempotent: on conflict the password hash is refreshed, the id never changes.

INSERT INTO players (id, avatar, created, display_name, email, experience, last_login,
                     level, password_hash, role, student_id, degree_level, specialization, banned)
VALUES ('ac3cc775-3c5f-4de9-99fe-75266b4ebca8', NULL, now(), 'BattleTest', 'testbattle@campus.edu', 0, NULL, 1,
        '$2a$10$WlrEGv8MF/30L/ucaDiRUeiUaemzJb0vfB.aiazTZzweWvpr.6qCK', 'ROLE_PLAYER', NULL, 'BTECH', 'CSAI', FALSE)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                  display_name = EXCLUDED.display_name,
                                  degree_level = EXCLUDED.degree_level,
                                  specialization = EXCLUDED.specialization,
                                  banned = FALSE;

INSERT INTO players (id, avatar, created, display_name, email, experience, last_login,
                     level, password_hash, role, student_id, degree_level, specialization, banned)
VALUES ('4d4fb548-712b-4868-b04f-9a47e0bc37c5', NULL, now(), 'Opponent', 'opponent@campus.edu', 0, NULL, 1,
        '$2a$10$tUquxUOlaE2CVBhRWmQjReBjxw0SW1XhJhx24aZbaCsOb2xAZHBMK', 'ROLE_PLAYER', NULL, 'MTECH', 'CSE', FALSE)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                  display_name = EXCLUDED.display_name,
                                  degree_level = EXCLUDED.degree_level,
                                  specialization = EXCLUDED.specialization,
                                  banned = FALSE;
