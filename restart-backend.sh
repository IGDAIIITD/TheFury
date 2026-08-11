#!/usr/bin/env bash
# Restarts the Campus Forge backend cleanly.
# Works from anywhere: resolves the backend dir relative to this script.
set -euo pipefail
cd "$(dirname "$0")/backend"

pkill -f "[c]ampusforge-backend-0.0.1-SNAPSHOT.jar" || true
sleep 2

exec setsid nohup java -jar target/campusforge-backend-0.0.1-SNAPSHOT.jar \
    > backend.log 2>&1 < /dev/null &
