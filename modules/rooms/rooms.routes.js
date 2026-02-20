import express from "express";
import { v4 as uuid } from "uuid";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requireRoomOwner } from "../../middleware/roomOwner.middleware.js";
import {
  createRoom,
  createGuestRoom,
  updateRoomSettings,
  findRoomByCode,
  findRoomsByOwner,
  isRoomMember,
  findRoomById,
} from "./rooms.service.js";
import { generateRoomCode } from "../../utils/roomCode.js";
import { addRoomMember } from "./rooms.service.js";
import { authMiddlewareOptional } from "../../middleware/authMiddlewareOptional.js";
import { createJoinRequest } from "../requests/requests.service.js";
import { updateRoomSettingsCache } from "../../socket/index.js";
import { hashGuestToken } from "../../utils/guestToken.js";
import { pool } from "../../config/db.js";
import { generateGuestOwnerToken } from "../../utils/guestToken.js";
const router = express.Router();

/**
 * GUEST ROOM
 */
router.post("/guest", async (req, res) => {
  const { name, guestOwnerToken } = req.body;

  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Invalid room name" });
  }

  try {
    let ownerToken = guestOwnerToken;
    let ownerHash;

    if (ownerToken) {
      ownerHash = hashGuestToken(ownerToken);

      const { rows } = await pool.query(
        `
        SELECT id, room_code, expires_at
        FROM rooms
        WHERE guest_owner_hash = $1
          AND expires_at > NOW()
        LIMIT 1
        `,
        [ownerHash],
      );

      if (rows.length > 0) {
        // 🔥 Reuse existing active room
        return res.status(200).json({
          roomId: rows[0].id,
          roomCode: rows[0].room_code,
          expiresAt: rows[0].expires_at,
          ownerToken,
        });
      }
    }

    ownerToken = generateGuestOwnerToken();
    ownerHash = hashGuestToken(ownerToken);

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
        expires_at
      )
      VALUES ($1, $2, $3, true, $4, $5)
      `,
      [roomId, name, roomCode, ownerHash, expiresAt],
    );

    return res.status(201).json({
      roomId,
      roomCode,
      expiresAt,
      ownerToken,
    });
  } catch (err) {
    console.error("Guest room creation error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/:roomId/membership", authMiddlewareOptional, async (req, res) => {
  try {
    const room = await findRoomById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const isAuthRoom = !!room.owner_id;
    const isGuestRoom = !!room.guest_owner_hash;

    /* ---------------------------------- */
    /* 🔒 AUTH ROOMS REQUIRE LOGIN       */
    /* ---------------------------------- */
    if (isAuthRoom && !req.user) {
      return res.json({ isMember: false });
    }

    /* ---------------------------------- */
    /* 👑 JWT OWNER                       */
    /* ---------------------------------- */
    if (req.user && room.owner_id === req.user.id) {
      return res.json({ isMember: true });
    }

    /* ---------------------------------- */
    /* 👤 AUTH USER MEMBER                */
    /* ---------------------------------- */
    if (req.user) {
      const member = await isRoomMember(room.id, req.user.id);
      if (member) {
        return res.json({ isMember: true });
      }
    }

    /* ---------------------------------- */
    /* 👑 GUEST OWNER TOKEN               */
    /* ---------------------------------- */
    const rawHeader = req.headers["x-guest-owner-token"];
    const guestOwnerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (
      typeof guestOwnerToken === "string" &&
      room.guest_owner_hash &&
      hashGuestToken(guestOwnerToken) === room.guest_owner_hash
    ) {
      return res.json({ isMember: true });
    }

    /* ---------------------------------- */
    /* 👤 Anonymous in Guest Room         */
    /* ---------------------------------- */
    if (isGuestRoom && !req.user && room.allow_joins) {
      return res.json({ isMember: true });
    }

    return res.json({ isMember: false });
  } catch (err) {
    console.error("Membership check error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/my", authMiddleware, async (req, res) => {
  const rooms = await findRoomsByOwner(req.user.id);
  res.json({ rooms });
});
router.post("/join", authMiddlewareOptional, async (req, res) => {
  try {
    const { roomCode } = req.body;

    if (!roomCode) {
      return res.status(400).json({ error: "Room code required" });
    }

    const room = await findRoomByCode(roomCode.toUpperCase());
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const isAuthRoom = !!room.owner_id;
    const isGuestRoom = !!room.guest_owner_hash;

    /* ---------------------------------- */
    /* 🔒 AUTH ROOMS REQUIRE LOGIN       */
    /* ---------------------------------- */
    if (isAuthRoom && !req.user) {
      return res.status(401).json({
        error: "Authentication required to join this room",
      });
    }

    /* ---------------------------------- */
    /* 👑 OWNER DIRECT ENTRY              */
    /* ---------------------------------- */
    if (req.user && room.owner_id === req.user.id) {
      return res.json({
        roomId: room.id,
        roomCode: room.room_code,
        requiresApproval: false,
      });
    }

    /* ---------------------------------- */
    /* 🚫 If joins disabled               */
    /* ---------------------------------- */
    if (!room.allow_joins) {
      return res.status(403).json({
        error: "This room is not accepting new members",
      });
    }

    /* ---------------------------------- */
    /* 👤 GUEST ROOM DIRECT ENTRY         */
    /* ---------------------------------- */
    if (isGuestRoom && !req.user) {
      return res.json({
        roomId: room.id,
        roomCode: room.room_code,
        requiresApproval: false,
      });
    }

    /* ---------------------------------- */
    /* 🔎 Already member?                 */
    /* ---------------------------------- */
    if (req.user) {
      const alreadyMember = await isRoomMember(room.id, req.user.id);
      if (alreadyMember) {
        return res.json({
          roomId: room.id,
          roomCode: room.room_code,
          requiresApproval: false,
        });
      }

      /* ---------------------------------- */
      /* 📨 Create join request             */
      /* ---------------------------------- */
      const requestId = uuid();
      await createJoinRequest(requestId, room.id, req.user.id);

      return res.json({
        roomId: room.id,
        roomCode: room.room_code,
        requiresApproval: true,
      });
    }

    /* ---------------------------------- */
    /* ❌ Fallback safety                  */
    /* ---------------------------------- */
    return res.status(403).json({ error: "Unable to join room" });
  } catch (err) {
    console.error("Join room error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * ROOM META
 */
router.get("/:roomId/meta", authMiddlewareOptional, async (req, res) => {
  const room = await findRoomById(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });

  let isOwner = false;

  // JWT owner
  if (req.user && room.owner_id === req.user.id) {
    isOwner = true;
  }

  // Guest owner
  const guestOwnerToken = req.headers["x-guest-owner-token"];
  if (
    guestOwnerToken &&
    room.guest_owner_hash &&
    hashGuestToken(guestOwnerToken) === room.guest_owner_hash
  ) {
    isOwner = true;
  }

  res.json({
    roomCode: room.room_code,
    isReadOnly: room.is_read_only,
    allowJoins: room.allow_joins,
    currentUserId: req.user?.id ?? "guest",
    isOwner,
    name: room.name,
    isGuestRoom: !!room.guest_owner_hash, // 🔥 add this
    expiresAt: room.expires_at,
  });
});

/**
 * UPDATE SETTINGS (JWT OR GUEST)
 */
router.patch("/:roomId/settings", requireRoomOwner, async (req, res) => {
  const { isReadOnly, allowJoins } = req.body;

  await updateRoomSettings(req.params.roomId, isReadOnly, allowJoins);

  // 🔥 update socket cache immediately
  updateRoomSettingsCache(req.params.roomId, {
    isReadOnly,
    allowJoins,
  });

  res.json({ message: "Room settings updated" });
});

/**
 * AUTH ROOM CREATION
 */
router.post("/", authMiddleware, async (req, res) => {
  const roomId = uuid();
  const roomCode = generateRoomCode();

  try {
    await createRoom(roomId, req.body.name, req.user.id, roomCode, true);
    res.status(201).json({ roomId, roomCode });
  } catch (err) {
    if (err.message === "ROOM_LIMIT_REACHED") {
      return res.status(403).json({
        error: "You can only create up to 3 rooms",
      });
    }
    throw err;
  }
});

export default router;
