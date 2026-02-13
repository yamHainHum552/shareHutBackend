import { pool } from "../config/db.js";
import { hashGuestToken } from "../utils/guestToken.js";

import { findRoomSettings } from "../modules/rooms/rooms.service.js";

export const requireRoomOwner = async (req, res, next) => {
  const room = await findRoomSettings(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });

  // JWT owner
  if (req.user && room.owner_id === req.user.id) {
    return next();
  }

  // Guest owner
  const guestOwnerToken = req.headers["x-guest-owner-token"];
  if (
    guestOwnerToken &&
    room.guest_owner_hash &&
    hashGuestToken(guestOwnerToken) === room.guest_owner_hash
  ) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
};
