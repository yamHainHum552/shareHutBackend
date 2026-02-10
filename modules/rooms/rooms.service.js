import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";

export const createRoom = async (id, name, ownerId, roomCode, isPrivate) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Lock existing rooms owned by this user
    const { rowCount } = await client.query(
      `
      SELECT 1
      FROM rooms
      WHERE owner_id = $1
      FOR UPDATE
      `,
      [ownerId],
    );

    if (rowCount >= env.MAX_ROOMS_PER_USER) {
      throw new Error("ROOM_LIMIT_REACHED");
    }

    // Create room
    await client.query(
      `
      INSERT INTO rooms (id, name, owner_id, room_code, is_private)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [id, name, ownerId, roomCode, isPrivate],
    );

    // Add owner as member
    await client.query(
      `
      INSERT INTO room_members (room_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (room_id, user_id) DO NOTHING
      `,
      [id, ownerId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.message === "ROOM_LIMIT_REACHED") {
      throw err;
    }

    throw err;
  } finally {
    client.release();
  }
};

/**
 * Find room by ID
 */
export const findRoomById = async (roomId) => {
  const { rows } = await pool.query(
    "SELECT id, room_code FROM rooms WHERE id = $1",
    [roomId],
  );
  return rows[0] || null;
};

/**
 * Check if user is room owner
 */
export const isRoomOwner = async (roomId, userId) => {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM rooms WHERE id = $1 AND owner_id = $2",
    [roomId, userId],
  );
  return rowCount > 0;
};

/**
 * Add a user to a room (idempotent & race-safe)
 */
export const addRoomMember = async (roomId, userId, role = "member") => {
  await pool.query(
    `
    INSERT INTO room_members (room_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (room_id, user_id) DO NOTHING
    `,
    [roomId, userId, role],
  );
};
export const findRoomSettings = async (roomId) => {
  const { rows } = await pool.query(
    `
    SELECT owner_id, is_read_only, allow_joins
    FROM rooms
    WHERE id = $1
    `,
    [roomId],
  );
  return rows[0] || null;
};

/**
 * Check if user is a room member
 */
export const isRoomMember = async (roomId, userId) => {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
    [roomId, userId],
  );
  return rowCount > 0;
};

/**
 * Find room by public/private code
 */
export const findRoomByCode = async (roomCode) => {
  const { rows } = await pool.query(
    "SELECT * FROM rooms WHERE room_code = $1",
    [roomCode],
  );
  return rows[0] || null;
};

export const updateRoomSettings = async (roomId, isReadOnly, allowJoins) => {
  await pool.query(
    `
    UPDATE rooms
    SET
      is_read_only = COALESCE($2, is_read_only),
      allow_joins  = COALESCE($3, allow_joins)
    WHERE id = $1
    `,
    [roomId, isReadOnly, allowJoins],
  );
};

/**
 * List rooms owned by a user
 */
export const findRoomsByOwner = async (ownerId) => {
  const { rows } = await pool.query(
    `
    SELECT id, name, room_code, created_at
    FROM rooms
    WHERE owner_id = $1
    ORDER BY created_at DESC
    `,
    [ownerId],
  );

  return rows;
};
