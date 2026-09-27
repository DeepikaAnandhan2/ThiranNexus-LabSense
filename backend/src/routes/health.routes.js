const express = require("express");
const pool = require("../config/db");

const router = express.Router();

/**
 * GET /api/health
 * Basic liveness check - confirms the API process is running.
 */
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "ThiranNexus LabSense API",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/db
 * Confirms the API can reach PostgreSQL.
 */
router.get("/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");
    res.json({
      status: "ok",
      database: "connected",
      server_time: result.rows[0].server_time,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      database: "unreachable",
      message: err.message,
    });
  }
});

module.exports = router;
