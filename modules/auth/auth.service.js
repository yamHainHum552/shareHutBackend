import { pool } from "../../config/db.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

/**
 * Find user by email
 */
export const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, password_hash, provider FROM users WHERE email = $1",
    [email],
  );
  return rows[0] || null;
};

/**
 * Create user (local or google)
 */
export const createUser = async ({
  name,
  email,
  password = null,
  provider = "local",
}) => {
  let passwordHash = null;

  if (password) {
    passwordHash = await bcrypt.hash(password, 10);
  }

  const id = uuidv4();

  const { rows } = await pool.query(
    `
    INSERT INTO users (id, name, email, password_hash, provider)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, provider
    `,
    [id, name, email, passwordHash, provider],
  );

  return rows[0];
};

/**
 * Find user by ID
 */
export const findUserById = async (id) => {
  const { rows } = await pool.query(
    "SELECT id, email FROM users WHERE id = $1",
    [id],
  );
  return rows[0] || null;
};
