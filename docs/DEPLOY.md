# FieldOS — DEPLOY.md

How to take FieldOS from local to a hosted, field-testable pilot. The code is verified to run
on Postgres (not just SQLite); the steps below are the account-gated parts you run yourself.

**Architecture in production:** Neon (Postgres) ← FastAPI backend (a host) ← Next.js dashboard
(Vercel) + Expo mobile app (EAS build, points at the backend URL).

---

## 1. Database — Neon (free)

1. Sign up at neon.tech, create a project (pick the region closest to Nepal — Singapore/Mumbai).
2. Copy the connection string. Neon gives a `postgresql://...` URL. For this backend
   (SQLAlchemy + **asyncpg**) rewrite it as:
   ```
   postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME?ssl=require
   ```
   - Change the scheme to `postgresql+asyncpg://`.
   - Use `?ssl=require` (asyncpg's flag), **not** `?sslmode=require` (that's psycopg's and will error).
3. That value becomes `DATABASE_URL` for the backend (below).

## 2. Backend — FastAPI (Fly.io free, or Render)

The repo has a `Dockerfile`. Either host works; Fly stays warmer than Render's free tier.

**Fly.io:**
```bash
cd fieldos-backend
fly launch --no-deploy            # creates fly.toml; pick the Singapore/bom region
fly secrets set \
  DB_TYPE=postgres \
  DATABASE_URL="postgresql+asyncpg://USER:PASS@HOST/DB?ssl=require" \
  JWT_SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  CORS_ORIGINS="https://YOUR-DASHBOARD.vercel.app" \
  ORG_NAME="<Institution Name>" ORG_TAGLINE="<Tagline>"
fly deploy
```
One-time DB setup (run against the hosted DB, locally with the same env):
```bash
DB_TYPE=postgres DATABASE_URL="...neon url..." python seed_demo.py   # or a real-data seed
```
Verify: `curl https://YOUR-BACKEND.fly.dev/health` → `{"db":"postgres", ...}`.

**Render alternative:** New Web Service → point at `fieldos-backend`, Docker, add the same env
vars. Note the free instance sleeps after 15 min (≈50s cold start) — fine for demos, upgrade to
the ~$7/mo instance for a real pilot so field officers never wait.

## 3. Dashboard — Vercel (free)

```bash
cd fieldos-dashboard
# In Vercel: import the repo, set root dir to fieldos-dashboard
# Env vars:
#   BACKEND_URL = https://YOUR-BACKEND.fly.dev
#   NEXT_PUBLIC_API_URL = https://YOUR-BACKEND.fly.dev
vercel --prod
```
The dashboard proxies `/api/fieldos/*` → `BACKEND_URL`, so only the dashboard origin needs to be
in the backend's `CORS_ORIGINS`.

## 4. Mobile app — EAS build (Android APK for the pilot)

```bash
cd fieldos-app
# .env for the build:
#   EXPO_PUBLIC_API_URL=https://YOUR-BACKEND.fly.dev/api/v1
#   EXPO_PUBLIC_ENABLE_MOCK_SYNC=false
eas build --profile preview --platform android     # produces an installable APK
```
Hand officers the APK (or a link from expo.dev). Because the backend is now hosted over HTTPS,
the LAN/`adb reverse` gymnastics from local dev are gone — the phone just needs internet.

## 5. Branding per institution

No code change — set the `ORG_*` env vars on the backend (§2). `ORG_NAME`, `ORG_TAGLINE`,
`ORG_PRODUCT_SUFFIX`, `ORG_PRIMARY_COLOR`, `ORG_ACCENT_COLOR`, `ORG_LOGO_URL` flow to the
dashboard login/sidebar and the mobile login via `GET /api/v1/branding`.

---

## Cost summary

| Piece | Free option | Paid-but-cheap (recommended for a real pilot) |
|-------|-------------|-----------------------------------------------|
| Postgres | Neon free (0.5 GB) | Neon paid or a $6/mo managed PG |
| Backend | Fly.io free / Render free (sleeps) | Fly.io / Render ~$7/mo (always on) |
| Dashboard | Vercel free | Vercel free is fine |
| Mobile | EAS free build quota | EAS paid if you build a lot |

**Reality check:** free tiers sleep and cold-start. For *your* demos, go fully free. For an
*institution's daily operations*, spend the ~$13/mo total — your survey warns that sync failures
and waits destroy trust, and a backend that naps mid-morning is exactly that.

## Migration notes (already handled in code)

- Backend is Postgres-ready via `DB_TYPE=postgres` + `DATABASE_URL` (verified end-to-end).
- `asyncpg` is in `requirements.txt`.
- Timestamps are stored at seconds precision so they fit the string columns on Postgres
  (SQLite ignored the length; Postgres enforces it).
- `Base.metadata.create_all` builds the schema on first boot; `seed_demo.py` populates demo data.
  For schema changes over time, use the existing Alembic setup (`alembic upgrade head`).
