"""
End-to-end pilot sync check: drives the backend exactly as the dashboard
(branch manager) and mobile app (field officer) would, then asserts that
every field round-trips to the manager dashboard endpoints.

Run while the backend is up on 127.0.0.1:8000.
"""
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000/api/v1"

def call(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def login(staff_id, pin):
    s, r = call("POST", "/auth/login", body={"staff_id": staff_id, "pin": pin})
    assert s == 200, f"login {staff_id} -> {s} {r}"
    return r["data"]["tokens"]["access_token"], r["data"]["user"]["id"]

# Make re-runs deterministic: clear rows this script created previously.
import sqlite3 as _sq
_c = _sq.connect("fieldos_nepal.db")
_c.execute("DELETE FROM collections WHERE receipt_id LIKE 'RCP-E2E%'")
_c.execute("DELETE FROM tasks WHERE reason LIKE 'E2E%'") if False else None
for _t in ("task_assignments", "tasks"):
    try:
        _c.execute(f"DELETE FROM {_t} WHERE reason LIKE 'E2E%'")
    except Exception:
        pass
_c.commit(); _c.close()

results = []
def check(name, cond, detail=""):
    results.append((name, cond, detail))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}  {detail}")

print("=== AUTH ===")
fo_tok, fo_id = login("FO-208", "1234")
bm_tok, bm_id = login("BM-001", "1234")
check("FO + BM login", bool(fo_tok and bm_tok), f"fo_id={fo_id} bm_id={bm_id}")

print("\n=== 1. MANAGER ASSIGNS TASK -> MOBILE SEES IT ===")
s, r = call("POST", "/manager/tasks", bm_tok, {
    "officer_id": "FO-208", "client_id": 2, "task_type": "collection",
    "priority": "high", "amount": 3200, "reason": "E2E assigned task",
})
check("assign task (POST /manager/tasks)", s == 200, f"status={s}")
task_id = r.get("data", {}).get("id")

# Mobile fetches its task list
s, r = call("GET", f"/tasks/today?officer_id={fo_id}", fo_tok)
mobile_tasks = r.get("data", [])
mine = [t for t in mobile_tasks if t.get("id") == task_id]
check("mobile /tasks/today shows assigned task", len(mine) == 1, f"found={len(mine)} of {len(mobile_tasks)}")
if mine:
    t = mine[0]
    check("  -> task fields intact (type/priority/amount/reason)",
          t.get("task_type") == "collection" and t.get("priority") == "high"
          and t.get("amount") == 3200 and t.get("reason") == "E2E assigned task",
          json.dumps({k: t.get(k) for k in ("task_type","priority","amount","reason","client_name")}))

print("\n=== 2. MOBILE RECORDS COLLECTION (linked to task) -> MANAGER COLLECTIONS ===")
s, r = call("POST", "/collections/", fo_tok, {
    "client_id": 2, "task_id": task_id, "officer_id": fo_id, "amount": 3200,
    "payment_method": "cash", "outstanding_after": 12000,
    "gps_latitude": 27.69, "gps_longitude": 85.28,
    "gps_address": "Swoyambhu, Kathmandu", "gps_accuracy_meters": 9.4,
    "receipt_id": "RCP-E2E-LINKED",
})
check("record collection linked to task", s == 200, f"status={s}")

s, r = call("GET", "/manager/collections", bm_tok)
recent = r.get("data", {}).get("recent", [])
linked = [c for c in recent if c.get("receipt_id") == "RCP-E2E-LINKED"]
check("manager/collections shows linked collection", len(linked) == 1)
if linked:
    c = linked[0]
    check("  -> officer_name resolved (task-linked)", bool(c.get("officer_name")),
          f"officer_name={c.get('officer_name')!r}")
    check("  -> amount/method/client_name/member_id intact",
          c.get("amount_npr") == 3200 and c.get("method") == "cash"
          and c.get("client_name") and c.get("member_id"),
          json.dumps({k: c.get(k) for k in ("amount_npr","method","client_name","member_id")}))

print("\n=== 3. MOBILE RECORDS AD-HOC COLLECTION (officer_id, NO task) -> attribution? ===")
s, r = call("POST", "/collections/", fo_tok, {
    "client_id": 3, "officer_id": fo_id, "amount": 1800,
    "payment_method": "esewa", "receipt_id": "RCP-E2E-ADHOC",
    "gps_latitude": 27.70, "gps_longitude": 85.30,
    "gps_address": "Balaju, Kathmandu", "gps_accuracy_meters": 6.1,
})
check("record ad-hoc collection (no task)", s == 200, f"status={s}")
s, r = call("GET", "/manager/collections", bm_tok)
recent = r.get("data", {}).get("recent", [])
adhoc = [c for c in recent if c.get("receipt_id") == "RCP-E2E-ADHOC"]
check("manager/collections shows ad-hoc collection", len(adhoc) == 1)
if adhoc:
    check("  -> officer_name resolved for ad-hoc (no task)", bool(adhoc[0].get("officer_name")),
          f"officer_name={adhoc[0].get('officer_name')!r}  <-- gap if empty")

print("\n=== 4. gps_address / gps_accuracy persisted? (direct POST) ===")
import sqlite3
con = sqlite3.connect("fieldos_nepal.db")
row = con.execute("SELECT gps_address, gps_accuracy_meters, officer_id FROM collections WHERE receipt_id=?",
                  ("RCP-E2E-LINKED",)).fetchone()
check("direct POST persists gps_address", bool(row and row[0]), f"gps_address={row[0] if row else None!r}")
check("direct POST persists gps_accuracy_meters", bool(row and row[1] is not None),
      f"gps_accuracy_meters={row[1] if row else None!r}")
check("direct POST persists officer_id", bool(row and row[2]), f"officer_id={row[2] if row else None}")

print("\n=== 5. MOBILE VISIT CHECK-IN -> MANAGER VISITS ===")
s, r = call("POST", "/visit-checkins/", fo_tok, {
    "client_id": 2, "officer_id": fo_id, "visit_purpose": "collection",
    "gps_latitude": 27.69, "gps_longitude": 85.28, "gps_accuracy_meters": 8.0,
    "gps_address": "Swoyambhu, Kathmandu",
})
check("record visit check-in", s in (200, 201), f"status={s} {r.get('detail','')}")
s, r = call("GET", "/manager/visits", bm_tok)
vdata = r.get("data", {})
if isinstance(vdata, dict):
    vcount = vdata.get("recent") or vdata.get("visits") or []
else:
    vcount = vdata
check("manager/visits returns data", bool(vcount), f"type={type(vdata).__name__} n={len(vcount) if hasattr(vcount,'__len__') else '?'}")

print("\n=== 6. MOBILE PTP -> MANAGER PTP-TODAY ===")
s, r = call("POST", "/promise-to-pay/", fo_tok, {
    "client_id": 3, "officer_id": fo_id, "promised_amount": 2000,
    "expected_payment_date": "2026-06-25", "reason": "E2E PTP",
    "outstanding_amount": 5000,
})
check("record PTP", s in (200, 201), f"status={s} {r.get('detail','')}")

print("\n=== 7. MOBILE EOD -> MANAGER EOD-REVIEWS ===")
s, r = call("POST", "/end-of-day/", fo_tok, {
    "officer_id": fo_id, "report_date": "2026-06-20",
    "total_collections": 5000, "total_visits": 1, "pending_count": 0,
})
check("submit EOD", s in (200, 201), f"status={s} {r.get('detail','')}")
s, r = call("GET", "/manager/eod-reviews", bm_tok)
check("manager/eod-reviews returns data", r.get("success"), f"status={s}")

print("\n=== 8. MANAGER DASHBOARD KPIs reflect activity ===")
s, r = call("GET", "/manager/dashboard", bm_tok)
d = r.get("data", {})
check("dashboard collections_total_npr > 0", (d.get("collections_total_npr") or 0) > 0,
      f"collections_total_npr={d.get('collections_total_npr')}")

print("\n=== 9. MANAGER STAFF view attributes activity to officer ===")
s, r = call("GET", "/manager/staff", bm_tok)
staff = r.get("data", [])
staff = staff if isinstance(staff, list) else (staff.get("staff", []) if isinstance(staff, dict) else [])
fo_row = next((x for x in staff if str(x.get("staff_id")) == "FO-208"), None)
check("staff view lists FO-208", fo_row is not None,
      json.dumps(fo_row) if fo_row else "not found")

print("\n=== SUMMARY ===")
passed = sum(1 for _, c, _ in results if c)
print(f"{passed}/{len(results)} checks passed")
fails = [n for n, c, _ in results if not c]
if fails:
    print("FAILURES:")
    for f in fails:
        print("  -", f)
