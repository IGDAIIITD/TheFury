#!/bin/sh
# One-shot demo seeder for the compose stack. Runs after the backend reports
# healthy (its startup applies Flyway V1-V14 and the idempotent catalog/format
# seeders), then applies the demo seeds in dependency order. Every file is
# idempotent, so re-running is safe.
set -e

echo "[seed] waiting for backend on backend:17172 ..."
i=0
until nc -z -w 2 backend 17172; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[seed] backend not reachable after 120s, giving up" >&2
    exit 1
  fi
  sleep 2
done
echo "[seed] backend is up; applying seeds"

export PGPASSWORD="$SEED_DB_PASSWORD"
PSQL="psql -h $SEED_DB_HOST -U $SEED_DB_USER -d $SEED_DB_NAME -v ON_ERROR_STOP=1"

for f in \
  /seeds/seed_demo_accounts.sql \
  /setup/seed_admin.sql \
  /setup/seed_cohorts.sql \
  /setup/seed_rg_combat_decks.sql \
  /setup/seed_unique_cards.sql \
  /setup/seed_claims.sql \
  /setup/seed_events.sql; do
  echo "[seed] applying $(basename "$f")"
  $PSQL -f "$f"
done

echo "[seed] done"
