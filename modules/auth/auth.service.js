import { pool } from "../../config/db.js";

export const findUserByEmail = async (email) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
    email,
  ]);
  return rows[0];
};

export const createUser = async (id, name, email, passwordHash) => {
  await pool.query(
    "INSERT INTO users (id, name, email, password_hash) VALUES ($1,$2,$3,$4)",
    [id, name, email, passwordHash],
  );
};

export const findUserById = async (id) => {
  const { rows } = await pool.query(
    "SELECT id, email FROM users WHERE id = $1",
    [id],
  );
  return rows[0];
};
