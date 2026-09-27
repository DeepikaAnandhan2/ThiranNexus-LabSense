const express = require("express");
const { body, validationResult } = require("express-validator");
const pool = require("../config/db");
const { computeProgress } = require("../utils/experimentProgress");
const { getIO } = require("../sockets");

const router = express.Router();

/**
 * POST /api/sessions/start
 * Body: { student_name: string, bench_number: string }
 * Called when a student clicks "Start Lab Session" on the dashboard.
 * Ends any other still-active session at the same bench first (one
 * active student per bench at a time).
 */
router.post(
  "/start",
  [
    body("student_name").isString().trim().notEmpty().withMessage("student_name is required."),
    body("bench_number").isString().trim().notEmpty().withMessage("bench_number is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: "error", errors: errors.array() });
    }

    const { student_name, bench_number } = req.body;

    try {
      const benchResult = await pool.query(
        "SELECT id FROM laboratory_benches WHERE bench_number = $1",
        [bench_number]
      );
      if (benchResult.rows.length === 0) {
        return res.status(404).json({ status: "error", message: `Unknown bench_number: ${bench_number}` });
      }
      const benchId = benchResult.rows[0].id;

      // Close out any previous active session at this bench
      await pool.query(
        "UPDATE lab_sessions SET is_active = FALSE, ended_at = NOW() WHERE bench_id = $1 AND is_active = TRUE",
        [benchId]
      );

      const insertResult = await pool.query(
        `INSERT INTO lab_sessions (student_name, bench_id, is_active)
         VALUES ($1, $2, TRUE)
         RETURNING id, student_name, bench_id, started_at`,
        [student_name, benchId]
      );

      const session = insertResult.rows[0];
      getIO().emit("lab:session_started", { session, bench_number });

      res.json({ status: "ok", session });
    } catch (err) {
      console.error("[POST /api/sessions/start]", err.message);
      res.status(500).json({ status: "error", message: "Failed to start session." });
    }
  }
);

/**
 * POST /api/sessions/:id/end
 * Called when a student clicks "End Session".
 */
router.post("/:id/end", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE lab_sessions s SET is_active = FALSE, ended_at = NOW()
       FROM laboratory_benches b
       WHERE s.id = $1 AND b.id = s.bench_id
       RETURNING s.id, s.ended_at, b.bench_number`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Session not found." });
    }
    getIO().emit("lab:session_ended", { session_id: result.rows[0].id, bench_number: result.rows[0].bench_number });
    res.json({ status: "ok", session: result.rows[0] });
  } catch (err) {
    console.error("[POST /api/sessions/:id/end]", err.message);
    res.status(500).json({ status: "error", message: "Failed to end session." });
  }
});

/**
 * GET /api/sessions/active
 * Lists all currently active sessions with bench info, current equipment,
 * step progress and the latest sensor reading - this is what the teacher
 * dashboard loads on mount before Socket.IO (Phase 6) takes over with live
 * updates for anything that happens afterwards.
 */
router.get("/active", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.student_name, s.started_at, b.bench_number
       FROM lab_sessions s JOIN laboratory_benches b ON b.id = s.bench_id
       WHERE s.is_active = TRUE
       ORDER BY s.started_at DESC`
    );

    const sessions = await Promise.all(
      result.rows.map(async (row) => {
        const [progress, equipRes, sensorRes] = await Promise.all([
          computeProgress(row.id),
          pool.query(
            `SELECT e.name FROM activity_logs al JOIN equipment e ON e.id = al.equipment_id
             WHERE al.session_id = $1 AND al.event_type = 'equipment_scan'
             ORDER BY al.created_at DESC LIMIT 1`,
            [row.id]
          ),
          pool.query(
            `SELECT red_value AS red, green_value AS green, blue_value AS blue, threshold_crossed, created_at
             FROM sensor_readings WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [row.id]
          ),
        ]);
        return {
          ...row,
          current_equipment: equipRes.rows[0]?.name || null,
          progress,
          latest_sensor: sensorRes.rows[0] || null,
        };
      })
    );

    res.json({ status: "ok", sessions });
  } catch (err) {
    console.error("[GET /api/sessions/active]", err.message);
    res.status(500).json({ status: "error", message: "Failed to fetch active sessions." });
  }
});

/**
 * GET /api/sessions/:id/progress
 * The student dashboard polls this to render step-by-step experiment
 * progress. See utils/experimentProgress.js for how steps are derived.
 */
router.get("/:id/progress", async (req, res) => {
  try {
    const progress = await computeProgress(req.params.id);
    res.json({ status: "ok", ...progress });
  } catch (err) {
    console.error("[GET /api/sessions/:id/progress]", err.message);
    res.status(500).json({ status: "error", message: "Failed to compute progress." });
  }
});

/**
 * POST /api/sessions/:id/request-verification
 * The student clicks "Request Teacher Verification" on the dashboard
 * (step 7) - this comes directly from the browser, not the ESP32, so it
 * does not require the device API key.
 */
router.post("/:id/request-verification", async (req, res) => {
  try {
    const sessionResult = await pool.query(
      "SELECT id, bench_id FROM lab_sessions WHERE id = $1",
      [req.params.id]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Session not found." });
    }
    const session = sessionResult.rows[0];

    await pool.query(
      `INSERT INTO activity_logs (session_id, bench_id, event_type, is_simulated, raw_payload)
       VALUES ($1, $2, 'teacher_verification_requested', FALSE, $3)`,
      [session.id, session.bench_id, JSON.stringify({ requested_by: "student" })]
    );

    const benchRes = await pool.query("SELECT bench_number FROM laboratory_benches WHERE id = $1", [session.bench_id]);
    const progress = await computeProgress(session.id);

    if (benchRes.rows[0]) {
      const bench_number = benchRes.rows[0].bench_number;
      getIO().emit("lab:activity", {
        type: "teacher_verification_requested",
        bench_number,
        session_id: session.id,
        is_simulated: false,
        created_at: new Date().toISOString(),
      });
      getIO().emit("lab:progress", { bench_number, session_id: session.id, progress });
    }

    res.json({ status: "ok", ...progress });
  } catch (err) {
    console.error("[POST /api/sessions/:id/request-verification]", err.message);
    res.status(500).json({ status: "error", message: "Failed to request verification." });
  }
});

module.exports = router;
