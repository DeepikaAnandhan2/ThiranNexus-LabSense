const express = require("express");
const { body, validationResult } = require("express-validator");
const pool = require("../config/db");
const verifyDeviceKey = require("../middleware/deviceAuth");
const { getIO } = require("../sockets");
const { computeProgress } = require("../utils/experimentProgress");

/** Emits both the raw activity event and the recomputed step progress for a
 * session, so the teacher dashboard's checklist and cards stay in sync. Safe
 * to call even if a session is null (just skips - nothing to broadcast). */
async function emitActivityAndProgress(benchNumber, session, activityPayload) {
  const io = getIO();
  io.emit("lab:activity", { bench_number: benchNumber, ...activityPayload });
  if (session) {
    const progress = await computeProgress(session.id);
    io.emit("lab:progress", { bench_number: benchNumber, session_id: session.id, progress });
  }
}

const router = express.Router();

const DUPLICATE_WINDOW_SECONDS = 3;
const COLOUR_TARGET = {
  r: parseInt(process.env.COLOUR_TARGET_R || "255", 10),
  g: parseInt(process.env.COLOUR_TARGET_G || "105", 10),
  b: parseInt(process.env.COLOUR_TARGET_B || "180", 10),
};
const COLOUR_TOLERANCE = parseInt(process.env.COLOUR_TOLERANCE || "30", 10);

/** Resolves {id} for a bench_number, or null. */
async function resolveBench(benchNumber) {
  const r = await pool.query("SELECT id, bench_number FROM laboratory_benches WHERE bench_number = $1", [benchNumber]);
  return r.rows[0] || null;
}

/** Resolves the current active session at a bench, or null. */
async function resolveActiveSession(benchId) {
  const r = await pool.query(
    "SELECT id, student_name FROM lab_sessions WHERE bench_id = $1 AND is_active = TRUE ORDER BY started_at DESC LIMIT 1",
    [benchId]
  );
  return r.rows[0] || null;
}

/** True if this exact event_type was already logged for this bench within the dedupe window. */
async function isDuplicateEvent(benchId, eventType) {
  const r = await pool.query(
    `SELECT id FROM activity_logs WHERE bench_id = $1 AND event_type = $2
     AND created_at > NOW() - INTERVAL '${DUPLICATE_WINDOW_SECONDS} seconds'
     ORDER BY created_at DESC LIMIT 1`,
    [benchId, eventType]
  );
  return r.rows.length > 0;
}

/**
 * POST /api/devices/rfid-scan
 * Body: { tag_uid: string, bench_number: string, source?: "hardware" | "simulation" }
 *
 * Used by BOTH the real ESP32 and the developer simulation page (Phase 9) -
 * same endpoint, same logic. "source" only affects the is_simulated flag
 * used for activity-log labelling; it never changes what data is returned.
 */
router.post(
  "/rfid-scan",
  verifyDeviceKey,
  [
    body("tag_uid").isString().trim().notEmpty().withMessage("tag_uid is required."),
    body("bench_number").isString().trim().notEmpty().withMessage("bench_number is required."),
    body("source").optional().isIn(["hardware", "simulation"]).withMessage("source must be 'hardware' or 'simulation'."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: "error", errors: errors.array() });
    }

    const { tag_uid, bench_number, source = "hardware" } = req.body;

    try {
      // 1. Resolve the bench
      const benchResult = await pool.query(
        "SELECT id, bench_number FROM laboratory_benches WHERE bench_number = $1",
        [bench_number]
      );
      if (benchResult.rows.length === 0) {
        return res.status(404).json({ status: "error", message: `Unknown bench_number: ${bench_number}` });
      }
      const bench = benchResult.rows[0];

      // 2. Resolve the equipment from the tag UID
      const tagResult = await pool.query(
        `SELECT e.id, e.code, e.name, e.description, e.usage_instructions, e.safety_instructions
         FROM rfid_tags t JOIN equipment e ON e.id = t.equipment_id
         WHERE t.tag_uid = $1`,
        [tag_uid]
      );
      if (tagResult.rows.length === 0) {
        return res.status(404).json({ status: "error", message: `Unrecognized RFID tag: ${tag_uid}` });
      }
      const equipment = tagResult.rows[0];

      // 3. Duplicate-event guard: ignore the exact same tag at the exact same
      //    bench if it was already logged in the last few seconds (handles
      //    RFID readers that fire multiple reads for one tap).
      const dupCheck = await pool.query(
        `SELECT id FROM activity_logs
         WHERE bench_id = $1 AND equipment_id = $2 AND event_type = 'equipment_scan'
           AND created_at > NOW() - INTERVAL '${DUPLICATE_WINDOW_SECONDS} seconds'
         ORDER BY created_at DESC LIMIT 1`,
        [bench.id, equipment.id]
      );
      if (dupCheck.rows.length > 0) {
        return res.json({
          status: "ok",
          duplicate: true,
          message: "Duplicate scan ignored (same tag/bench within a few seconds).",
          equipment,
          bench,
        });
      }

      // 4. Find the active session at this bench, if any
      const sessionResult = await pool.query(
        `SELECT id, student_name FROM lab_sessions
         WHERE bench_id = $1 AND is_active = TRUE
         ORDER BY started_at DESC LIMIT 1`,
        [bench.id]
      );
      const session = sessionResult.rows[0] || null;

      // 5. Log the activity
      const isSimulated = source === "simulation";
      const logResult = await pool.query(
        `INSERT INTO activity_logs (session_id, bench_id, event_type, equipment_id, is_simulated, raw_payload)
         VALUES ($1, $2, 'equipment_scan', $3, $4, $5)
         RETURNING id, created_at`,
        [session ? session.id : null, bench.id, equipment.id, isSimulated, JSON.stringify(req.body)]
      );

      await emitActivityAndProgress(bench.bench_number, session, {
        type: "equipment_scan",
        session_id: session ? session.id : null,
        equipment_name: equipment.name,
        is_simulated: isSimulated,
        created_at: logResult.rows[0].created_at,
      });

      res.json({
        status: "ok",
        duplicate: false,
        equipment,
        bench,
        session,
        activity_log_id: logResult.rows[0].id,
        logged_at: logResult.rows[0].created_at,
        is_simulated: isSimulated,
      });
    } catch (err) {
      console.error("[POST /api/devices/rfid-scan]", err.message);
      res.status(500).json({ status: "error", message: "Failed to process RFID scan." });
    }
  }
);

/**
 * POST /api/devices/experiment-start
 * Body: { bench_number, source? }
 * Logs step 4 ("Begin the simulated experiment").
 */
router.post(
  "/experiment-start",
  verifyDeviceKey,
  [body("bench_number").isString().trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: "error", errors: errors.array() });

    try {
      const bench = await resolveBench(req.body.bench_number);
      if (!bench) return res.status(404).json({ status: "error", message: "Unknown bench_number." });

      if (await isDuplicateEvent(bench.id, "experiment_start")) {
        return res.json({ status: "ok", duplicate: true, message: "Duplicate experiment_start ignored." });
      }

      const session = await resolveActiveSession(bench.id);
      const source = req.body.source === "simulation" ? "simulation" : "hardware";
      await pool.query(
        `INSERT INTO activity_logs (session_id, bench_id, event_type, is_simulated, raw_payload)
         VALUES ($1, $2, 'experiment_start', $3, $4)`,
        [session ? session.id : null, bench.id, source === "simulation", JSON.stringify(req.body)]
      );
      await emitActivityAndProgress(bench.bench_number, session, {
        type: "experiment_start",
        session_id: session ? session.id : null,
        is_simulated: source === "simulation",
        created_at: new Date().toISOString(),
      });
      res.json({ status: "ok", duplicate: false, bench, session });
    } catch (err) {
      console.error("[POST /api/devices/experiment-start]", err.message);
      res.status(500).json({ status: "error", message: "Failed to start experiment." });
    }
  }
);

/**
 * POST /api/devices/colour-monitoring-start
 * Body: { bench_number, source? }
 * Logs step 5 ("Activate colour monitoring").
 */
router.post(
  "/colour-monitoring-start",
  verifyDeviceKey,
  [body("bench_number").isString().trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: "error", errors: errors.array() });

    try {
      const bench = await resolveBench(req.body.bench_number);
      if (!bench) return res.status(404).json({ status: "error", message: "Unknown bench_number." });

      if (await isDuplicateEvent(bench.id, "colour_monitoring_start")) {
        return res.json({ status: "ok", duplicate: true, message: "Duplicate colour_monitoring_start ignored." });
      }

      const session = await resolveActiveSession(bench.id);
      const source = req.body.source === "simulation" ? "simulation" : "hardware";
      await pool.query(
        `INSERT INTO activity_logs (session_id, bench_id, event_type, is_simulated, raw_payload)
         VALUES ($1, $2, 'colour_monitoring_start', $3, $4)`,
        [session ? session.id : null, bench.id, source === "simulation", JSON.stringify(req.body)]
      );
      await emitActivityAndProgress(bench.bench_number, session, {
        type: "colour_monitoring_start",
        session_id: session ? session.id : null,
        is_simulated: source === "simulation",
        created_at: new Date().toISOString(),
      });
      res.json({ status: "ok", duplicate: false, bench, session });
    } catch (err) {
      console.error("[POST /api/devices/colour-monitoring-start]", err.message);
      res.status(500).json({ status: "error", message: "Failed to start colour monitoring." });
    }
  }
);

/**
 * POST /api/devices/colour-reading
 * Body: { bench_number, red, green, blue, source? }
 * Always stores the raw reading. If it's within COLOUR_TOLERANCE of the
 * configured COLOUR_TARGET (see backend/.env), it also logs step 6 and
 * raises a teacher alert - but only once per session, so a steady stream
 * of matching readings doesn't spam the teacher with duplicate alerts.
 *
 * IMPORTANT: crossing this threshold is a hint that a colour change may
 * have occurred, NOT proof of a real chemical titration endpoint - it
 * always requires a human teacher to verify (see Step 7).
 */
router.post(
  "/colour-reading",
  verifyDeviceKey,
  [
    body("bench_number").isString().trim().notEmpty(),
    body("red").isInt({ min: 0, max: 255 }),
    body("green").isInt({ min: 0, max: 255 }),
    body("blue").isInt({ min: 0, max: 255 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: "error", errors: errors.array() });

    const { bench_number, red, green, blue } = req.body;
    const source = req.body.source === "simulation" ? "simulation" : "hardware";

    try {
      const bench = await resolveBench(bench_number);
      if (!bench) return res.status(404).json({ status: "error", message: "Unknown bench_number." });

      const session = await resolveActiveSession(bench.id);

      const distance = Math.sqrt(
        (red - COLOUR_TARGET.r) ** 2 + (green - COLOUR_TARGET.g) ** 2 + (blue - COLOUR_TARGET.b) ** 2
      );
      const thresholdCrossed = distance <= COLOUR_TOLERANCE;

      await pool.query(
        `INSERT INTO sensor_readings (session_id, bench_id, red_value, green_value, blue_value, threshold_crossed, is_simulated)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [session ? session.id : null, bench.id, red, green, blue, thresholdCrossed, source === "simulation"]
      );

      // Always broadcast the raw reading, even if nothing else happens with
      // it, so the teacher dashboard's "latest reading" field stays live.
      await getIO().emit("lab:sensor_reading", {
        bench_number: bench.bench_number,
        session_id: session ? session.id : null,
        red, green, blue,
        threshold_crossed: thresholdCrossed,
        created_at: new Date().toISOString(),
      });

      let alertCreated = false;
      let prerequisitesMissing = [];
      if (thresholdCrossed && session) {
        // Step 6 ("Receive a colour-change notification") is only meaningful
        // once the student has actually gone through steps 1-5 (scanned the
        // burette and conical flask, started the experiment, and started
        // colour monitoring). Without this check, a threshold-matching
        // reading sent out of order - e.g. a tester clicking "Simulate
        // Colour Change" before the earlier simulation buttons - would
        // raise a teacher alert while computeProgress() never marks step 6
        // done, so the student dashboard's audio cue (which only fires when
        // step 6 flips to done) silently never plays even though an alert
        // went out. That mismatch was the root cause of the audio not
        // firing - it wasn't a speech/audio bug, it was a sequencing gap.
        const progress = await computeProgress(session.id);
        const step5 = progress.steps[4]; // "Activate colour monitoring"
        if (!step5.done) {
          prerequisitesMissing = progress.steps.slice(0, 5).filter((s) => !s.done).map((s) => s.text);
        } else {
          // Only log the step / raise an alert once per session.
          const already = await pool.query(
            "SELECT id FROM activity_logs WHERE session_id = $1 AND event_type = 'colour_change_detected' LIMIT 1",
            [session.id]
          );
          if (already.rows.length === 0) {
            await pool.query(
              `INSERT INTO activity_logs (session_id, bench_id, event_type, is_simulated, raw_payload)
               VALUES ($1, $2, 'colour_change_detected', $3, $4)`,
              [session.id, bench.id, source === "simulation", JSON.stringify(req.body)]
            );
            const alertResult = await pool.query(
              `INSERT INTO teacher_alerts (session_id, bench_id, alert_type, message)
               VALUES ($1, $2, 'colour_change', $3)
               RETURNING id, created_at`,
              [
                session.id,
                bench.id,
                `Colour change detected for ${session.student_name} at Bench ${bench.bench_number}. Please verify the observation.`,
              ]
            );
            alertCreated = true;

            await emitActivityAndProgress(bench.bench_number, session, {
              type: "colour_change_detected",
              session_id: session.id,
              is_simulated: source === "simulation",
              created_at: new Date().toISOString(),
            });
            getIO().emit("lab:alert", {
              id: alertResult.rows[0].id,
              alert_type: "colour_change",
              message: `Colour change detected for ${session.student_name} at Bench ${bench.bench_number}. Please verify the observation.`,
              bench_number: bench.bench_number,
              student_name: session.student_name,
              acknowledged: false,
              created_at: alertResult.rows[0].created_at,
            });
          }
        }
      }

      res.json({
        status: "ok",
        threshold_crossed: thresholdCrossed,
        alert_created: alertCreated,
        prerequisites_missing: prerequisitesMissing,
        bench,
        session,
      });
    } catch (err) {
      console.error("[POST /api/devices/colour-reading]", err.message);
      res.status(500).json({ status: "error", message: "Failed to process colour reading." });
    }
  }
);

/**
 * POST /api/devices/sensor-disconnect
 * Body: { bench_number, source? }
 * Raises a teacher alert - does not affect experiment step progress.
 */
router.post(
  "/sensor-disconnect",
  verifyDeviceKey,
  [body("bench_number").isString().trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: "error", errors: errors.array() });

    try {
      const bench = await resolveBench(req.body.bench_number);
      if (!bench) return res.status(404).json({ status: "error", message: "Unknown bench_number." });
      const session = await resolveActiveSession(bench.id);

      const message = `Colour sensor disconnected at Bench ${bench.bench_number}.`;
      const alertResult = await pool.query(
        `INSERT INTO teacher_alerts (session_id, bench_id, alert_type, message)
         VALUES ($1, $2, 'sensor_disconnected', $3)
         RETURNING id, created_at`,
        [session ? session.id : null, bench.id, message]
      );

      getIO().emit("lab:alert", {
        id: alertResult.rows[0].id,
        alert_type: "sensor_disconnected",
        message,
        bench_number: bench.bench_number,
        student_name: session ? session.student_name : null,
        acknowledged: false,
        created_at: alertResult.rows[0].created_at,
      });

      res.json({ status: "ok", bench, session });
    } catch (err) {
      console.error("[POST /api/devices/sensor-disconnect]", err.message);
      res.status(500).json({ status: "error", message: "Failed to log sensor disconnection." });
    }
  }
);

/**
 * GET /api/devices/latest-scan/:benchNumber
 * Public read endpoint (no device key needed) - the student dashboard polls
 * this to find out if new equipment was scanned at its bench.
 *
 * Scoped to the bench's CURRENTLY ACTIVE session only, so a fresh session
 * never picks up a scan left over from an earlier session/test at the same
 * bench. Returns null if there's no active session or no scan yet.
 */
router.get("/latest-scan/:benchNumber", async (req, res) => {
  try {
    const sessionResult = await pool.query(
      `SELECT s.id AS session_id
       FROM lab_sessions s
       JOIN laboratory_benches b ON b.id = s.bench_id
       WHERE b.bench_number = $1 AND s.is_active = TRUE
       ORDER BY s.started_at DESC LIMIT 1`,
      [req.params.benchNumber]
    );

    if (sessionResult.rows.length === 0) {
      return res.json({ status: "ok", latest: null });
    }
    const activeSessionId = sessionResult.rows[0].session_id;

    const result = await pool.query(
      `SELECT al.id AS activity_log_id, al.created_at, al.is_simulated,
              e.code, e.name, e.description, e.usage_instructions, e.safety_instructions
       FROM activity_logs al
       JOIN equipment e ON e.id = al.equipment_id
       WHERE al.session_id = $1 AND al.event_type = 'equipment_scan'
       ORDER BY al.created_at DESC
       LIMIT 1`,
      [activeSessionId]
    );

    if (result.rows.length === 0) {
      return res.json({ status: "ok", latest: null });
    }

    res.json({ status: "ok", latest: result.rows[0] });
  } catch (err) {
    console.error("[GET /api/devices/latest-scan/:benchNumber]", err.message);
    res.status(500).json({ status: "error", message: "Failed to fetch latest scan." });
  }
});

module.exports = router;
