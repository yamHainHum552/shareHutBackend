import { pool } from "../../config/db.js";

export const createFileRecord = async ({
  id,
  roomId,
  uploadedBy,
  uploadedByGuest,
  publicId,
  url,
  resourceType,
  format,
  size,
}) => {
  await pool.query(
    `
    INSERT INTO room_files
    (id, room_id, uploaded_by, uploaded_by_guest, public_id, url, resource_type, format, size)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      id,
      roomId,
      uploadedBy,
      uploadedByGuest,
      publicId,
      url,
      resourceType,
      format,
      size,
    ],
  );
};

export const getRoomFiles = async (roomId) => {
  const { rows } = await pool.query(
    `SELECT * FROM room_files WHERE room_id = $1 ORDER BY created_at ASC`,
    [roomId],
  );
  return rows;
};

export const deleteFilesByRoom = async (roomId) => {
  const { rows } = await pool.query(
    `SELECT public_id FROM room_files WHERE room_id = $1`,
    [roomId],
  );
  return rows;
};
export const countFilesByRoom = async (roomId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM room_files WHERE room_id = $1`,
    [roomId],
  );

  return Number(rows[0].count);
};

export const getFileById = async (fileId) => {
  const { rows } = await pool.query(`SELECT * FROM room_files WHERE id = $1`, [
    fileId,
  ]);
  return rows[0] || null;
};

export const deleteFileRecord = async (fileId) => {
  await pool.query(`DELETE FROM room_files WHERE id = $1`, [fileId]);
};
