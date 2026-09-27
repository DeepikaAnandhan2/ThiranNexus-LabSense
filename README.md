# ThiranNexus LabSense

**An IoT-Based Assistive Laboratory Learning and Monitoring System for Visually Impaired Students**

Standalone project — its own frontend, backend, database, and auth. Not integrated with any other app.

## No authentication

This app has no login. It sits behind the existing ThiranNexus platform, so it goes straight from a landing page into the Student or Teacher dashboard.

## UI redesign

The interface now uses a white background with purple (primary actions), green (start/success), and orange (highlights, audio activation) as accent colors — replacing the earlier dark theme. High contrast is preserved (dark text on white, large buttons, strong accent colors), which keeps it accessible while looking cleaner and more professional.

## Phase 1–6 status: ✅ Done

### 🐛 Fixed: colour-change audio "not working"

This wasn't actually a speech/audio bug. `computeProgress()` only marks **Step 6** ("Receive a colour-change notification") done once **all** of Steps 1–5 are done for that session (both equipment scans, Start Experiment, Start Colour Monitoring). The student dashboard's audio cue only fires when Step 6 flips to done. Previously, the backend logged a `colour_change_detected` event and raised a teacher alert on **any** threshold-matching reading — even one sent out of order (e.g. clicking "Simulate Colour Change" on the sim page before the other buttons). That meant a teacher alert could go out while Step 6 silently stayed `false` forever, so the audio never played — with no error anywhere telling you why.

Fixed in `backend/src/routes/device.routes.js` (`/api/devices/colour-reading`): the event/alert are now only created once Steps 1–5 are actually done for the session; otherwise the reading is still stored, but the response includes `prerequisites_missing: [...]` naming exactly what hasn't happened yet. The simulation page (`/simulation`) now disables buttons out of order and shows that same message in the event log, and has a one-click **"Run Recommended Sequence"** button that fires the whole chain correctly. Use that button (or click the 4 sim buttons strictly top-to-bottom) to hear the audio.

What's new in Phase 6:
- Backend now emits live events over Socket.IO after every write — `lab:session_started`, `lab:session_ended`, `lab:activity`, `lab:progress`, `lab:sensor_reading`, `lab:alert`, `lab:alert_acknowledged` — from `backend/src/sockets/index.js`, initialized in `server.js`
- Teacher dashboard's student cards are **no longer mock data**: it loads active sessions once via `GET /api/sessions/active` (now returns current equipment, step progress, and latest sensor reading per session), then updates instantly from socket events — no more 2–3 second polling delay anywhere on that page
- A **🟢 Live / 🔴 Reconnecting** indicator shows the socket connection state
- The alerts panel now updates via `lab:alert` / `lab:alert_acknowledged` instead of polling every 3 seconds
- Activity Timeline is now real, built from live `lab:activity` events instead of the old hardcoded sample rows

### Try Phase 6 live updates

1. Both servers running (`npm run dev` in `backend/` and `frontend/`)
2. Tab A: `/teacher` — should show "🟢 Live" and "No active lab sessions"
3. Tab B: `/student` → name + Bench 01 → Start Lab Session → Activate Audio
4. Watch Tab A: a student card for Bench 01 appears **immediately**, no refresh
5. Tab C: `/simulation` → Bench 01 → click **▶ Run Recommended Sequence**
6. Watch Tab A update live as each step happens (equipment, progress, sensor reading), a red alert appear in the Alerts panel, and the Activity Timeline fill in — while Tab B speaks the colour-change warning automatically

What's new in Phase 5:
- Experiment progress is now **real**, computed from your actual activity log (not mock data): Steps 1–2 complete when you scan burette/conical flask, Step 3 is automatic once both are scanned, Step 4 needs "Start Experiment", Step 5 needs "Start Colour Monitoring", Step 6 needs a colour reading that matches the configured threshold, Step 7 needs the student to click **Request Teacher Verification**
- New tables: `sensor_readings`, `teacher_alerts`
- New endpoints: `experiment-start`, `colour-monitoring-start`, `colour-reading` (with threshold detection), `sensor-disconnect`, `GET /api/sessions/:id/progress`, `POST /api/sessions/:id/request-verification`, `GET /api/alerts`, `POST /api/alerts/:id/acknowledge`
- Simulation page now has **all 8 controls** working: the 4 equipment scans, Start Experiment, Start Colour Monitoring, Simulate Colour Change, and Simulate Sensor Disconnection (plus a bonus "Simulate Normal Reading" to show what a non-matching reading looks like)
- Teacher dashboard's **Alerts panel is now live** — polls the real backend every 3 seconds and Acknowledge actually clears it from the database. (Student cards are still mock data until Phase 6's Socket.IO wiring.)
- Student dashboard automatically speaks "Colour change detected. Please pause and ask your teacher to verify the observation." the moment Step 6 completes, and shows a Request Teacher Verification button

### Apply the Phase 5 schema

In pgAdmin: connect to `labsense_db` → Query Tool → paste in `database/phase5_schema.sql` → run.
Or: `psql -U postgres -d labsense_db -f database/phase5_schema.sql`

### Try the full experiment flow

1. Both servers running, both `.env` files in place, both restarted
2. Tab A: `/student` → name + Bench 01 → Start Session → Activate Audio
3. Tab B: `/simulation` → Bench 01 → click in this order:
   - **Scan Burette** (Step 1 ✅)
   - **Scan Conical Flask** (Step 2 ✅, Step 3 auto-completes)
   - **Start Experiment** (Step 4 ✅)
   - **Start Colour Monitoring** (Step 5 ✅)
   - **Simulate Colour Change** (Step 6 ✅ — Tab A should speak the colour-change warning automatically, and a red alert should appear on `/teacher`)
4. Back in Tab A, click **Request Teacher Verification** (Step 7 ✅ — all 7 steps now show checked)
5. Open `/teacher` in a third tab — you should see the alert in the Alerts panel; click **Acknowledge** and it disappears



What's new in Phase 4:
- `/simulation` page — pick a bench, click a "Scan X" button, and it sends the exact same request the real ESP32 will send
- Student dashboard now asks for a name, creates a real session via `POST /api/sessions/start`, and **polls the backend every 2 seconds** for new scans at its bench — when one appears, it updates the Current Equipment panel and speaks the description, usage, and safety instructions automatically (only once per new scan, not on every poll)
- `GET /api/devices/latest-scan/:benchNumber` — the new endpoint the polling uses
- Ending a session now properly calls the backend to close it out

Polling (not push) is used for now — Phase 6 replaces this with an instant Socket.IO push, but this way each phase stays independently testable.

### Try the full flow end to end

1. Backend running (`npm run dev` in `backend/`) and frontend running (`npm run dev` in `frontend/`)
2. In `frontend/`, copy the new env file: `copy .env.example .env` (the default key already matches the backend's dev key — no editing needed)
3. **Restart the frontend** (`Ctrl+C` then `npm run dev`) so it picks up the new `.env`
4. Open **two browser tabs**:
   - Tab A: `http://localhost:5173/student` → enter a name, pick Bench 01, Start Lab Session, click Activate Audio
   - Tab B: `http://localhost:5173/simulation` → pick Bench 01, click **Scan Burette**
5. Within ~2 seconds, Tab A should update to show "Burette" with its description, and speak it out loud automatically — you didn't touch Tab A at all.

### What Phase 3 added (equipment DB + RFID API)

- Database tables: `laboratory_benches`, `equipment` (seeded with burette/pipette/beaker/conical flask), `rfid_tags` (seeded with 4 placeholder tag UIDs), `lab_sessions`, `activity_logs`
- `GET /api/equipment` and `GET /api/equipment/:code` — list/view equipment
- `POST /api/sessions/start` and `POST /api/sessions/:id/end` — start/end a lab session for a student at a bench
- `GET /api/sessions/active` — list currently active sessions (what the teacher dashboard will use from Phase 6)
- `POST /api/devices/rfid-scan` — the core event endpoint. Looks up equipment from a tag UID, logs the activity, handles duplicate scans, and works identically whether called by the real ESP32 or the simulation page
- A device API key (`x-device-api-key` header) protects the scan endpoint — this is not user login, just a shared secret so random requests can't fake equipment events

If you haven't already, apply this schema in pgAdmin (connect to `labsense_db` → Query Tool → paste in `database/phase3_schema.sql` → run), or from a terminal:
```
psql -U postgres -d labsense_db -f database/phase3_schema.sql
```

### Testing the raw API with Postman (optional — the simulation page does this for you)

**List equipment:**
```
GET http://localhost:5000/api/equipment
```

**Start a session:**
```
POST http://localhost:5000/api/sessions/start
Content-Type: application/json

{ "student_name": "Deepika", "bench_number": "01" }
```

**Simulate an RFID scan** (this is exactly what your friend's ESP32 will call):
```
POST http://localhost:5000/api/devices/rfid-scan
Content-Type: application/json
x-device-api-key: dev-local-testing-key-change-me

{ "tag_uid": "DEV-TAG-BURETTE", "bench_number": "01", "source": "simulation" }
```
Try the other three: `DEV-TAG-PIPETTE`, `DEV-TAG-BEAKER`, `DEV-TAG-CONICAL-FLASK`.

## 1. Project structure

```
ThiranNexus-LabSense/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js              # PostgreSQL pool
│   │   │   └── testConnection.js  # npm run db:test
│   │   ├── controllers/           # (added Phase 2+)
│   │   ├── middleware/            # (added Phase 2+)
│   │   ├── models/                # (added Phase 3+)
│   │   ├── routes/
│   │   │   └── health.routes.js
│   │   ├── sockets/                # (added Phase 6)
│   │   ├── app.js                  # Express app + middleware
│   │   └── server.js               # HTTP server entry point
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/              # (added Phase 2+)
│   │   ├── hooks/                   # (added Phase 4+)
│   │   ├── pages/                   # (added Phase 2+)
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vite.config.js
│   └── package.json
├── database/
│   └── phase1_init.sql
└── README.md
```

## 2. Prerequisites (Windows)

1. **Node.js LTS (v18+)** — download from https://nodejs.org and install. Verify:
   ```
   node -v
   npm -v
   ```
2. **PostgreSQL** — download from https://www.postgresql.org/download/windows/. During install, set a password for the `postgres` user and remember it. pgAdmin is installed alongside it.
3. **VS Code** — https://code.visualstudio.com. Recommended extensions: *ESLint*, *Tailwind CSS IntelliSense*, *PostgreSQL* (by Chris Kolkman) or use pgAdmin instead.
4. Unzip this project anywhere, e.g. `C:\Projects\ThiranNexus-LabSense`, then open that folder in VS Code (`File > Open Folder`).

## 3. Create the database

Open **pgAdmin** (or `psql`) and run:

```sql
CREATE DATABASE labsense_db;
```

Then, in VS Code's terminal (or `psql`), load the Phase 1 verification table:

```
psql -U postgres -d labsense_db -f database/phase1_init.sql
```

(It will prompt for the postgres password you set during install.)

## 4. Backend setup

Open a terminal in VS Code (`` Ctrl+` ``) and run:

```
cd backend
copy .env.example .env
```

Edit `.env` and set `DB_PASSWORD` to your real PostgreSQL password (leave the other defaults as-is for local dev).

Install dependencies and start the server:

```
npm install
npm run db:test
npm run dev
```

- `npm run db:test` should print `✅ PostgreSQL connection successful.`
- `npm run dev` starts the API on **http://localhost:5000** (auto-restarts on file changes via nodemon).

Verify in a browser: http://localhost:5000/api/health and http://localhost:5000/api/health/db — both should return JSON with `"status": "ok"`.

## 5. Frontend setup

Open a **second** VS Code terminal (keep the backend running in the first one):

```
cd frontend
npm install
npm run dev
```

Vite will start the frontend on **http://localhost:5173**. Open it in a browser — you should see the ThiranNexus LabSense status page showing:

```
Backend API           Connected ✅
PostgreSQL Database   Connected ✅
```

If either shows "Not reachable ❌", check that the corresponding terminal (backend or PostgreSQL service) is still running, and that `backend/.env` has the correct DB password.

## 6. Try it

- `http://localhost:5173/` — Landing page
- `http://localhost:5173/student` — Pick a bench, click **Start Lab Session**, click **Activate Audio**, then **Repeat Audio** — you should hear it speak
- `http://localhost:5173/teacher` — Click a student card to see its bench camera placeholder; try **Acknowledge** on the alert

## 7. Phase 1–5 success criteria

- [ ] `npm run db:test` succeeds; `/api/health` returns ok
- [ ] `database/phase5_schema.sql` applied
- [ ] All 8 buttons on `/simulation` work without errors
- [ ] Full experiment flow above completes all 7 steps on the student dashboard
- [ ] Colour-change warning speaks automatically when Step 6 completes
- [ ] `/teacher` Alerts panel shows the alert and Acknowledge clears it
- [ ] New white/purple/green/orange look renders correctly on all 4 pages

Once confirmed, tell me and we'll move to **Phase 6: real-time teacher dashboard with Socket.IO** — that replaces all the 2–3 second polling with instant push updates, and finally makes the teacher's student cards live instead of mock data.

## Note on hardware integration (for your teammate)

The RFID-scan and colour-sensor-event endpoints your teammate's ESP32 will call are built in **Phase 3** (equipment/RFID) and **Phase 5** (colour sensor), and documented fully in **`HARDWARE_INTEGRATION.md`** in **Phase 8** — with exact JSON payloads for "tag scanned" and "colour threshold crossed" events, the auth header format, and Postman examples. Nothing hardware-specific needs to be decided before then; Phase 1 just gets the app running.
