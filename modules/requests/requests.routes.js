import express from "express";
import { v4 as uuid } from "uuid";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import {
  createJoinRequest,
  getPendingRequests,
  getRequestById,
  updateRequestStatus,
} from "./requests.service.js";
import { isRoomOwner, addRoomMember } from "../rooms/rooms.service.js";
import { pool } from "../../config/db.js";
import { io } from "../../socket/index.js"; // ✅ ADD THIS

const router = express.Router();

/**
 * User requests to join room
 */
router.post("/:roomId", authMiddleware, async (req, res) => {
  const requestId = uuid();
  const roomId = req.params.roomId;

  await createJoinRequest(requestId, roomId, req.user.id);

  // 🔔 NOTIFY ROOM OWNER (AND ANY OWNER SOCKETS)
  if (io) {
    io.to(roomId).emit("join-request-created", {
      roomId,
      requestId,
    });
  }

  res.json({ message: "Join request sent" });
});

/**
 * Owner views pending requests
 */
router.get("/:roomId", authMiddleware, async (req, res) => {
  const isOwner = await isRoomOwner(req.params.roomId, req.user.id);
  if (!isOwner) return res.status(403).json({ error: "Forbidden" });

  const requests = await getPendingRequests(req.params.roomId);
  res.json(requests);
});

/**
 * Owner approves or rejects request (IDEMPOTENT & ATOMIC)
 */
router.post("/approve/:requestId", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const request = await getRequestById(req.params.requestId, client);
    if (!request) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "pending") {
      await client.query("ROLLBACK");
      return res.json({ message: "Request already processed" });
    }

    const isOwner = await isRoomOwner(request.room_id, req.user.id);
    if (!isOwner) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Forbidden" });
    }

    if (req.body.approve) {
      await addRoomMember(request.room_id, request.user_id, "member");
      await updateRequestStatus(request.id, "approved", client);

      // 🔔 OPTIONAL: notify requester
      if (io) {
        io.to(request.room_id).emit("join-request-approved", {
          userId: request.user_id,
        });
      }
    } else {
      await updateRequestStatus(request.id, "rejected", client);
    }

    await client.query("COMMIT");
    res.json({ message: "Request processed" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

export default router;
