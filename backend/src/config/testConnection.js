/**
 * Run with: npm run db:test
 * Confirms the backend can reach PostgreSQL using the .env credentials.
 */
const pool = require("./db");

(async () => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time, version() AS pg_version");
    console.log("✅ PostgreSQL connection successful.");
    console.log("   Server time:", result.rows[0].current_time);
    console.log("   Version:", result.rows[0].pg_version.split(",")[0]);
  } catch (err) {
    console.error("❌ PostgreSQL connection failed.");
    console.error("   Reason:", err.message);
    console.error("   Check backend/.env values and that PostgreSQL is running.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
