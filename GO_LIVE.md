# FieldOS — GO_LIVE.md

Your ordered runbook from "code works on my machine" to "a real microfinance institution is
running a pilot." Hosting details live in [DEPLOY.md](DEPLOY.md); this file is the full sequence
including the config, data, security, and testing touch-ups that DEPLOY.md doesn't cover.

Work top to bottom. Each step says **why** so you can explain it to the institution's IT team.

---

## Part A — Stand up the servers (~1–2 hours)

Follow [DEPLOY.md](DEPLOY.md) to create these four:

1. **Neon** Postgres → get the `DATABASE_URL` (rewrite scheme to `postgresql+asyncpg://…?ssl=require`).
2. **Backend** on Fly.io (or Render) with the env vars from Part B below.
3. **Dashboard** on Vercel (`BACKEND_URL` + `NEXT_PUBLIC_API_URL` = your backend URL).
4. **Mobile APK** via `eas build --profile preview --platform android`.

Checkpoint: `curl https://YOUR-BACKEND/health` returns `{"db":"postgres", ...}`.

---

## Part B — Configure for THIS institution (~30 min)

Set these on the backend host (Fly `fly secrets set …` / Render env). Every one has a real
consequence — don't skip.

| Env var | What to set | Why |
|---------|-------------|-----|
| `JWT_SECRET_KEY` | A fresh 64-char random string (`python -c "import secrets;print(secrets.token_urlsafe(48))"`) | Signs login tokens. The dev default is public in this repo — you MUST replace it. |
| `CORS_ORIGINS` | `https://your-dashboard.vercel.app` | Only your dashboard may call the API from a browser. |
| `SMS_PROVIDER` | `sparrow` | Turns the client receipt SMS from demo-log into real texts — **this is the anti-fraud wedge.** |
| `SMS_API_TOKEN` | Your Sparrow SMS token | Get it from sparrowsms.com; buy a small credit pack. ~NPR 0.30/SMS. |
| `SMS_SENDER` | Your approved sender ID | Sparrow assigns this. |
| `ORG_NAME`, `ORG_TAGLINE`, `ORG_PRODUCT_SUFFIX` | The institution's name/branding | White-labels the dashboard + app login. |
| `ORG_LOGO_URL` | A hosted URL of their logo (PNG/SVG) | Shows their logo on the login screens. |
| `ORG_PRIMARY_COLOR`, `ORG_ACCENT_COLOR` | Their brand colors | Themes the accent/buttons. |

**Register the branch office network (the day-start gate):** ask the institution's IT for the
branch office's **public IP** (search "what is my IP" on a branch computer). Set it on the branch
row — e.g. via a quick SQL update against Neon:
```sql
UPDATE branches SET office_ip = '203.0.113.45' WHERE branch_id = 'BR-KTM-001';
```
Leave it empty to disable the gate for a branch. (A small admin screen for this is a good
fast-follow; for the pilot, one SQL line is fine.)

---

## Part C — Load the institution's REAL data (~1–2 hours)

The demo data (`seed_demo.py`) is for *your* demos and is **destructive** — never run it against
the pilot database. For the pilot, load their real data:

1. **Branch(es):** one row per branch (name, `office_ip`).
2. **Staff:** the real field officers + branch manager, each with their **own PIN** (not `1234`).
   Create them via the dashboard's **Assign Task → Add Staff** flow, or a one-off seed script
   patterned on `seed_demo.py` but with their people.
3. **Borrowers:** load **10–15 real clients** for the pilot (your survey's recommendation), with
   **phone numbers** (required — that's where the receipt SMS goes) and center/ward. Do this
   manually via **Register Borrower** in the app, or by import. Do **not** connect live CBS yet.
4. **Loans:** either register + approve + disburse through the app (proves the origination flow),
   or seed their current outstanding balances so collections can start immediately.

Rule of thumb: the pilot dataset should be *small and real*, not big and fake.

---

## Part D — Security touch-ups before you hand it over (~30 min)

1. **Change every default PIN.** All demo accounts use `1234`. Reset each real user's PIN.
2. **Rotate `JWT_SECRET_KEY`** (Part B) — the repo's dev value is public.
3. **Scrub git history of the old secret + DB.** They're untracked now, but still in history:
   ```bash
   git filter-repo --path fieldos-backend/.env --path fieldos-backend/fieldos_nepal.db --invert-paths
   git push --force
   ```
   Do this before you share the repo with anyone.
4. **Confirm HTTPS.** Fly/Vercel give it automatically — verify the app's `EXPO_PUBLIC_API_URL`
   uses `https://`.
5. **Back up the database.** Neon has point-in-time restore on paid tiers; on free, take a manual
   `pg_dump` before the pilot and weekly during it.

---

## Part E — Pre-launch test on the REAL deployment (~30 min)

Run the full golden path against the *hosted* system, on a *real phone*, before the institution
touches it. This is the same script as [PILOT.md](PILOT.md), but the point here is to prove it
works over the internet, not on localhost:

- [ ] Manager logs into the dashboard (real URL) → sees the branding + KPIs.
- [ ] Officer installs the APK, logs in with their real PIN.
- [ ] Officer taps **Start Day** at the branch → selfie → **verified** (office network). Try it on
      mobile data away from the branch → it should be **blocked**.
- [ ] Officer records a collection → **the client actually receives the receipt SMS.** (Test with
      your own phone number as a borrower first.)
- [ ] Manager sees the collection, the receipt in **Client Receipts**, the pin on **Staff Map**,
      and the day-start in **Day-Start Attendance**.
- [ ] Turn the phone offline, record a collection, come back online → it syncs, and the client
      still gets the SMS.

If all six pass on the hosted system, you're pilot-ready.

---

## Part F — What to tell the institution up front (honesty = trust)

State these plainly; hiding them costs you the second institution:

- **No live core-banking (CBS) integration yet.** Borrower/loan data lives in FieldOS for the
  pilot; CBS read-integration comes after adoption is proven. (Their IT will ask — this is the
  right, low-risk answer.)
- **Clients don't install an app.** They're reached by **SMS** (the receipt). That's deliberate —
  most borrowers are on basic phones.
- **The office-network gate needs their branch's public IP** (Part B). If the branch has a dynamic
  IP, the gate is best-effort; note it.
- **Selfies are stored in the database** for the pilot (fine at this scale); production moves them
  to object storage.
- **It's a pilot.** One branch, ~15 borrowers, 8–12 weeks, with you on support. Set that scope in
  writing.

---

## The 5 things that matter most (if you do nothing else)

1. Replace `JWT_SECRET_KEY` and change all `1234` PINs.
2. Turn on the **real SMS gateway** — the receipt is your whole pitch.
3. Register the branch **office IP** so the day-start gate is real.
4. Load **real borrowers with phone numbers**.
5. Run **Part E** end-to-end on a real phone before handing it over.
