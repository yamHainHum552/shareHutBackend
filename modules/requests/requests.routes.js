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
// import { joinRequestLimiter } from "../../middleware/rateLimit.middleware.js";

const router = express.Router();

/**
 * User requests to join room
 */
router.post(
  "/:roomId",
  authMiddleware,
  // joinRequestLimiter,
  async (req, res) => {
    await createJoinRequest(uuid(), req.params.roomId, req.user.id);
    res.json({ message: "Join request sent" });
  },
);

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
 * Owner approves or rejects request
 */
router.post("/approve/:requestId", authMiddleware, async (req, res) => {
  const request = await getRequestById(req.params.requestId);
  if (!request) return res.status(404).json({ error: "Request not found" });

  const isOwner = await isRoomOwner(request.room_id, req.user.id);
  if (!isOwner) return res.status(403).json({ error: "Forbidden" });

  if (req.body.approve) {
    await addRoomMember(request.room_id, request.user_id);
    await updateRequestStatus(request.id, "approved");
  } else {
    await updateRequestStatus(request.id, "rejected");
  }

  res.json({ message: "Request processed" });
});

export default router;
