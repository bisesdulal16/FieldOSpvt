# FieldOS — Homelab Deployment (isolated VM / containers)

Run the whole app in containers on **one dedicated VM** so you can give a friend access to
*this stack only* — not your whole homelab. Everything is one `docker compose` command.

## What runs

| Container | Port | Purpose |
|-----------|------|---------|
| `fieldos-backend` | 8000 | FastAPI — mobile app + dashboard talk to this |
| `fieldos-dashboard` | 3000 | Next.js manager dashboard |
| `fieldos-postgres` | (internal) | Database — not exposed to the network |
| `fieldos-whisper` | 9000 | Self-hosted speech-to-text *(optional, profile `ai`)* |
| `fieldos-ollama` | 11434 | Self-hosted LLM for AI summaries *(optional, profile `ai`)* |

## 1. Isolate it (recommended)

Put this on its **own VM** (Proxmox/Multipass/a small Ubuntu VM), separate from the rest of your
homelab. Give collaborators access to *that VM only*:
- **Tailscale** (easiest): install on the VM, share just this machine with a friend's tailnet.
  They reach `http://<vm-tailscale-ip>:3000` and `:8000`; nothing else in your homelab is visible.
- or **Cloudflare Tunnel** to expose only `:3000`/`:8000` publicly, no ports opened on your router.
- Keep Postgres internal (the compose file does not publish 5432).

## 2. Install & run

Requires Docker + Docker Compose on the VM.

```bash
git clone https://github.com/bisesdulal16/FieldOSpvt.git
cd FieldOSpvt
cp .env.example .env
# EDIT .env — at minimum set POSTGRES_PASSWORD and JWT_SECRET_KEY:
#   python3 -c "import secrets; print(secrets.token_urlsafe(48))"

docker compose up -d --build          # app stack (backend + dashboard + postgres)
docker compose run --rm backend python seed_demo.py   # ONE-TIME demo data

# Optional: self-hosted AI (STT + LLM) on the same VM
docker compose --profile ai up -d --build
docker compose exec ollama ollama pull gemma2:2b      # first time only
```

Verify:
- `http://<vm-ip>:8000/health` → `{"status":"ok"}`
- `http://<vm-ip>:3000` → dashboard; log in `BM-001` / `1234`
- The backend auto-creates tables on first boot (no migration step needed).

## 3. Point the mobile app at the VM

In `fieldos-app/eas.json`, set the `preview` env `EXPO_PUBLIC_API_URL` to the VM's reachable URL:

```json
"EXPO_PUBLIC_API_URL": "http://<vm-lan-or-tailscale-ip>:8000/api/v1"
```

Then build the APK (the on-device face + voice + Gemma features need a real build — see
`fieldos-app/FACE_VOICE_SETUP.md`):

```bash
cd fieldos-app && eas build -p android --profile preview
```

## 4. Day-2 ops

```bash
git pull && docker compose up -d --build    # deploy an update
docker compose logs -f backend              # tail logs
docker compose exec postgres pg_dump -U fieldos fieldos_nepal > backup_$(date +%F).sql
```

## Notes
- `.env` is gitignored — never commit real secrets. Rotate `JWT_SECRET_KEY` per deployment.
- Without the `ai` profile, voice transcription returns empty (officer types) and AI
  cleanup/summary falls back to heuristics — nothing hard-fails.
- For a public deployment put Caddy/Traefik in front for HTTPS and set `CORS_ORIGINS` to your
  dashboard origin instead of `*`.
- History note (from STATUS.md): scrub the old dev secret from git history
  (`git-filter-repo`/BFG) before sharing the repo widely.
