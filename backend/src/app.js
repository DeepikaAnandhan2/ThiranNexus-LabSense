const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

const healthRoutes = require("./routes/health.routes");
const equipmentRoutes = require("./routes/equipment.routes");
const sessionRoutes = require("./routes/session.routes");
const deviceRoutes = require("./routes/device.routes");
const alertRoutes = require("./routes/alert.routes");

const app = express();

// --- Core middleware ---
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// --- Routes ---
// Phase 1: health checks.
// Phase 3: equipment lookup, session start/end, and the RFID scan endpoint
// (shared by the real ESP32 and the developer simulation page).
// Auth, sensor, and experiment-step routes are added in later phases.
app.use("/api/health", healthRoutes);
app.use("/api/equipment", equipmentRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/alerts", alertRoutes);

app.get("/", (req, res) => {
  res.json({ message: "ThiranNexus LabSense API is running." });
});

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({ status: "error", message: "Route not found." });
});

// --- Central error handler ---
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.stack);
  res.status(err.status || 500).json({
    status: "error",
    message: err.message || "Internal server error.",
  });
});

module.exports = app;
