const express = require("express");
const pool = require("../config/db");
const { getIO } = require("../sockets");
const { computeProgress } = require("../utils/experimentProgress");

const router = express.Router();

/**
 * GET /api/alerts?acknowledged=false
 * Lists teacher alerts, newest first. Defaults to unacknowledged only.
 */
router.get("/", async (req, res) => {
  const onlyUnacknowledged = req.query.acknowledged !== "true" && req.query.acknowledged !== "all";
  try {
    const result = await pool.query(
      `SELECT a.id, a.alert_type, a.message, a.acknowledged, a.created_at, a.acknowledged_at,
              b.bench_number, s.student_name
       FROM teacher_alerts a
       JOIN laboratory_benches b ON b.id = a.bench_id
       LEFT JOIN lab_sessions s ON s.id = a.session_id
       ${onlyUnacknowledged ? "WHERE a.acknowledged = FALSE" : ""}
       ORDER BY a.created_at DESC
       LIMIT 50`
    );
    res.json({ status: "ok", alerts: result.rows });
  } catch (err) {
    console.error("[GET /api/alerts]", err.message);
    res.status(500).json({ status: "error", message: "Failed to fetch alerts." });
  }
});

/**
 * POST /api/alerts/:id/acknowledge
 * Called from the teacher dashboard.
 * If acknowledging a colour_change alert, records teacher_verified to complete Stage 8.
 */
router.post("/:id/acknowledge", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE teacher_alerts SET acknowledged = TRUE, acknowledged_at = NOW()
       WHERE id = $1 RETURNING id, session_id, bench_id, alert_type, acknowledged_at`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Alert not found." });
    }
    const alert = result.rows[0];
    const io = getIO();
    io.emit("lab:alert_acknowledged", { id: alert.id });

    if (alert.session_id) {
      await pool.query(
        `INSERT INTO activity_logs (session_id, bench_id, event_type, is_simulated, raw_payload)
         VALUES ($1, $2, 'teacher_verified', FALSE, $3)`,
        [alert.session_id, alert.bench_id, JSON.stringify({ alert_id: alert.id })]
      );

      const benchRes = await pool.query("SELECT bench_number FROM laboratory_benches WHERE id = $1", [alert.bench_id]);
      const benchNumber = benchRes.rows[0]?.bench_number;
      const progress = await computeProgress(alert.session_id);

      if (benchNumber) {
        io.emit("lab:activity", {
          type: "teacher_verified",
          bench_number: benchNumber,
          session_id: alert.session_id,
          is_simulated: false,
          created_at: new Date().toISOString(),
        });
        io.emit("lab:progress", { bench_number: benchNumber, session_id: alert.session_id, progress });
      }
    }

    res.json({ status: "ok", alert });
  } catch (err) {
    console.error("[POST /api/alerts/:id/acknowledge]", err.message);
    res.status(500).json({ status: "error", message: "Failed to acknowledge alert." });
  }
});

module.exports = router;
