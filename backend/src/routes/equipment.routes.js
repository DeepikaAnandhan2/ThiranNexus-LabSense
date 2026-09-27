const express = require("express");
const pool = require("../config/db");

const router = express.Router();

/**
 * GET /api/equipment
 * Lists all known equipment - useful for testing and for the developer
 * simulation page to know what "Scan X" buttons should send.
 */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name, description, usage_instructions, safety_instructions FROM equipment ORDER BY id"
    );
    res.json({ status: "ok", equipment: result.rows });
  } catch (err) {
    console.error("[GET /api/equipment]", err.message);
    res.status(500).json({ status: "error", message: "Could not fetch equipment." });
  }
});

/**
 * GET /api/equipment/:code
 * Fetch a single equipment record by its code (e.g. "burette").
 */
router.get("/:code", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name, description, usage_instructions, safety_instructions FROM equipment WHERE code = $1",
      [req.params.code]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Equipment not found." });
    }
    res.json({ status: "ok", equipment: result.rows[0] });
  } catch (err) {
    console.error("[GET /api/equipment/:code]", err.message);
    res.status(500).json({ status: "error", message: "Could not fetch equipment." });
  }
});

module.exports = router;
