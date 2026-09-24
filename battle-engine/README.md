# battle-engine

Spring Boot + Forge battle server for Campus Forge. **Full documentation: [DOCS/battle-engine.md](../DOCS/battle-engine.md).**

Quick reference (run from the repo root):

```powershell
# build (Forge once, then the engine)
powershell -ExecutionPolicy Bypass -File battle-engine\setup-forge.ps1 -Mvn "<path to mvn.cmd>"
cd battle-engine; mvn clean package; cd ..

# run locally on :17175 (settings from ..\.env)
powershell -ExecutionPolicy Bypass -File battle-engine\run-engine.ps1

# production: install as a boot-time service (Administrator shell)
powershell -ExecutionPolicy Bypass -File battle-engine\battle-server.ps1 install
#   … then: status | logs | update | restart | stop | start | uninstall
```

| File | Purpose |
| --- | --- |
| `src/` | the Spring Boot service (REST `/api/v1/battle/*`, STOMP `/ws/match`) |
| `forge/` | vendored `forge-headless` module + `campusforge-forge.patch` against upstream Forge `fd8196a8` |
| `setup-forge.ps1` | clone + patch + build Forge into `../forge-engine` (gitignored) |
| `run-engine.ps1` | run the jar with `.env` settings |
| `start-public.ps1` | engine + Cloudflare quick tunnel; publishes the URL to Supabase `app_config` |
| `battle-server.ps1` | Windows service wrapper (scheduled task + supervisor) |
| `logs/` | runtime logs (gitignored) |
