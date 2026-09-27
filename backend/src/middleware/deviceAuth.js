/**
 * Verifies the shared device API key sent by the ESP32 (or the developer
 * simulation page) in the "x-device-api-key" header. This is NOT user
 * authentication - it just stops random requests from posting fake
 * equipment/sensor events. See HARDWARE_INTEGRATION.md (Phase 8).
 */
module.exports = function verifyDeviceKey(req, res, next) {
  const providedKey = req.header("x-device-api-key");
  const expectedKey = process.env.DEVICE_API_KEY;

  if (!expectedKey) {
    console.warn("[deviceAuth] DEVICE_API_KEY is not set in .env - rejecting all device requests.");
    return res.status(500).json({ status: "error", message: "Server misconfigured: DEVICE_API_KEY missing." });
  }

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ status: "error", message: "Invalid or missing device API key." });
  }

  next();
};
