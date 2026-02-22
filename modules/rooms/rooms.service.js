import { pool } from "../../config/db.js";
import { v4 as uuid } from "uuid";
import { generateRoomCode } from "../../utils/roomCode.js";
import {
  generateGuestOwnerToken,
  hashGuestToken,
} from "../../utils/guestToken.js";
import { env } from "../../config/env.js";
import { validate as uuidValidate } from "uuid";
import cloudinary from "../../utils/Cloudinary.js";
import { cleanupGuestRoomCloudinary } from "../files/cleanup.service.js";

/**
 * ===========================
 * AUTHENTICATED ROOM CREATION
 * ===========================
 */
export const createRoom = async (id, name, ownerId, roomCode, isPrivate) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 LOCK USER ROW (CRITICAL FIX)
    await client.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [
      ownerId,
    ]);

    const { rowCount } = await client.query(
      `SELECT 1 FROM rooms WHERE owner_id = $1`,
      [ownerId],
    );

    if (rowCount >= env.MAX_ROOMS_PER_USER) {
      throw new Error("ROOM_LIMIT_REACHED");
    }

    await client.query(
      `
      INSERT INTO rooms (id, name, owner_id, room_code, is_private)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [id, name, ownerId, roomCode, isPrivate],
    );

    await client.query(
      `
      INSERT INTO room_members (room_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT DO NOTHING
      `,
      [id, ownerId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * ===========================
 * GUEST ROOM CREATION
 * ===========================
 */
export const createGuestRoom = async (name, guestToken) => {
  const ownerHash = hashGuestToken(guestToken);

  const { rowCount } = await pool.query(
    `
    SELECT 1 FROM rooms
    WHERE guest_owner_hash = $1
      AND expires_at > NOW()
    `,
    [ownerHash],
  );

  if (rowCount > 0) {
    throw new Error("GUEST_ROOM_LIMIT");
  }

  const roomId = uuid();
  const roomCode = generateRoomCode();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await pool.query(
    `
  INSERT INTO rooms (
    id,
    name,
    room_code,
    is_private,
    guest_owner_hash,
    allow_joins,
    is_read_only,
    expires_at
  )
  VALUES ($1, $2, $3, true, $4, true, false, $5)
  `,
    [roomId, name, roomCode, ownerHash, expiresAt],
  );

  return {
    roomId,
    roomCode,
    expiresAt,
  };
};

/**
 * ===========================
 * LOOKUPS
 * ===========================
 */
export const findRoomById = async (roomId) => {
  if (!roomId || !uuidValidate(roomId)) {
    return null;
  }
  const { rows } = await pool.query(
    `
    SELECT
  id,
  room_code,
  owner_id,
  name, 
  guest_owner_hash,
  is_read_only,
  allow_joins,
  expires_at
FROM rooms

   WHERE id = $1
AND is_deleted IS NOT TRUE
AND (expires_at IS NULL OR expires_at > NOW())
    `,
    [roomId],
  );

  return rows[0] || null;
};

export const findRoomByCode = async (roomCode) => {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM rooms
    WHERE room_code = $1
    AND is_deleted IS NOT TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
    `,
    [roomCode],
  );

  return rows[0] || null;
};

export const isRoomOwner = async (roomId, userId) => {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM rooms WHERE id = $1 AND owner_id = $2`,
    [roomId, userId],
  );
  return rowCount > 0;
};

export const isRoomMember = async (roomId, userId) => {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId],
  );
  return rowCount > 0;
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

// adjust import path if needed

export const deleteExpiredGuestRooms = async () => {
  try {
    const { rows } = await pool.query(`
      SELECT id FROM rooms
      WHERE guest_owner_hash IS NOT NULL
        AND expires_at <= NOW()
    `);

    if (!rows.length) return;

    for (const room of rows) {
      const roomId = room.id;

      try {
        /* ---------------- Cloudinary Cleanup ---------------- */
        await cleanupGuestRoomCloudinary(roomId);

        /* ---------------- DB Cleanup ---------------- */
        await pool.query(`DELETE FROM room_files WHERE room_id = $1`, [roomId]);

        await pool.query(`DELETE FROM rooms WHERE id = $1`, [roomId]);
        // Cleanup socket memory
        roomUsers.delete(roomId);
        roomText.delete(roomId);
        roomSettingsCache.delete(roomId);
        roomTyping.delete(roomId);
        roomDrawData.delete(roomId);
        cleanupRoomUsage(roomId);

        console.log(`✅ Expired guest room cleaned: ${roomId}`);
      } catch (err) {
        console.error(
          `❌ Failed cleaning expired room ${roomId}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("❌ Expired room cleanup failed:", err.message);
  }
};
export const removeRoomMember = async (roomId, userId) => {
  await pool.query(
    `
    DELETE FROM room_members
    WHERE room_id = $1 AND user_id = $2
    `,
    [roomId, userId],
  );
};

export const findRoomSettings = async (roomId) => {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      owner_id,
      guest_owner_hash,
      is_read_only,
      allow_joins,
      expires_at
    FROM rooms
    WHERE id = $1
      AND (expires_at IS NULL OR expires_at > NOW())
    `,
    [roomId],
  );

  return rows[0] || null;
};

export const getRoomMemberRole = async (roomId, userId) => {
  const { rows } = await pool.query(
    `
    SELECT role
    FROM room_members
    WHERE room_id = $1 AND user_id = $2
    `,
    [roomId, userId],
  );

  return rows[0]?.role || null;
};
