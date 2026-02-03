import pkg from "pg";
import { env } from "./env.js";

const { Pool } = pkg;
console.log(env.DATABASE_URL);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool
  .connect()
  .then((client) => {
    console.log("Connected to PostgreSQL");
    client.release();
  })
  .catch((err) => {
    console.error("PostgreSQL connection error:", err.message);
  });
