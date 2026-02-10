import express from "express";
import { v4 as uuid } from "uuid";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import {
  createRoom,
  updateRoomSettings,
  findRoomByCode,
} from "./rooms.service.js";
import { generateRoomCode } from "../../utils/roomCode.js";
import { findRoomsByOwner } from "./rooms.service.js";
import { isRoomMember, isRoomOwner, findRoomById } from "./rooms.service.js";

const router = express.Router();

/**
 * Create room
 */

router.get("/my", authMiddleware, async (req, res) => {
  const rooms = await findRoomsByOwner(req.user.id);

  res.json({
    rooms,
  });
});

/**
 * Join room by code
 */
router.post("/join", authMiddleware, async (req, res) => {
  const { roomCode } = req.body;

  const room = await findRoomByCode(roomCode);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  res.json({
    roomId: room.id,
    roomCode: room.room_code,
    requiresApproval: room.is_private,
  });
});

router.get("/:roomId/membership", authMiddleware, async (req, res) => {
  const { roomId } = req.params;

  const isMember = await isRoomMember(roomId, req.user.id);

  res.json({ isMember });
});

router.get("/:roomId/meta", authMiddleware, async (req, res) => {
  const { roomId } = req.params;

  const isOwner = await isRoomOwner(roomId, req.user.id);
  const room = await findRoomById(roomId);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  res.json({
    isOwner,
    roomCode: room.room_code,
    isReadOnly: room.is_ready_only,
    allowJoins: room.allow_joins,
    currentUserId: req.user.id,
  });
});

router.patch("/:roomId/settings", authMiddleware, async (req, res) => {
  const { roomId } = req.params;
  const { isReadOnly, allowJoins } = req.body;

  const isOwner = await isRoomOwner(roomId, req.user.id);
  if (!isOwner) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await updateRoomSettings(roomId, isReadOnly, allowJoins);

  res.json({
    message: "Room settings updated",
    settings: { isReadOnly, allowJoins },
  });
});

router.post("/", authMiddleware, async (req, res) => {
  const roomId = uuid();
  const roomCode = generateRoomCode();

  try {
    await createRoom(roomId, req.body.name, req.user.id, roomCode, true);

    res.status(201).json({
      roomId,
      roomCode,
    });
  } catch (err) {
    if (err.message === "ROOM_LIMIT_REACHED") {
      return res.status(403).json({
        error: "You can only create up to 3 rooms",
      });
    }

    throw err; // handled by global error middleware
  }
});

export default router;
