# FieldOS Nepal — Pilot Readiness Audit (Parts 1-2)
**Date:** 2026-06-06
**Auditor:** Claude Code automated audit

---

## PART 1 — Backend & Infrastructure Health Check

### 1.1 Backend Startup (fieldos-backend)

| Check | Status | Notes |
|-------|--------|-------|
| All routers wired in main.py | PASS | 20 routers: auth, devices, bootstrap, sync, tasks, clients, collections, visit, promise, meetings, eod, audit, manager, cbs, ai, voice_ai, security, pilot, announcements (x2) |
| CORS config | PASS | `CORS_ORIGINS=*` — allows mobile and dashboard |
| Health endpoint | PASS | Returns `{"status": "ok", "service": "FieldOS Nepal", ...}` |
| DB table creation (lifespan) | PASS | All 22 models imported in __init__.py, `Base.metadata.create_all` covers all |
| SQLite path | WARNING | .env sets `./fieldos_nepal.db` — runs from backend dir. Must ensure write permission on Windows |
| Sync entity types | PASS | 12 types: client, loan, collection, visit, visit_checkin, task, meeting, promise, eod, audit_event, kyc_document, voice_note |
| Manager dashboard KPIs | PASS | 9 real DB queries covering all KPIs |
| AI endpoints (4) | PASS — Rule-based SQL | priority-queue, suggestions, eod-summary, branch-summary — ALL query real DB. NOT Ollama-dependent |
| Voice AI (4) | PASS — Heuristic/local | transcribe (placeholder), cleanup (regex), summary (template), ask (keyword). None require external services |
| EOD report endpoint | PASS | Creates EndOfDayReport with all fields, sets is_confirmed=is_submitted=True |

### 1.2 Dashboard Startup (fieldos-dashboard)

| Check | Status | Notes |
|-------|--------|-------|
| Proxy route ([...path]) | PASS | Forwards to `BACKEND_URL/api/v1/` + auto-prefixes `manager/` for bare paths |
| Login flow | PASS | apiLogin → POST /api/fieldos/auth/login → stores token in localStorage |
| Auto-refresh (30s) | PASS | Dashboard KPIs + staff data refresh every 30s |
| Session persistence | PASS | Reads localStorage.fieldos_token on mount |

### 1.3 Mobile App Startup (fieldos-app)

| Check | Status | Notes |
|-------|--------|-------|
| Expo config (app.json) | PASS | All permissions: camera, fine/coarse location |
| API URL config | CONFIG_REQUIRED | Defaults to `http://localhost:8000/api/v1`. For pilot on phone, must set `EXPO_PUBLIC_API_URL=http://<LAPTOP_IP>:8000/api/v1` |
| Mock sync flag | PASS (OFF) | Defaults to OFF. Real sync used when configured |
| Token storage | PASS | SecureStore for access/refresh tokens |
| Token refresh on 401 | PASS | Auto-refresh flow implemented |
| Network error handling | PASS | Network errors don't mark events failed — they retry next sync cycle |

---

## PART 2 — Dashboard Live/Static Audit

### Every Dashboard Page Status

| Page | Status | Data Source | Pilot Ready? | Notes |
|------|--------|-------------|-------------|-------|
| Branch Overview | LIVE_CONNECTED | `GET /manager/dashboard` (real KPI queries) | YES | 9 real DB queries |
| Staff Activity | LIVE_CONNECTED | `GET /manager/staff` | YES | Real staff with visit/collection stats |
| Visit Completion | LIVE_CONNECTED | `GET /manager/visits` | YES | Real visit check-ins |
| Collection Progress | LIVE_CONNECTED | `GET /manager/collections` | YES | Real collections |
| PAR / Overdue Follow-up | LIVE_CONNECTED | `GET /manager/par-followup` | YES | Real overdue clients |
| Promise-to-Pay Due | LIVE_CONNECTED | `GET /manager/ptp-today` | YES | Real PTP records |
| Exceptions Queue | LIVE_CONNECTED | `GET /manager/exceptions` | YES | Real exceptions |
| End-of-Day Review | LIVE_CONNECTED | `GET /manager/eod-reviews` | YES | Real EOD reports |
| Sync Monitoring | LIVE_CONNECTED | `GET /manager/sync-status` | YES | Real pending count |
| Audit Logs | LIVE_CONNECTED | `GET /manager/audit-logs` | YES | Real audit trail |
| Assign Task | LIVE_CONNECTED | `POST /manager/tasks` | YES | Creates real task in DB |
| Announcements | LIVE_CONNECTED | `POST /manager/announcements` | YES | Creates real announcements |
| AI Insights (Priority Queue) | LIVE_CONNECTED | `GET /manager/ai/priority-queue` | PARTIAL | Badge says "Demo Reference" but data is real SQL. Label misleading. |
| AI Suggestions | LIVE_CONNECTED | `GET /manager/ai/suggestions` | PARTIAL | Same badge issue |
| AI EOD Summary | LIVE_CONNECTED | `GET /manager/ai/eod-summary` | PARTIAL | Same badge issue |
| AI Branch Summary | LIVE_CONNECTED | `GET /manager/ai/branch-summary` | PARTIAL | Same badge issue |
| CBS Client Data | LIVE_CONNECTED | `GET /cbs/clients` | YES | Real CBS data |
| CBS PAR Status | LIVE_CONNECTED | `GET /cbs/par-status` | YES | Real CBS data |
| Reconciliation Queue | LIVE_CONNECTED | `GET /cbs/reconciliation/queue` | YES | Real CBS data |
| CBS Postings & Audit | LIVE_CONNECTED | `GET /cbs/posting/log` | YES | Real CBS data |
| Threat Model | LIVE_CONNECTED | `GET /security/threat-model` | YES | Real threat model |
| Data Flow Diagram | LIVE_CONNECTED | `GET /security/data-flow` | YES | Real diagram |
| RBAC Matrix | LIVE_CONNECTED | `GET /security/rbac` | YES | Real matrix |
| Audit Log Export | LIVE_CONNECTED | `GET /security/audit-export` | YES | Real export |
| Incident Response | LIVE_CONNECTED | `GET /security/incident-response` | YES | Real plan |
| Policies | LIVE_CONNECTED | `GET /security/policies` | YES | Real policies |
| Pen Test Checklist | LIVE_CONNECTED | `GET /security/pen-test` | YES | Real checklist |
| Dependency Scan | LIVE_CONNECTED | `GET /security/dependency-scan` | YES | Real scan results |
| API Security Tests | LIVE_CONNECTED | `GET /security/api-tests` | YES | Real tests |
| Compliance Status | LIVE_CONNECTED | `GET /security/compliance` | PARTIAL | Verify endpoint returns real data |
| Pilot Overview | LIVE_CONNECTED | `GET /pilot/overview` | YES | Has "Pilot Reference" badge + mock fallback |
| Branch Readiness | LIVE_CONNECTED | `GET /pilot/branches` | YES | Real pilot data |
| Pilot Documents | HIDDEN | Commented out | POST_PILOT | No endpoint |
| Pilot Training | HIDDEN | Commented out | POST_PILOT | No endpoint |
| Pilot Metrics | HIDDEN | Commented out | POST_PILOT | No endpoint |
| Pilot Feedback | HIDDEN | Commented out | POST_PILOT | No endpoint |
| Pilot Escalations | HIDDEN | Commented out | POST_PILOT | No endpoint |
| Pilot Agreements | HIDDEN | Commented out | POST_PILOT | No endpoint |
| Device Management | HIDDEN | Commented out | POST_PILOT | "no real device data" |

### Critical Finding: AI Badge Mislabeling
AI sections carry "Demo Reference" badges but use **real SQL rule engines** connected to the backend. They do NOT use Ollama. They work with real data.

---

END OF PARTS 1-2
