import pkg from "pg";
import { env } from "./env.js";

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

(async () => {
  try {
    const client = await pool.connect();
    console.log("Connected to PostgreSQL");
    client.release();
  } catch (err) {
    console.error("PostgreSQL connection error:", err.message);
  }
})();
