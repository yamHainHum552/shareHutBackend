import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import {
  isRoomMember,
  isRoomOwner,
  updateRoomSettings,
  findRoomSettings,
} from "../modules/rooms/rooms.service.js";
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
 * Map<roomId, { ownerId, isReadOnly, allowJoins }>
 */
const roomSettingsCache = new Map();

/**
 * Fetch user info (used once per join)
 */
const getUserInfo = async (userId) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM users WHERE id = $1",
    [userId],
  );
  return rows[0];
};

/**
 * 🚨 Abandon room completely (owner left)
 */
const abandonRoom = (io, roomId) => {
  io.to(roomId).emit("room-abandoned");

  for (const [, s] of io.of("/").sockets) {
    if (s.currentRoom === roomId) {
      s.leave(roomId);
      s.currentRoom = null;
      s.isRoomMember = false;
    }
  }

  roomUsers.delete(roomId);
  roomText.delete(roomId);
  roomSettingsCache.delete(roomId);
};

export const initSocket = (io) => {
  /**
   * 🔐 AUTH
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

      let settings = roomSettingsCache.get(roomId);
      if (!settings) {
        const dbSettings = await findRoomSettings(roomId);
        if (!dbSettings) return;

        settings = {
          ownerId: dbSettings.owner_id,
          isReadOnly: dbSettings.is_read_only,
          allowJoins: dbSettings.allow_joins,
        };
        roomSettingsCache.set(roomId, settings);
      }

      if (!settings.allowJoins && settings.ownerId !== socket.user.id) {
        socket.emit("join-denied", { reason: "Room is locked" });
        return;
      }

      const allowed = await isRoomMember(roomId, socket.user.id);
      if (!allowed) return;

      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.isRoomMember = true;

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
    socket.on("text-update", ({ roomId, text }) => {
      if (!socketRateLimit(socket, "text", 100, 5000)) return;
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      if (settings.isReadOnly && settings.ownerId !== socket.user.id) return;

      roomText.set(roomId, text);
      socket.to(roomId).emit("text-update", text);
    });

    /**
     * 🔒 LOCK / UNLOCK ROOM
     */
    socket.on("toggle-room-lock", async ({ roomId, locked }) => {
      if (!socketRateLimit(socket, "lock", 10, 10000)) return;

      const isOwner = await isRoomOwner(roomId, socket.user.id);
      if (!isOwner) return;

      await updateRoomSettings(roomId, undefined, !locked);

      const cached = roomSettingsCache.get(roomId);
      if (cached) cached.allowJoins = !locked;

      io.to(roomId).emit("room-lock-updated", { locked });
    });

    /**
     * 👢 KICK USER
     */
    socket.on("kick-user", async ({ roomId, userId }) => {
      if (!socketRateLimit(socket, "kick", 10, 10000)) return;

      const isOwner = await isRoomOwner(roomId, socket.user.id);
      if (!isOwner) return;

      if (userId === socket.user.id) return;

      const usersMap = roomUsers.get(roomId);
      if (usersMap) {
        usersMap.delete(userId);
        io.to(roomId).emit("user-list", Array.from(usersMap.values()));
      }

      for (const [, s] of io.of("/").sockets) {
        if (s.user?.id === userId && s.currentRoom === roomId) {
          s.emit("kicked");
          s.leave(roomId);
          s.currentRoom = null;
          s.isRoomMember = false;
        }
      }
    });

    /**
     * 🚪 LEAVE ROOM
     */
    socket.on("leave-room", ({ roomId }) => {
      if (!roomId) return;

      const settings = roomSettingsCache.get(roomId);

      // 👑 OWNER LEAVES → ABANDON ROOM
      if (settings && settings.ownerId === socket.user.id) {
        abandonRoom(io, roomId);
        return;
      }

      const usersMap = roomUsers.get(roomId);
      if (!usersMap) return;

      usersMap.delete(socket.user.id);

      if (usersMap.size === 0) {
        roomUsers.delete(roomId);
        roomText.delete(roomId);
        roomSettingsCache.delete(roomId);
      } else {
        io.to(roomId).emit("user-list", Array.from(usersMap.values()));
      }

      socket.leave(roomId);
      socket.currentRoom = null;
      socket.isRoomMember = false;
    });

    /**
     * ❌ DISCONNECT
     */
    socket.on("disconnect", () => {
      cleanupSocketRateLimits(socket.id);

      const roomId = socket.currentRoom;
      if (!roomId) return;

      const settings = roomSettingsCache.get(roomId);

      // 👑 OWNER DISCONNECTS → ABANDON ROOM
      if (settings && settings.ownerId === socket.user.id) {
        abandonRoom(io, roomId);
        return;
      }

      const usersMap = roomUsers.get(roomId);
      if (!usersMap) return;

      usersMap.delete(socket.user.id);

      if (usersMap.size === 0) {
        roomUsers.delete(roomId);
        roomText.delete(roomId);
        roomSettingsCache.delete(roomId);
      } else {
        io.to(roomId).emit("user-list", Array.from(usersMap.values()));
      }
    });
  });
};
