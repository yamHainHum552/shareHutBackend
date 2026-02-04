import { pool } from "../../config/db.js";

/**
 * Create a room and add owner as member
 */
export const createRoom = async (id, name, ownerId, roomCode, isPrivate) => {
  // Create room
  await pool.query(
    `
    INSERT INTO rooms (id, name, owner_id, room_code, is_private)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [id, name, ownerId, roomCode, isPrivate],
  );

  // Add owner as member (idempotent)
  await pool.query(
    `
    INSERT INTO room_members (room_id, user_id, role)
    VALUES ($1, $2, 'owner')
    ON CONFLICT (room_id, user_id) DO NOTHING
    `,
    [id, ownerId],
  );
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
export const addRoomMember = async (roomId, userId) => {
  await pool.query(
    `
    INSERT INTO room_members (room_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT (room_id, user_id) DO NOTHING
    `,
    [roomId, userId],
  );
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
