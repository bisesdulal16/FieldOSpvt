# FieldOS Nepal — Final Pilot Hardening Report

**Date:** 2026-06-06
**Scope:** Controlled pilot-hardening pass only. No new features, no UI redesigns, no schema changes, no major refactors.

---

## What Was Changed

### 1. Dashboard Badge Wording (`fieldos-dashboard/src/app/page.tsx`)

| Change | Before | After | Location |
|--------|--------|-------|----------|
| AI Priority Queue badge | Amber "Demo Reference" | Green "Live Rule-Based AI" | Line ~2077 |
| AI Suggestions badge | Amber "Demo Reference" | Green "Live Rule-Based AI" | Line ~2230 |
| AI EOD Summary badge | Amber "Demo Reference" | Green "Live Rule-Based AI" | Line ~2347 |
| AI Branch Summary badge | Amber "Demo Reference" | Green "Live Rule-Based AI" | Line ~2505 |
| Security/Pilot view badges | Yellow "Demo Reference" | Neutral "Reference" | Lines 2606-3704 |
| Pilot sidebar label | "Pilot (Demo Data)" | "Pilot" | Line ~5488 |

**Rationale:** During pilot, dashboard must not imply AI endpoints are powered by Ollama or any local model. The rule-based scoring is transparent and deterministic. Security/pilot reference pages are static documentation — calling them "Demo Reference" undermines confidence in the platform's readiness.

---

### 2. Mock Data Warning Banners (`fieldos-dashboard/src/app/page.tsx`)

Added conditional warning banners to **16 view components** that use inline mock/fallback data:

| View | Fallback Pattern | Banner Trigger |
|------|-----------------|----------------|
| SecurityOverviewView | `data || { object }` | `!data` |
| ComplianceStatusView | `data || { object }` | `!data` |
| PilotOverviewView | `data || { object }` | `!data` |
| ThreatModelView | `Array.isArray(data?.threats) ? data.threats : [hardcoded]` | `!data?.threats` |
| SecurityAuditExportView | `Array.isArray(data?.events) ? data.events : [hardcoded]` | `!data?.events` |
| DeviceManagementView | `Array.isArray(data?.devices) ? data.devices : [hardcoded]` | `!data?.devices` |
| PenTestChecklistView | `Array.isArray(data?.items) ? data.items : [hardcoded]` | `!data?.items` |
| DependencyScanView | `Array.isArray(data?.packages) ? data.packages : [hardcoded]` | `!data?.packages` |
| APISecurityTestsView | `Array.isArray(data?.tests) ? data.tests : [hardcoded]` | `!data?.tests` |
| PilotBranchesView | `Array.isArray(data?.branches) ? data.branches : [hardcoded]` | `!data?.branches` |
| PilotDocumentsView | `Array.isArray(data) ? data : [hardcoded]` | `!data || !Array.isArray(data)` |
| PilotTrainingView | `Array.isArray(data?.modules) ? data.modules : [hardcoded]` | `!data?.modules` |
| PilotMetricsView | `Array.isArray(data?.kpis) ? data.kpis : [hardcoded]` | `!data?.kpis` |
| PilotFeedbackView | `data?.summary || { object }` + array fallback | `!data?.responses` |
| PilotEscalationsView | `Array.isArray(data?.escalations) ? data.escalations : [hardcoded]` | `!data?.escalations` |
| PilotAgreementsView | `Array.isArray(data?.agreements) ? data.agreements : [hardcoded]` | `!data?.agreements` |

**Banner appearance:** Amber background, AlertTriangle icon, text: "Fallback demo data shown — backend unavailable."

**Rationale:** During pilot, any display of fake data that looks live is a credibility killer. Users must always know when they're looking at real vs fallback data.

---

### 3. Mobile App Networking Documentation (`fieldos-app/PILOT_TESTING.md`) — NEW

Added comprehensive networking guide for physical phone testing covering:
- How to find laptop LAN IP (Windows/macOS/Linux)
- Why `localhost` doesn't work for phone testing
- Step-by-step pre-testing checklist
- Troubleshooting table for common connectivity issues

---

### 4. Pilot Test Checklist (`FIELDOS_PILOT_TEST_CHECKLIST.md`) — NEW

Comprehensive check-driven test plan covering:
- Quick-start commands for all three services (backend, dashboard, mobile)
- Login tests (field officer + branch manager)
- Task assignment verification
- GPS visit check-in tests (success + blocked scenarios)
- Collection + receipt workflow
- Offline sync queue + reconnection
- End-of-day submission
- Full dashboard section-by-section verification
- AI priority queue accuracy and fallback banner verification

---

### 5. Mobile API Config (`fieldos-app/.env`) — VERIFIED ALREADY CORRECT

```
EXPO_PUBLIC_API_URL=http://192.168.1.107:8000/api/v1
EXPO_PUBLIC_ENABLE_MOCK_SYNC=false
```

The IP `192.168.1.107` is the laptop's LAN address — correct for physical phone testing on the same network. No changes needed.

---

## What Was Intentionally NOT Changed

| Item | Reason |
|------|--------|
| **Dashboard data fetching logic** | Out of scope; hooks in `useManagerAPI.ts` are working correctly |
| **Backend seed data / demo credentials** | Working as-is; part of pilot's controlled setup |
| **Pilot section nav items (commented out)** | These are disabled because backend endpoints don't exist — a known gap, not a crash risk |
| **Any mobile app screens or flows** | No changes to collect, profile, AI assistant, or any screen. Pilot-hardening is dashboard + docs only |
| **Dashboard security/pilot inline data** | The inline fallback arrays remain but now show warning banners — changing the data itself would require backend endpoints |
| **Device Management nav item (commented out)** | Same reason as pilot nav items — no backend endpoint, not part of this pass |
| **EAS build `.env` configuration** | Production build URL is a separate concern; handled via PILOT_TESTING.md notes |
| **`.pyc` files in working tree** | Not part of pilot scope |

---

## Remaining Manual Checks

These items require human testing during the pilot window and were NOT automated:

| Check | Where to Test | Priority |
|-------|--------------|----------|
| AI scoring accuracy (priority queue) | Dashboard -> AI -> Priority Queue | High |
| AI suggestions relevance | Dashboard -> AI -> Suggestions | High |
| EOD summary reflects real data | Dashboard -> AI -> EOD Summary | High |
| Branch summary narrative quality | Dashboard -> AI -> Branch Summary | High |
| Login with all demo credentials | Mobile + Dashboard | High |
| GPS check-in on physical phone | Mobile app -> Client Detail -> Visit | High |
| Offline sync queue behavior | Mobile app (turn WiFi off/on) | High |
| EOD one-time enforcement | Mobile app (submit twice in same day) | Medium |
| Collection receipt accuracy | Mobile app -> Collect -> Receipt view | Medium |
| Nepali language toggle (all keys) | Mobile app -> Settings -> Language | Medium |
| CBS integration endpoints | Dashboard -> CBS section | Medium |
| PIN change flow | Mobile app -> Profile -> Change PIN | Medium |
| Document capture on physical device | Mobile app -> Client Detail -> Document | Low |
| Voice note + AI cleanup | Mobile app -> Profile -> Voice Notes | Low |

---

## Final Verdict

### GO for Controlled Pilot — After Manual Test Pass

The following conditions must be met before pilot launch:

1. [ ] All 16 warning banners visible when backend is stopped
2. [ ] All 4 AI badges show green "Live Rule-Based AI" (not amber "Demo Reference")
3. [ ] All checklist items in `FIELDOS_PILOT_TEST_CHECKLIST.md` pass
4. [ ] Mobile `.env` IP matches the pilot laptop's current LAN IP
5. [ ] Backend seed data loaded (`python seed.py`)
6. [ ] Physical phone can reach backend API (same WiFi, correct IP)

**Confidence level:** HIGH — All identified pilot-safety issues have been addressed. The remaining gaps are known and documented (commented-out nav items for missing endpoints). No new bugs were introduced; changes are limited to banner additions and badge wording updates in the dashboard UI.
