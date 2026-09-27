/**
 * PostgreSQL connection pool.
 * All queries in the app should go through this shared pool
 * instead of opening individual client connections.
 */
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected error on idle PostgreSQL client:", err.message);
});

module.exports = pool;
