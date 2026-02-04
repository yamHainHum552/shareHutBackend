import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { isRoomMember } from "../modules/rooms/rooms.service.js";
import { socketRateLimit, cleanupSocketRateLimits } from "./rateLimiter.js";
import { pool } from "../config/db.js";

/**
 * Map<roomId, Map<userId, { id, name }>>
 */
const roomUsers = new Map();

/**
 * Map<roomId, string>
 */
const roomText = new Map();

/**
 * Fetch user info
 */
const getUserInfo = async (userId) => {
  const { rows } = await pool.query("SELECT id, name FROM users WHERE id=$1", [
    userId,
  ]);
  return rows[0];
};

export const initSocket = (io) => {
  /**
   * 🔐 AUTH MIDDLEWARE
   */
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));

    try {
      socket.user = jwt.verify(token, env.JWT_SECRET);
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    /**
     * 🚪 JOIN ROOM
     */
    socket.on("join-room", async ({ roomId }) => {
      if (!socketRateLimit(socket, "join", 3, 10000)) return;

      const allowed = await isRoomMember(roomId, socket.user.id);
      if (!allowed) return;

      socket.join(roomId);
      socket.currentRoom = roomId;

      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Map());
      }

      const usersMap = roomUsers.get(roomId);

      if (!usersMap.has(socket.user.id)) {
        const userInfo = await getUserInfo(socket.user.id);
        usersMap.set(socket.user.id, userInfo);
      }

      io.to(roomId).emit("user-list", Array.from(usersMap.values()));

      if (roomText.has(roomId)) {
        socket.emit("text-update", roomText.get(roomId));
      }
    });

    /**
     * 📝 TEXT UPDATE
     */
    socket.on("text-update", async ({ roomId, text }) => {
      if (!socketRateLimit(socket, "text", 100, 5000)) return;

      const allowed = await isRoomMember(roomId, socket.user.id);
      if (!allowed) return;

      roomText.set(roomId, text);
      socket.to(roomId).emit("text-update", text);
    });

    /**
     * 🚪 LEAVE ROOM
     */
    socket.on("leave-room", ({ roomId }) => {
      if (!roomId) return;

      const usersMap = roomUsers.get(roomId);
      if (!usersMap) return;

      usersMap.delete(socket.user.id);

      if (usersMap.size === 0) {
        roomUsers.delete(roomId);
        roomText.delete(roomId);
      } else {
        io.to(roomId).emit("user-list", Array.from(usersMap.values()));
      }

      socket.leave(roomId);
      socket.currentRoom = null;
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);

      cleanupSocketRateLimits(socket.id);

      const roomId = socket.currentRoom;
      if (!roomId) return;

      const usersMap = roomUsers.get(roomId);
      if (!usersMap) return;

      usersMap.delete(socket.user.id);

      if (usersMap.size === 0) {
        roomUsers.delete(roomId);
        roomText.delete(roomId);
      } else {
        io.to(roomId).emit("user-list", Array.from(usersMap.values()));
      }
    });
  });
};
