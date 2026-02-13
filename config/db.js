import pkg from "pg";
import { env } from "./env.js";

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,

  // ✅ REQUIRED for Render PostgreSQL
  ssl: {
    rejectUnauthorized: false,
  },

  // ✅ Pool tuning (prevents stale connection crashes)
  max: 10, // max clients in pool
  idleTimeoutMillis: 30000, // close idle clients after 30s
  connectionTimeoutMillis: 5000, // fail fast if DB unreachable
});

/* -------------------------------------------------- */
/*               Pool Error Handler (CRITICAL)       */
/* -------------------------------------------------- */

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

/* -------------------------------------------------- */
/*         Initial Connection Test (Startup Check)   */
/* -------------------------------------------------- */

(async () => {
  try {
    const client = await pool.connect();
    console.log("Connected to PostgreSQL");
    client.release();
  } catch (err) {
    console.error("PostgreSQL connection error:", err.message);
  }
})();
