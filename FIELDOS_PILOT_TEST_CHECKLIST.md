# FieldOS Nepal — Pilot Test Checklist

## Quick Start Commands

### Backend (Terminal 1)
```bash
cd fieldos-backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Verify: curl http://localhost:8000/health -> {"status":"ok"}
```

### Dashboard (Terminal 2)
```bash
cd fieldos-dashboard
npm install
npm run dev
# Verify: open http://localhost:3000
```

### Mobile App (Terminal 3)
```bash
cd fieldos-app
npm install
npx expo start
# Verify: scan QR with Expo Go on your phone
```

---

## Login Tests

### [ ] Field Officer Login
- **Credentials:** `FO-208` / `1234`
- **Action:** Enter in mobile app login screen
- **Expected:** Dashboard loads with summary cards (visits, collections, tasks)
- **Verify:** All summary numbers are non-zero, AI assistant responds

### [ ] Branch Manager Login
- **Credentials:** `BM-001` / `(seeded PIN)` - check seed.py for exact value
- **Action:** Enter in dashboard login at http://localhost:3000
- **Expected:** Dashboard overview with summary cards loads
- **Verify:** Operations, CBS, AI, Security, Pilot nav items visible

---

## Task Assignment Test

### [ ] Assign a Task to Field Officer
- **Path:** Dashboard -> Operations -> Tasks -> Create new task
- **Action:** Assign a "collection" task to Ram Bahadur Shah (FO-208) for a client
- **Expected:** Task appears in mobile app's Tasks tab
- **Verify:** Client card shows correct loan info, outstanding balance

---

## Visit / Location Test

### [ ] GPS Visit Check-in
- **Path:** Mobile app -> Tasks -> Tap any task -> "Visit" button
- **Action:** Submit visit check-in with live GPS
- **Expected:** Green success banner, readable address displayed (not raw coordinates)
- **Verify:**
  - Location services are ON on the phone
  - Address is human-readable (reverse geocoded)
  - Visit appears in dashboard under Operations -> Visits

### [ ] GPS Blocked When Location Off
- **Action:** Turn off location services on phone -> try check-in
- **Expected:** Submission blocked with clear message
- **Verify:** Cannot submit without GPS

---

## Collection + Receipt Test

### [ ] Record a Collection
- **Path:** Mobile app -> Client Detail -> "Collect" button
- **Action:** Enter amount (e.g., NPR 2,500), select payment method
- **Expected:** Digital receipt generated with:
  - Client name, date/time, amount in NPR
  - Payment method displayed
  - Collector name (Field Officer)

### [ ] Collection Appears in Dashboard
- **Path:** Dashboard -> Operations -> Collections
- **Expected:** Recent collection listed with full details
- **Verify:** Amount matches what was entered on mobile

---

## Offline Sync Test

### [ ] Queue Items Locally
- **Action:** Turn off WiFi on phone -> record a PTP or collection
- **Expected:** Action saves locally, sync center shows queued items
- **Verify:** At least 1 item in sync queue with status "pending"

### [ ] Sync After Reconnection
- **Action:** Turn WiFi back on -> tap "Sync" in sync center
- **Expected:** All queued items drain from queue successfully
- **Verify:** Sync center shows "Up to date" or empty queue

---

## End of Day Test

### [ ] Submit EOD Report
- **Path:** Mobile app -> Profile -> End of Day
- **Action:** Submit EOD report
- **Expected:** Report generated with today's summary:
  - Visits completed
  - Collections recorded (total NPR)
  - PTPs made
  - Time logged
- **Verify:** One-time enforcement - cannot submit again until next day

### [ ] EOD Appears in Dashboard
- **Path:** Dashboard -> Operations -> EOD
- **Expected:** EOD report listed with full details
- **Verify:** Numbers match mobile submission

---

## Dashboard Verification Tests

### [ ] Operations Section
- [ ] Staff View - shows all field officers
- [ ] Tasks - shows today's + historical tasks
- [ ] Collections - shows collection records with totals
- [ ] Visits - shows visit logs with GPS data
- [ ] PAR - shows portfolio-at-risk analysis
- [ ] EOD - shows end-of-day reports

### [ ] CBS Section
- [ ] CBS Clients - client list loads
- [ ] PAR Status - status displayed
- [ ] Reconciliation - queue shown

### [ ] AI Section (verify "Live Rule-Based AI" badges)
- **All AI pages must show green "Live Rule-Based AI" badges, NOT "Demo Reference"**

#### [ ] Priority Queue
- Clients ranked by risk priority score
- Scores are numeric (not placeholder text)
- Items are ordered (highest score first)

#### [ ] Suggestions
- Actionable suggestions listed
- Each has a reason/context explanation

#### [ ] EOD Summary
- Auto-generated summary text
- Reflects today's actual data (not hardcoded)

#### [ ] Branch Summary
- Narrative overview of branch performance
- Numbers reflect actual backend data

### [ ] Security Section
- **All security pages show "Reference" badges (not "Demo Reference")**
- [ ] Compliance Overview - score and status displayed
- [ ] Threat Model - STRIDE threats listed
- [ ] RBAC Matrix - role permissions shown

### [ ] Pilot Section
- Sidebar shows just "Pilot" (NOT "Pilot (Demo Data)")
- All pilot pages show warning banners when backend is unavailable:
  **"Fallback demo data shown -- backend unavailable."**

---

## AI Priority Queue Verification

### [ ] Priority Scoring Accuracy
- **Action:** Check the top-priority client in the queue
- **Expected:** Client has legitimate reasons for high priority (e.g., overdue payments, missed visits)
- **Verify:** The scoring logic uses actual loan data, not random numbers

### [ ] Fallback Banner Test
- **Action:** Stop the backend -> refresh AI Priority Queue page
- **Expected:** "Fallback demo data shown -- backend unavailable" banner appears
- **Verify:** Data is NOT silently shown as if it were live

---

## Sign-off

| Tester | Date | Issues Found | Status |
|--------|------|-------------|--------|
|        |      |             |       |
