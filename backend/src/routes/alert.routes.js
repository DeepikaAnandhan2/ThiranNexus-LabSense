const express = require("express");
const pool = require("../config/db");
const { getIO } = require("../sockets");

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
 */
router.post("/:id/acknowledge", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE teacher_alerts SET acknowledged = TRUE, acknowledged_at = NOW()
       WHERE id = $1 RETURNING id, acknowledged_at`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Alert not found." });
    }
    getIO().emit("lab:alert_acknowledged", { id: result.rows[0].id });
    res.json({ status: "ok", alert: result.rows[0] });
  } catch (err) {
    console.error("[POST /api/alerts/:id/acknowledge]", err.message);
    res.status(500).json({ status: "error", message: "Failed to acknowledge alert." });
  }
});

module.exports = router;
