import { pool } from "../../config/db.js";

export const createRoom = async (id, name, ownerId, roomCode, isPrivate) => {
  await pool.query(
    `INSERT INTO rooms (id, name, owner_id, room_code, is_private)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, name, ownerId, roomCode, isPrivate],
  );

  await pool.query(
    `INSERT INTO room_members (room_id, user_id, role)
     VALUES ($1,$2,'owner')`,
    [id, ownerId],
  );
};
export const findRoomById = async (roomId) => {
  const { rows } = await pool.query(
    "SELECT id, room_code FROM rooms WHERE id = $1",
    [roomId],
  );
  return rows[0];
};

export const isRoomOwner = async (roomId, userId) => {
  const { rows } = await pool.query(
    "SELECT 1 FROM rooms WHERE id=$1 AND owner_id=$2",
    [roomId, userId],
  );
  return rows.length > 0;
};

export const addRoomMember = async (roomId, userId) => {
  await pool.query(
    "INSERT INTO room_members (room_id, user_id) VALUES ($1,$2)",
    [roomId, userId],
  );
};

export const isRoomMember = async (roomId, userId) => {
  const { rows } = await pool.query(
    "SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2",
    [roomId, userId],
  );
  return rows.length > 0;
};

export const findRoomByCode = async (roomCode) => {
  const { rows } = await pool.query("SELECT * FROM rooms WHERE room_code=$1", [
    roomCode,
  ]);
  return rows[0];
};

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
