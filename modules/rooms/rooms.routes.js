import express from "express";
import { v4 as uuid } from "uuid";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { createRoom, findRoomByCode } from "./rooms.service.js";
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
  });
});

router.post("/", authMiddleware, async (req, res) => {
  const roomId = uuid();
  const roomCode = generateRoomCode();

  await createRoom(roomId, req.body.name, req.user.id, roomCode, true);

  res.status(201).json({
    roomId,
    roomCode,
  });
});

export default router;
