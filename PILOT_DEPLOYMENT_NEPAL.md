# FieldOS Nepal — Realistic Pilot Deployment Guide

**Audience:** the person running the first branch pilot in Nepal.
**Goal:** get one branch live — field officers on phones, branch manager on the dashboard — with everything syncing, even on bad connectivity.

This guide is grounded in the end-to-end checks in `fieldos-backend/e2e_pilot_check.py`, which were run and pass 21/21 (task assignment → mobile, collections/visits/PTP/EOD → dashboard, officer attribution, GPS fields, KPIs, staff stats).

---

## 1. How the pieces connect

```
  Field officer phones (Expo / APK)          Branch manager (browser)
        │  offline-first SQLite                      │
        │  syncs JSON deltas over HTTP               │
        ▼                                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │  ONE SERVER (laptop/mini-PC at branch, or cloud VPS)       │
  │                                                            │
  │  FastAPI backend  :8000   ◄── phones POST here             │
  │  Next.js dashboard :3000  ── proxies to backend :8000      │
  │  Database: SQLite (pilot) or PostgreSQL (scale)            │
  │  AI: rule-based, in-process — no GPU, no internet          │
  └──────────────────────────────────────────────────────────┘
```

The dashboard never talks to the database directly — it calls the backend over HTTP through its proxy (`/api/fieldos/...` → `BACKEND_URL/api/v1/...`). The phones call the same backend. **One backend is the single source of truth.**

---

## 2. Choose your topology

### Option A — Branch LAN server (recommended for the first pilot)

One laptop or mini-PC sits at the branch. It runs the backend + dashboard. Phones join the **branch Wi-Fi router** (or the laptop's hotspot). **No internet is needed during the working day** — this matches Nepal field reality (intermittent 4G, load-shedding).

- **Pros:** works fully offline, instant LAN sync, zero hosting cost, no SSL/domain setup, data stays on-premise.
- **Cons:** manager must be on the same network; one branch only; you handle backups.
- **Hardware:** any laptop with 8GB RAM, or a mini-PC (Intel N100, 8GB). A Wi-Fi router covering the branch office.
- **Power:** put the server + router on a UPS/inverter — load-shedding will otherwise drop sync mid-day.

### Option B — Cloud VPS (when you add more branches)

A small VPS (DigitalOcean **Bangalore**, or AWS Mumbai) with a domain + auto-SSL. Phones sync over mobile data.

- **Pros:** multi-branch, manager works from anywhere, automatic.
- **Cons:** depends on each phone's 4G; needs domain + SSL + Postgres; ~$12–24/mo.
- **Spec:** 2 vCPU / 4 GB / 40 GB SSD is enough for the rule-based AI (no model server).

> **Start with Option A for the first branch.** Move to B only when the pilot succeeds and you onboard branch #2.

---

## 3. Server setup

### 3a. Backend

```bash
cd fieldos-backend
python -m venv venv && source venv/Scripts/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

`.env` (pilot defaults are fine; **change the JWT secret** before real data):

```bash
APP_ENV=production
DB_TYPE=sqlite                 # SQLite is fine for a single-branch pilot
SQLITE_PATH=./fieldos_nepal.db
JWT_SECRET_KEY=<run: openssl rand -hex 32>     # do NOT keep the dev value
ACCESS_TOKEN_EXPIRE_MINUTES=1440
CORS_ORIGINS=*                 # tighten to the dashboard origin on a VPS
```

Create/seed the DB, **apply migrations**, then run:

```bash
python seed.py                 # demo branch, officer FO-208, clients, centers
alembic upgrade head           # IMPORTANT on an existing DB — adds collection GPS columns (migration 003)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required so phones on the LAN can reach it (not just `localhost`).
Verify: `http://<SERVER_IP>:8000/health` → `{"status":"ok"}`.

> Migration note: a **fresh** database gets the columns automatically. An **existing** database (or production Postgres) must run `alembic upgrade head`, or every collection POST fails with `no column named gps_address`.

### 3b. Dashboard

```bash
cd fieldos-dashboard
npm install
BACKEND_URL=http://127.0.0.1:8000 npm run dev      # dev, or `npm run build && npm start` for standalone
```

Open `http://<SERVER_IP>:3000`, log in as the branch manager. `BACKEND_URL` tells the proxy where the backend is.

### 3c. Mobile app

Point the app at the **server's LAN IP** (not `localhost` — that means "the phone itself"):

`fieldos-app/.env`
```bash
EXPO_PUBLIC_API_URL=http://192.168.1.107:8000/api/v1   # replace with YOUR server's LAN IP
EXPO_PUBLIC_ENABLE_MOCK_SYNC=false
```

Find the server IP with `ipconfig` (Windows) / `ip addr` (Linux) — use the `192.168.x.x` Wi-Fi address.

For officers, build a real APK (no Expo Go, no laptop needed in the field):

```bash
cd fieldos-app
npx eas build --platform android --profile preview     # produces an installable .apk
```

Install the APK on each officer's phone. They only need the **branch Wi-Fi**, not internet.

---

## 4. AI working locally (and lightweight)

**The AI already runs locally with zero extra setup.** The priority queue, suggestions, EOD summary, branch summary, and the voice-note cleanup/summary/Q&A are **rule-based and heuristic, computed inside the FastAPI process from real SQL data**. There is:

- **no GPU requirement**, **no Ollama**, **no external API key**, **no internet call**;
- it runs on the same 4–8 GB box as the backend;
- it's deterministic and explainable — good for a regulated microfinance pilot.

This is the recommended pilot configuration. Leave it as-is.

**Optional upgrade (only if you want free-text narrative summaries):** install [Ollama](https://ollama.com) on an 8 GB+ machine and pull a small model (`qwen2.5:3b` or `llama3.2:3b`, ~2–3 GB). Wire the narrative endpoints to it and keep the rule-based path as the fallback. Trade-offs: +4–6 GB RAM, slower responses, less deterministic. **Not needed to pilot** — add it post-pilot if managers ask for richer prose.

**Lightweight on devices:**
- The phone does almost no AI work — scoring happens on the server. The app is offline-first SQLite + plain React Native screens.
- **Minimum phone:** Android 8 (API 26)+, 2 GB RAM, ~200 MB free. APK is ~30–50 MB.
- **Data usage:** sync sends small JSON deltas (a collection/visit is a few KB), so a day of fieldwork is well under a few MB. Reverse-geocoding an address uses GPS + an occasional small network call.
- **Battery:** GPS is captured only at check-in/collection, not continuously.

---

## 5. What to check before going live

### 5a. Automated (run on the pilot server, 2 minutes)

```bash
cd fieldos-backend
# backend must be running on :8000
venv/Scripts/python.exe e2e_pilot_check.py
# Expect: "21/21 checks passed"
```

This proves the real round-trip: manager assigns a task → it appears for the officer; officer records collection/visit/PTP/EOD → it appears on the manager dashboard with the right officer name, amount, method, GPS and KPIs. **Run it against the actual pilot server** before the first real day.

### 5b. Manual device checks (needs a real phone — can't be automated)

| Check | Where | Pass criteria |
|-------|-------|---------------|
| Login | App | FO-208 / 1234 → dashboard loads |
| Assign account/task | Dashboard → Assign Task → then app Tasks tab | New task shows on the phone |
| GPS visit check-in | App → task → Visit | Readable **address** shown (not raw lat/lng); blocked when location is OFF |
| Collection + receipt | App → Collect | Receipt has client, amount NPR, method, officer |
| Collection on dashboard | Dashboard → Collections | Appears within ~30s with officer name + amount |
| Offline queue | Turn Wi-Fi OFF, record a collection | Saved locally, Sync Center shows "pending" |
| Reconnect sync | Turn Wi-Fi ON → Sync | Queue drains; item appears on dashboard |
| EOD | App → End of Day | Submits once/day; shows under dashboard EOD |
| Nepali | App → language toggle | All text switches (i18n is at full 577-key parity) |
| Camera/KYC | App → Document | Camera opens, capture saves |

---

## 6. Running the pilot day-to-day

1. **Morning:** start the server + router (on UPS). Officers open the app on branch Wi-Fi, tap **Start Day**.
2. **Field:** officers work offline if they leave Wi-Fi range — everything queues locally.
3. **Back at branch:** rejoining Wi-Fi drains the sync queue automatically; manager sees collections/visits live (dashboard auto-refreshes ~30s).
4. **End of day:** each officer submits **EOD** (enforced once/day). Manager reviews under Operations → EOD.
5. **Backup (every evening):**
   - SQLite: copy `fieldos-backend/fieldos_nepal.db` to a USB drive and, when internet is available, to cloud storage.
   - Postgres: `pg_dump fieldos_nepal > backup_YYYYMMDD.sql`.

---

## 7. Common issues

| Symptom | Cause | Fix |
|--------|-------|-----|
| Phone can't reach server | App pointed at `localhost`, or different network | Set `EXPO_PUBLIC_API_URL` to the server's LAN IP; same Wi-Fi |
| Every collection 500s | DB not migrated | `alembic upgrade head` on the server DB |
| Dashboard shows "Backend unavailable" | Backend down or wrong `BACKEND_URL` | Start backend first; check `BACKEND_URL` |
| Collection shows no officer name | Old row created without `officer_id` | Real app collections always send it; fixed in current build |
| Sync stuck pending | Server unreachable mid-day | Items retry automatically on reconnect — no data lost |
| Mid-day data loss on power cut | Server/router lost power | Put both on a UPS/inverter |

---

## 8. Pilot readiness checklist

- [ ] Server reachable at `http://<IP>:8000/health` from a phone on branch Wi-Fi
- [ ] `alembic upgrade head` applied; `python seed.py` run
- [ ] `JWT_SECRET_KEY` changed from the dev default
- [ ] Dashboard loads and manager can log in
- [ ] APK installed on each officer phone, `.env` IP correct
- [ ] `e2e_pilot_check.py` → 21/21 on the pilot server
- [ ] Manual device checks (section 5b) all pass
- [ ] UPS/inverter on server + router
- [ ] Nightly backup tested (restore once to confirm)
- [ ] One officer + one manager trained on the daily flow
