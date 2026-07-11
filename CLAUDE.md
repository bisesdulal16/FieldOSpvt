# FieldOS Nepal — CLAUDE.md

> **Canonical project truth for Claude Code / Claude AI assistants.**
> Read `STATUS.md` alongside this file — it is the honest, verified map of what works, what is
> broken, and what does not exist. When STATUS.md and any older doc disagree, STATUS.md wins.

---

## Hard rules (read first)

1. **Close the golden path before opening anything new.** The pilot golden path is:
   *manager assigns task → officer logs in → sees due client → GPS visit check-in → record
   collection → digital receipt → collection shows on manager dashboard, attributed to the
   officer, with an audit entry.* Do not build features off this path until it works end-to-end.
2. **Loan origination now exists** (backend + dashboard). Lifecycle: officer registers a borrower
   (`POST /clients/`) → submits application (`POST /loans/applications`, status `pending`) →
   manager approves (`POST /loans/{loan_id}/approve`, RBAC) → manager disburses
   (`POST /loans/{loan_id}/disburse`) which generates the weekly repayment schedule and makes the
   borrower collectable. Approve/Disburse UI is the dashboard's **Loan Approvals** page. The
   officer-side registration/application *mobile screens* are not built yet (API-only).
3. **Do not fake offline sync, GPS, audit, or security.** If something is a stub, label it.
4. **No secrets in git.** `.env` files and `*.db` must be gitignored and untracked (they are
   currently tracked — fix pending; see STATUS.md §5). Never commit a new one.
5. **Multi-tenant / white-label SaaS is deferred to post-pilot.** Build one clean, brandable
   tenant. Do not add tenant tables, per-org theming infra, or billing before one MFI runs the
   workflow for real. **Branding is single-tenant + env-driven:** `GET /api/v1/branding` returns
   `ORG_NAME`/`ORG_TAGLINE`/`ORG_PRODUCT_SUFFIX`/colors/`ORG_LOGO_URL` from env; the dashboard
   (login + sidebar) and mobile login consume it. To rebrand, set the `ORG_*` env vars — no code
   change. Officer-side origination screens (`app/register-borrower.tsx`, `app/loan-application.tsx`)
   are built and reachable from the Tasks tab's "Register Borrower" button.

## Project Identity

- **Name:** FieldOS Nepal
- **Purpose:** Offline-first **workforce-operations + collections** app for Nepali microfinance
  field officers, plus a branch-manager dashboard. (NOT a loan-origination / core-banking system.)
- **Stack:** React Native (Expo SDK 54) + FastAPI (**Python 3.11 / 3.12 — NOT 3.14**) + Next.js 16
- **Language:** TypeScript (frontend), Python (backend)
- **i18n:** English + Nepali (~587 translation keys)
- **Currency:** NPR (Nepali Rupees)
- **Timezone:** Asia/Kathmandu (UTC+5:45) — see the timezone bug in STATUS.md §2 (collections
  stamped UTC, dashboard filters server-local → "today" numbers wrong).
- **Brand Colors:** Navy `#0B1B3A`, Orange `#F59E0B`, Green `#16A34A`, Red `#DC2626`
- **Actual size (measured 2026-07-10):** ~50 mobile screen files, **90 API endpoints**
  (~15 on the golden path; the rest serve CBS/security/pilot/AI pages, many of which render
  static reference content — see STATUS.md §3).
- **Status:** **Golden path closes end-to-end** (verified 2026-07-10): origination →
  field collection → receipt → manager dashboard → audit. Security floor is 5/5 for pilot size
  (auth, RBAC, bcrypt, server-side audit, secrets untracked). Remaining before a real pilot:
  officer-side origination mobile screens, brandable config, git-history secret scrub,
  Postgres for multi-branch. See STATUS.md (top) and PILOT.md.
- **Timezone:** all timestamps + "today" filters use Asia/Kathmandu via `app/utils/nepal_time.py`.
  Never use `date.today()`/`datetime.utcnow()` for business dates — use `today_nepal_str()` /
  `now_nepal_iso()` / `to_nepal_iso()`.
- **Auth:** field endpoints require a JWT via `Depends(get_current_user)`; derive `officer_id`
  from `current_user.id`, never trust it from the request body. Manager/approval routes use
  `require_manager_or_admin`. Log sensitive actions with `write_audit(...)` (app/services/audit_helper.py).
- **Database:** SQLite by default (`DB_TYPE=sqlite`); Postgres-ready and verified end-to-end
  (`DB_TYPE=postgres` + `DATABASE_URL=postgresql+asyncpg://...?ssl=require`, e.g. Neon free tier).
  Store timestamps at **seconds precision** (the nepal_time helpers do this) so they fit the
  `String(30)` columns on Postgres. See DEPLOY.md for hosting (Neon + Fly.io + Vercel + EAS).
- **Office-network day-start gate:** `POST /day-start` checks the request source IP (X-Forwarded-For
  aware) against `Branch.office_ip` (comma-separated; empty = disabled) → 403 when off-network, so
  officers can only start their day at the branch. Captures a front-camera selfie + GPS; manager
  views it at `/manager/day-starts` → dashboard "Day-Start Attendance". Mobile: `dayStartService.ts`
  + `handleStartDay` on the Home Start Day button. In prod the manager registers the branch's real
  public IP; selfies are base64 in `day_start_records` for the pilot (use object storage in prod).
- **Anti-fraud SMS receipt (the wedge):** every collection auto-sends the client an SMS with the
  exact recorded amount, **server-side on both the direct-POST and offline-sync paths** (officer
  can't skip it). `app/services/sms_service.py` — provider `log` (dev, no gateway) or `sparrow`
  (Nepal prod, set `SMS_PROVIDER`/`SMS_API_TOKEN`). Logged in `sms_notifications`; manager sees it
  at `/manager/receipts` → dashboard "Client Receipts". Clients are reached by SMS, **not** a
  smartphone app (rural/basic-phone reality).

## Actual folder names (the older structure diagram below is WRONG)

The three projects live at `fieldos-app/` (mobile), `fieldos-backend/` (FastAPI),
`fieldos-dashboard/` (Next.js) — **not** `fieldos-nepal-expo/` etc. Use these names.

---

## Architecture

```
┌──────────────────┐       HTTPS/REST       ┌──────────────────────┐
│   MOBILE APP      │ ◄───────────────────► │   FASTAPI BACKEND     │
│   (Expo SDK 54)   │                       │   (Python, port 8000) │
│                   │                       │                      │
│  16 screens       │   Sync Queue          │  91 API endpoints    │
│  SQLite on device │  ──────────────────►  │  JWT + RBAC          │
│  Offline-first    │                       │  SQLite (dev) / PG   │
│  expo-router      │                       │  Alembic migrations   │
└──────────────────┘                       └──────────┬───────────┘
                                                      │
                                           API        │
                                                      ▼
                                           ┌──────────────────────┐
                                           │  MANAGER DASHBOARD    │
                                           │  (Next.js 16, p:3000)│
                                           │                      │
                                           │  40+ views           │
                                           │  shadcn/ui           │
                                           │  Sidebar navigation  │
                                           └──────────────────────┘
```

---

## Project Structure

```
project-root/
│
├── fieldos-nepal-expo/          # Mobile app (React Native + Expo)
│   ├── app/                     # Expo Router screens
│   │   ├── (auth)/login.tsx     #   Login screen
│   │   ├── (tabs)/              #   Tab navigation screens
│   │   │   ├── index.tsx        #     Dashboard
│   │   │   ├── tasks.tsx        #     Task list
│   │   │   ├── meetings.tsx     #     Center meetings
│   │   │   ├── collect.tsx      #     Record collection
│   │   │   └── profile.tsx      #     Profile + settings
│   │   ├── client-detail.tsx    #   Client detail view
│   │   ├── visit-checkin.tsx    #   Visit check-in (GPS)
│   │   ├── record-collection.tsx#   Collection recording
│   │   ├── receipt.tsx          #   Digital receipt
│   │   ├── promise-to-pay.tsx   #   PTP recording
│   │   ├── center-meeting.tsx   #   Meeting attendance
│   │   ├── end-of-day.tsx       #   EOD report
│   │   ├── document-capture.tsx #   KYC document capture
│   │   ├── voice-notes.tsx      #   Voice notes (text + AI)
│   │   ├── ai-assistant.tsx     #   AI chat assistant
│   │   ├── ai-suggestions.tsx   #   AI priority suggestions
│   │   ├── sync-center.tsx      #   Sync queue viewer
│   │   ├── audit-logs.tsx       #   Audit trail viewer
│   │   ├── security-center.tsx  #   Security controls
│   │   ├── notifications.tsx    #   Notifications list
│   │   ├── change-pin.tsx       #   PIN change screen
│   │   └── _layout.tsx          #   Root layout (DB init, i18n)
│   ├── components/fieldos/      # Reusable UI components (16)
│   ├── constants/               # Theme: colors, fontSize, spacing
│   ├── i18n/                    # English (en.ts) + Nepali (ne.ts)
│   ├── services/                # Business logic layer (10 modules)
│   ├── store/                   # Zustand state management
│   ├── db/                      # SQLite schema, migrations, repos
│   ├── types/                   # TypeScript interfaces
│   └── app.json                 # Expo configuration
│
├── fieldos-nepal-backend/       # Backend API (FastAPI)
│   ├── app/
│   │   ├── main.py              # App entry point
│   │   ├── config.py            # Settings (DB, JWT, CORS)
│   │   ├── database.py          # SQLAlchemy async engine
│   │   ├── models/              # 13 SQLAlchemy models
│   │   ├── schemas/             # Pydantic request/response models
│   │   ├── routers/             # 15 router modules (91 endpoints)
│   │   ├── services/            # Business logic services
│   │   ├── middleware/          # Rate limiter, audit, security headers
│   │   └── deps/                # Dependency injection (auth)
│   ├── alembic/                 # Database migrations
│   ├── alembic.ini              # Alembic config
│   ├── seed.py                  # Demo data seeder
│   ├── requirements.txt         # Python dependencies
│   └── start-backend.js         # Node.js launcher script
│
├── fieldos-nepal-dashboard/     # Manager Dashboard (Next.js 16)
│   ├── src/
│   │   ├── app/                 # Next.js App Router pages
│   │   ├── components/          # React components
│   │   │   ├── ui/              #   shadcn/ui components (50+)
│   │   │   └── fieldos/         #   FieldOS custom components
│   │   ├── store/               # Client-side state
│   │   ├── lib/                 # Utilities, DB client
│   │   └── hooks/               # Custom React hooks
│   ├── prisma/                  # Prisma schema
│   ├── package.json             # Node dependencies
│   └── next.config.ts           # Next.js configuration
│
├── CLAUDE.md                    # THIS FILE
└── README.md                    # General project README
```

---

## How to Run Locally (Testing Before Pilot)

### Prerequisites

| Tool | Min Version | Check with |
|------|-------------|------------|
| Python | 3.11+ | `python3 --version` |
| pip | 23+ | `pip3 --version` |
| Node.js | 20+ | `node --version` |
| npm | 10+ | `npm --version` |
| Expo Go app | Latest | Install from App Store / Play Store |

### Startup Order — Follow This Sequence

#### Terminal 1: Backend (port 8000)

```bash
cd fieldos-backend

# Create + activate virtual environment — MUST be Python 3.11 or 3.12 (3.14 breaks pydantic)
python3.12 -m venv venv
source venv/bin/activate          # Mac/Linux
# venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Seed the canonical PILOT DEMO dataset (DESTRUCTIVE — drops + rebuilds all tables):
#   1 branch, 2 officers (FO-208/FO-209) + manager (BM-001), 15 Nepali-named borrowers,
#   loans in mixed states incl. one delinquent, 2 pending applications, 1 approved.
rm -f fieldos_nepal.db
python seed_demo.py
# (Legacy: seed.py + seed_manager.py create a smaller 6-client dataset.)

# Start the server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Verify:
- `http://localhost:8000/health` → `{"status":"ok"}`
- `http://localhost:8000/docs` → Swagger API documentation

#### Terminal 2: Dashboard (port 3000)

```bash
cd fieldos-dashboard

npm install
npm run dev
```

Verify: `http://localhost:3000` → Manager dashboard loads

#### Terminal 3: Mobile App (port 8081)

```bash
cd fieldos-app

npm install
npx expo start
```

Verify: Scan the QR code with Expo Go on your phone (same WiFi).

**On an emulator/simulator without a paid Expo login, add `--offline`** (the manifest-signing
step otherwise hangs in non-interactive/CI shells):
```bash
CI=1 EXPO_OFFLINE=1 npx expo start --go --offline
# Android emulator: forward the backend so the app's 127.0.0.1 reaches your host:
adb reverse tcp:8000 tcp:8000 && adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```

If QR doesn't work (different network): `npx expo start --tunnel`.

> Note: the app declares `expo-dev-client` + `expo-llm-mediapipe`, so `npx expo start` defaults
> to a dev build. Use `--go` to force Expo Go (the on-device LLM then falls back to heuristics —
> fine for the golden path). STATUS.md §6 recommends removing `expo-llm-mediapipe` for pilot.

### Demo Credentials

| Role | Staff ID | PIN | Used In |
|------|----------|-----|---------|
| Field Officer | `FO-208` | `1234` | Mobile app + API (verified) |
| Branch Manager | `BM-001` | `1234` | Dashboard + API (verified) |

### Seed Data Summary

After running `python seed.py`:
- 1 branch: Kathmandu Main Branch
- 1 field officer: Ram Bahadur Shah (FO-208)
- 6 clients: Sita, Maya, Gita, Laxmi, Kamala, Saraswoti
- 6 loan accounts
- 6 task assignments (mix of collection, follow_up, visit)
- 3 centers: Kalanki, Swoyambhu, Balaju

---

## Testing Checklists

### Mobile App (Expo Go) — Must-Pass Tests

```
[ ] Login with FO-208 / 1234 → Dashboard loads
[ ] Dashboard shows summary cards (visits, collections, tasks)
[ ] Tap "Start Day" → green banner, button changes to "Day Started"
[ ] Tasks tab → 6 tasks listed with client cards
[ ] Search bar in Tasks → filters by client name / member ID
[ ] Tap a task → Client Detail screen opens
[ ] Client Detail → shows loan info, outstanding balance, due amount
[ ] Client Detail → "Visit" button → GPS captured, readable address shown
[ ] Client Detail → "Collect" button → enter amount → receipt generated
[ ] Client Detail → "PTP" button → date picker, amount, save
[ ] Client Detail → "Document" → camera opens for KYC capture
[ ] Meetings tab → center meeting attendance tracking
[ ] End of Day → submit EOD report → one-time per day enforced
[ ] Sync Center → shows pending sync items
[ ] Profile → Audit Logs → events listed with timestamps
[ ] Profile → Security Center → compliance score shown
[ ] Profile → Change PIN → new PIN set successfully
[ ] Profile → Voice Notes → create/edit note, AI cleanup
[ ] Dashboard → AI Assistant → chat responses received
[ ] Dashboard → AI Suggestions → urgency-filtered cards
[ ] Switch language to Nepali → ALL text changes (no English remaining)
[ ] GPS check-in BLOCKED when location services off
[ ] Visit check-in → shows address name, NOT raw coordinates
[ ] Turn off internet → actions save locally → Sync Center shows queued items
[ ] Turn internet back on → Sync → items drain from queue
[ ] Document capture → "Choose from Gallery" button text aligned
[ ] Security Center → both "View Policy" and "Export" buttons visible
[ ] Back navigation works on all sub-screens
```

### Backend API — Quick Smoke Test

```bash
# Health check
curl http://localhost:8000/health

# Login
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"staff_id":"FO-208","pin":"1234"}'
# Copy the access_token from the response

# Bootstrap (replace TOKEN)
curl http://localhost:8000/api/v1/mobile/bootstrap \
  -H "Authorization: Bearer TOKEN"
# Should return user + clients + tasks

# Today's tasks
curl http://localhost:8000/api/v1/tasks/today \
  -H "Authorization: Bearer TOKEN"

# Record a collection
curl -X POST http://localhost:8000/api/v1/collections/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id":1,"amount":2500,"payment_method":"cash"}'
```

### Dashboard — Verify Each Section

```
[ ] Login → Dashboard overview with summary cards
[ ] Operations → Staff View, Tasks, Collections, Visits, PAR, EOD
[ ] CBS → CBS Clients, PAR Status, Reconciliation, Postings
[ ] AI → Priority Queue, Suggestions, EOD Summary, Branch Summary
[ ] Security → Compliance Overview, Threat Model, RBAC Matrix
[ ] Pilot → Overview, Branches, Documents, Training, Metrics
```

---

## Coding Conventions

### Mobile App (Expo)

```typescript
// File location convention for imports from app/ subdirectories:
// Files in app/*.tsx (directly in app/) use: from '../constants'
// Files in app/(tabs)/*.tsx or app/(auth)/*.tsx use: from '../../constants'

// Component pattern — functional with hooks
export default function ScreenName() {
  const router = useRouter();
  const { t } = useTranslation();
  // ...
}

// i18n — ALWAYS use translation keys, never hardcode strings
<Text>{t('screenTitle')}</Text>          // Correct
<Text>Hello</Text>                        // WRONG — will break Nepali toggle

// Style — use constants from '../constants', never magic numbers
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: spacing.lg },
});

// GPS — always use Location.reverseGeocodeAsync() for readable addresses
// Never display raw lat/lng coordinates to users

// Navigation — use expo-router, always provide back button on sub-screens
<AppHeader title={t('title')} showBack />
```

### Backend (FastAPI)

```python
# Router pattern
@router.get("/endpoint")
async def handler(param: str = Query(...), db: AsyncSession = Depends(get_db)):
    ...

# Response format — always use FieldOSResponse
return FieldOSResponse(success=True, data=result)

# Error responses
raise HTTPException(status_code=400, detail=FieldOSResponse(
    success=False, error={"code": "VALIDATION_ERROR", "message": "..."}
))

# New endpoints must be added in app/main.py router list
```

### Dashboard (Next.js)

```typescript
// shadcn/ui components only — never build custom from scratch
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Responsive design mandatory
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

---

## Configuration & Environment

### Backend .env (create from scratch if missing)

```bash
# fieldos-nepal-backend/.env
APP_ENV=development
DB_TYPE=sqlite                              # Use "postgres" for production
SQLITE_PATH=./fieldos_nepal.db              # Only for DB_TYPE=sqlite
JWT_SECRET_KEY=REDACTED_ROTATED_SECRET
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
REFRESH_TOKEN_EXPIRE_DAYS=7
CORS_ORIGINS=*
```

### Database

- **Development:** SQLite (zero config, file-based) — DB created at `SQLITE_PATH`
- **Production:** PostgreSQL 16 — set `DB_TYPE=postgres` + `DATABASE_URL`
- **Migrations:** `alembic upgrade head` (run after pulling schema changes)
- **Seed:** `python seed.py` (idempotent — safe to run multiple times)

### Key Ports

| Service | Port | URL |
|---------|------|-----|
| Backend API | 8000 | http://localhost:8000 |
| Swagger Docs | 8000 | http://localhost:8000/docs |
| Dashboard | 3000 | http://localhost:3000 |
| Expo Dev Server | 8081 | Scan QR in Expo Go |
| AI Mini-Service | 3003 | Optional (voice AI proxy) |

---

## Common Issues & Fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| `Unable to resolve module ../../constants` | Wrong import depth in app/*.tsx | `../../` → `../` for files directly in `app/` |
| GPS check-in works without location | Missing GPS gate | Block when `gpsStatus !== 'success'` |
| Keyboard covers button on iOS | Missing ScrollView wrapper | Wrap form in `<ScrollView keyboardShouldPersistTaps="handled">` |
| Search bar not filtering | Static placeholder View | Replace with real `<TextInput>` + filtering logic |
| Language toggle shows English | Hardcoded strings | Use `t('key')` for every user-facing string |
| Button text clipped off-screen | `width: '100%'` on button | Wrap in `<View style={{ flex: 1 }}>` container |
| Expo Go can't connect | Different network | Use `npx expo start --tunnel` |
| Port 8000 already in use | Previous process | `lsof -i :8000` → kill process |
| Backend 500 on startup | Missing DB tables | Run `python seed.py` or `alembic upgrade head` |
| Dashboard blank / error | Backend not running | Start backend first, then dashboard |
| `pip install` fails | Outdated pip | `pip install --upgrade pip` first |

---

## Pre-Pilot Deployment (Production)

### For Nepal VPS Deployment:

1. **Server:** 2 vCPU, 4GB RAM, 40GB SSD (DigitalOcean Mumbai ~$12/mo)
2. **Database:** Switch from SQLite to PostgreSQL 16
3. **SSL:** Caddy reverse proxy with auto-SSL (Let's Encrypt)
4. **Process Manager:** PM2 for Node services, systemd for Python
5. **Backups:** Daily SQLite dump or PostgreSQL pg_dump to S3

### Production .env:

```bash
APP_ENV=production
DB_TYPE=postgres
DATABASE_URL=postgresql+asyncpg://fieldos:PASSWORD@localhost:5432/fieldos_nepal
JWT_SECRET_KEY=<generate-64-char-random-string>
CORS_ORIGINS=https://fieldos.yourdomain.com.np,https://dashboard.yourdomain.com.np
```

### Mobile App Production Build:

```bash
# Create .env in expo folder
EXPO_PUBLIC_API_URL=https://fieldos.yourdomain.com.np
EXPO_PUBLIC_ENABLE_MOCK_SYNC=false

# Build APK for Android distribution
npx eas build --platform android --profile preview
```

---

## API Endpoint Reference (91 Total)

### Authentication
- `POST /api/v1/auth/login` — PIN login → JWT tokens
- `POST /api/v1/auth/refresh` — Refresh access token
- `POST /api/v1/auth/biometric` — Biometric login

### Mobile
- `GET /api/v1/mobile/bootstrap` — Full offline bootstrap (user + clients + tasks)
- `GET /api/v1/tasks/today` — Today's task list
- `GET /api/v1/tasks/` — Paginated tasks
- `GET /api/v1/clients/` — Client search
- `GET /api/v1/clients/{id}` — Client detail with loans

### Field Actions
- `POST /api/v1/collections/` — Record collection
- `POST /api/v1/visit-checkins/` — Record visit check-in
- `POST /api/v1/promise-to-pay/` — Record PTP
- `POST /api/v1/meetings/` — Record center meeting
- `POST /api/v1/end-of-day/` — Submit EOD report

### Sync & Audit
- `POST /api/v1/sync/events` — Batch sync events
- `GET /api/v1/sync/status` — Sync status
- `POST /api/v1/audit-events/` — Batch audit events
- `GET /api/v1/audit-events/` — Query audit trail

### Devices
- `POST /api/v1/devices/register` — Register device
- `POST /api/v1/devices/heartbeat` — Device heartbeat

### Manager (Requires Manager+ role)
- `GET /api/v1/manager/dashboard` — Overview stats
- `GET /api/v1/manager/staff` — Staff list
- `GET /api/v1/manager/visits` — Visit logs
- `GET /api/v1/manager/collections` — Collection records
- `GET /api/v1/manager/ptp-today` — Today's PTPs
- `GET /api/v1/manager/par-followup` — PAR analysis
- `GET /api/v1/manager/eod-reviews` — EOD submissions
- `GET /api/v1/manager/exceptions` — Exceptions

### CBS Integration (15 endpoints)
- `GET /api/v1/cbs/summary` — CBS overview
- `GET /api/v1/cbs/clients` — CBS client list
- `POST /api/v1/cbs/import` — Import CBS data
- `GET /api/v1/cbs/par-status` — PAR status
- `GET /api/v1/cbs/reconciliation/queue` — Reconciliation queue
- ... (see /docs for full list)

### AI (4 endpoints)
- `GET /api/v1/manager/ai/priority-queue` — AI priority scoring
- `GET /api/v1/manager/ai/suggestions` — AI suggestions
- `GET /api/v1/manager/ai/eod-summary` — Auto EOD summary
- `GET /api/v1/manager/ai/branch-summary` — Branch narrative

### Security (14 endpoints)
- `GET /api/v1/security/compliance-status` — Compliance score (82/100)
- `GET /api/v1/security/threat-model` — STRIDE threat model
- `GET /api/v1/security/pen-test-checklist` — OWASP pen test (27 cases)
- ... (see /docs for full list)

### Pilot (20 endpoints)
- `GET /api/v1/pilot/overview` — Pilot status
- `GET /api/v1/pilot/branches` — Branch readiness
- `GET /api/v1/pilot/documents/{doc_id}` — 9 pilot documents
- `POST /api/v1/pilot/feedback` — Submit feedback
- ... (see /docs for full list)

### Voice AI (4 endpoints)
- `POST /api/v1/voice-ai/transcribe` — Speech-to-text
- `POST /api/v1/voice-ai/cleanup` — Text cleanup
- `POST /api/v1/voice-ai/summary` — Visit summary
- `POST /api/v1/voice-ai/ask` — AI assistant

### System
- `GET /health` — Health check
- `GET /docs` — Swagger UI (dev only)
- `GET /openapi.json` — OpenAPI spec

---

## Zip Artifacts Reference

| File | Contents | Use For |
|------|----------|---------|
| `fieldos-nepal-expo-latest.zip` | Mobile app source (93 files) | Expo Go testing, builds |
| `fieldos-nepal-backend.zip` | FastAPI backend (67 files) | API server deployment |
| `fieldos-nepal-dashboard.zip` | Next.js dashboard (77 files) | Manager dashboard deployment |
| `fieldos-nepal-complete.zip` | All three + CLAUDE.md | Full project archive |

---

## Assistant Instructions for Claude

When helping with this project, follow these rules:

1. **Never hardcode user-facing strings.** Always use `t('translationKey')` and add the key to both `i18n/en.ts` and `i18n/ne.ts`.

2. **Never use `../../` imports in files directly in `expo/app/`.** Those files are only 1 level deep — use `../`. Files in `app/(tabs)/` and `app/(auth)/` correctly use `../../` (2 levels deep).

3. **Always use shadcn/ui components** on the dashboard. Never build buttons, cards, or inputs from scratch.

4. **GPS coordinates must never be shown raw to users.** Always use `Location.reverseGeocodeAsync()` for readable addresses.

5. **Check-in must require GPS.** Block submission if `gpsStatus !== 'success'`.

6. **Mobile forms must use ScrollView** with `keyboardShouldPersistTaps="handled"` to prevent iOS keyboard from covering buttons.

7. **Backend changes** need corresponding updates to `app/main.py` router list and `alembic` migrations for schema changes.

8. **Test in Expo Go** after any mobile change. The import path fix (../../ vs ../) is the most common crash cause.

9. **When creating new screens**, follow the pattern in existing screens: AppHeader, useTranslation, constants from '../constants', StyleSheet at bottom.

10. **Color restriction:** Never use indigo or blue colors unless explicitly requested. Use the brand palette (navy, orange, green, red).
