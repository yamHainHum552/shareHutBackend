import { pool } from "../../config/db.js";

export const createJoinRequest = async (id, roomId, userId) => {
  await pool.query(
    `
  INSERT INTO join_requests (id, room_id, user_id)
  VALUES ($1, $2, $3)
  ON CONFLICT (room_id, user_id) DO NOTHING
  `,
    [id, roomId, userId],
  );
};

export const getPendingRequests = async (roomId) => {
  const { rows } = await pool.query(
    "SELECT * FROM join_requests WHERE room_id=$1 AND status='pending'",
    [roomId],
  );
  return rows;
};

export const getRequestById = async (id, client = pool) => {
  const { rows } = await client.query(
    "SELECT * FROM join_requests WHERE id = $1",
    [id],
  );
  return rows[0];
};

export const updateRequestStatus = async (id, status, client = pool) => {
  await client.query("UPDATE join_requests SET status = $1 WHERE id = $2", [
    status,
    id,
  ]);
};
