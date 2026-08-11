-- Seeds the admin console login account.
-- admin@campus.edu / password123 (reuses the bcrypt hash of the seeded
-- testbattle user, so the same password unlocks both accounts).
-- Idempotent: if the email already exists the account is promoted to admin.

INSERT INTO players (id, avatar, created, display_name, email, experience, last_login,
                     level, password_hash, role, student_id, degree_level, specialization, banned)
VALUES ('11111111-2222-3333-4444-555555555555', NULL, now(), 'Admin', 'admin@campus.edu', 0, NULL, 1,
        '$2a$10$WlrEGv8MF/30L/ucaDiRUeiUaemzJb0vfB.aiazTZzweWvpr.6qCK', 'ROLE_ADMIN', NULL, 'B.Tech', 'CSE', FALSE)
ON CONFLICT (email) DO UPDATE SET role = 'ROLE_ADMIN', password_hash = EXCLUDED.password_hash;
