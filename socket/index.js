import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { isRoomMember, findRoomById } from "../modules/rooms/rooms.service.js";
import { socketRateLimit, cleanupSocketRateLimits } from "./rateLimiter.js";
import { pool } from "../config/db.js";
import { hashGuestToken } from "../utils/guestToken.js";
import cookie from "cookie";

export let io;

/* -------------------------------------------------------------------------- */
/*                               In-Memory State                              */
/* -------------------------------------------------------------------------- */

/**
 * roomUsers:
 *   roomId -> Map<
 *      userKey,
 *      {
 *        userData,
 *        sockets: Set<socketId>
 *      }
 *   >
 */
const roomUsers = new Map();
const roomText = new Map();
const roomSettingsCache = new Map();
const roomTyping = new Map();
const roomDrawData = new Map();

/**
 * guestTextUsage:
 *   key = `${roomId}:${guestSessionId}`
 *   value = number of edits
 */
const guestTextUsage = new Map();

/* -------------------------------------------------------------------------- */
/*                               Helper Methods                               */
/* -------------------------------------------------------------------------- */
const getUserKey = (socket) => {
  if (socket.user.type === "user") {
    return `user:${socket.user.id}`;
  }

  return `guest:${socket.user.id}`;
};

const emitTypingList = (roomId) => {
  const typingMap = roomTyping.get(roomId);
  if (!typingMap) {
    io.to(roomId).emit("typing-update", []);
    return;
  }

  const typingUsers = Array.from(typingMap.values()).map(
    (entry) => entry.userData,
  );

  io.to(roomId).emit("typing-update", typingUsers);
};

const getUserInfo = async (userId) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM users WHERE id = $1",
    [userId],
  );
  return rows[0];
};

const emitUserList = (roomId) => {
  const usersMap = roomUsers.get(roomId);
  if (!usersMap) return;

  const users = Array.from(usersMap.values())
    .map((entry) => entry.userData)
    .filter((u) => u && u.id && u.name);

  io.to(roomId).emit("user-list", users);
};

export const updateRoomSettingsCache = (roomId, updates) => {
  const current = roomSettingsCache.get(roomId) || {};

  const updated = { ...current, ...updates };
  roomSettingsCache.set(roomId, updated);

  io.to(roomId).emit("room-settings-updated", {
    isReadOnly: updated.isReadOnly,
    allowJoins: updated.allowJoins,
  });
};

const cleanupRoomUsage = (roomId) => {
  for (const key of guestTextUsage.keys()) {
    if (key.startsWith(`${roomId}:`)) {
      guestTextUsage.delete(key);
    }
  }
};
const removeSocketFromRoom = (socket) => {
  const roomId = socket.currentRoom;
  if (!roomId) return;

  /* -------------------- REMOVE FROM TYPING MAP -------------------- */
  const typingMap = roomTyping.get(roomId);
  if (typingMap) {
    const userKey = getUserKey(socket);
    const entry = typingMap.get(userKey);

    if (entry) {
      entry.sockets.delete(socket.id);

      if (entry.sockets.size === 0) {
        typingMap.delete(userKey);
      }

      if (typingMap.size === 0) {
        roomTyping.delete(roomId);
      } else {
        emitTypingList(roomId);
      }
    }
  }

  /* -------------------- ORIGINAL PRESENCE CLEANUP -------------------- */

  const usersMap = roomUsers.get(roomId);
  if (!usersMap) return;

  const userKey = getUserKey(socket);
  const entry = usersMap.get(userKey);
  if (!entry) return;

  entry.sockets.delete(socket.id);

  if (entry.sockets.size === 0) {
    usersMap.delete(userKey);
  }

  if (usersMap.size === 0) {
    roomUsers.delete(roomId);
    roomText.delete(roomId);
    roomSettingsCache.delete(roomId);
    roomDrawData.delete(roomId); // 🔥 ADD THIS
    cleanupRoomUsage(roomId);
    roomTyping.delete(roomId);
  }
  // ensure full cleanup
  else {
    emitUserList(roomId);
  }

  socket.leave(roomId);
  socket.currentRoom = null;
  socket.isRoomMember = false;
};

/* -------------------------------------------------------------------------- */
/*                               Initialize Socket                            */
/* -------------------------------------------------------------------------- */

export const initSocket = (serverIo) => {
  io = serverIo;

  /* ------------------------------ AUTH LAYER ------------------------------ */

  io.use((socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || "");
      const jwtToken = cookies.token;

      if (jwtToken) {
        const payload = jwt.verify(jwtToken, env.JWT_SECRET);
        socket.user = {
          type: "user",
          id: payload.id,
        };
        return next();
      }

      const guestOwnerToken = socket.handshake.auth?.guestOwnerToken;
      if (guestOwnerToken) {
        socket.user = {
          type: "guest-owner",
          id: guestOwnerToken, // ✅ give stable id
          name: "Guest Owner", // ✅ define name
          guestOwnerToken,
        };
        return next();
      }

      const guestSessionId = socket.handshake.auth?.guestSessionId;
      if (guestSessionId) {
        socket.user = {
          type: "guest",
          id: guestSessionId,
          name: socket.handshake.auth?.guestName || "Guest",
        };
        return next();
      }

      return next(new Error("Unauthorized"));
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  /* ------------------------------ CONNECTION ------------------------------ */

  io.on("connection", (socket) => {
    /* ------------------------------ JOIN ROOM ------------------------------ */

    socket.on("join-room", async ({ roomId }) => {
      if (!socketRateLimit(socket, "join", 3, 10000)) return;

      const room = await findRoomById(roomId);

      if (!room) {
        socket.emit("join-denied", {
          reason: "Room expired or not found",
        });
        return;
      }

      // Expiry check
      if (room.expires_at && new Date(room.expires_at) <= new Date()) {
        socket.emit("room-expired");
        return;
      }

      let settings = roomSettingsCache.get(roomId);

      if (!settings) {
        settings = {
          ownerId: room.owner_id,
          guestOwnerHash: room.guest_owner_hash,
          isReadOnly: room.is_read_only,
          allowJoins: room.allow_joins,
        };
        roomSettingsCache.set(roomId, settings);
      }

      const isOwner =
        (socket.user.type === "user" && settings.ownerId === socket.user.id) ||
        (socket.user.type === "guest-owner" &&
          settings.guestOwnerHash &&
          hashGuestToken(socket.user.guestOwnerToken) ===
            settings.guestOwnerHash);

      // Locked room enforcement
      if (!isOwner && !settings.allowJoins) {
        socket.emit("join-denied", {
          reason: "This room is locked",
        });
        return;
      }

      // Auth user membership enforcement
      if (!isOwner && socket.user.type === "user") {
        const allowed = await isRoomMember(roomId, socket.user.id);
        if (!allowed) {
          socket.emit("join-denied", {
            reason: "You are not a member of this room",
          });
          return;
        }
      }

      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.isRoomMember = true;

      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Map());
      }

      const usersMap = roomUsers.get(roomId);

      const userKey = getUserKey(socket);

      if (!usersMap.has(userKey)) {
        let userData;

        if (socket.user.type === "user") {
          userData = await getUserInfo(socket.user.id);
        } else {
          userData = {
            id: userKey,
            name: socket.user.name,
            type: socket.user.type, // ✅ preserve actual type
          };
        }

        usersMap.set(userKey, {
          userData,
          sockets: new Set([socket.id]),
        });
      } else {
        usersMap.get(userKey).sockets.add(socket.id);
      }

      emitUserList(roomId);

      if (roomText.has(roomId)) {
        socket.emit("text-update", roomText.get(roomId));
      }
      if (roomDrawData.has(roomId)) {
        socket.emit("draw-sync", roomDrawData.get(roomId));
      }
    });

    socket.on("typing-start", ({ roomId }) => {
      if (!socket.isRoomMember) return;

      const usersMap = roomUsers.get(roomId);
      if (!usersMap) return;

      const userKey = getUserKey(socket);
      const userEntry = usersMap.get(userKey);
      if (!userEntry) return;

      if (!roomTyping.has(roomId)) {
        roomTyping.set(roomId, new Map());
      }

      const typingMap = roomTyping.get(roomId);

      if (!typingMap.has(userKey)) {
        typingMap.set(userKey, {
          userData: userEntry.userData,
          sockets: new Set([socket.id]),
        });
      } else {
        typingMap.get(userKey).sockets.add(socket.id);
      }

      emitTypingList(roomId);
    });
    socket.on("typing-stop", ({ roomId }) => {
      if (!socket.isRoomMember) return;

      const typingMap = roomTyping.get(roomId);
      if (!typingMap) return;

      const userKey = getUserKey(socket);
      const entry = typingMap.get(userKey);
      if (!entry) return;

      entry.sockets.delete(socket.id);

      if (entry.sockets.size === 0) {
        typingMap.delete(userKey);
      }

      if (typingMap.size === 0) {
        roomTyping.delete(roomId);
      }

      emitTypingList(roomId);
    });

    socket.on("toggle-room-lock", async ({ roomId, locked }) => {
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      const isOwner =
        socket.user.type === "user"
          ? settings.ownerId === socket.user.id
          : socket.user.type === "guest-owner" &&
            settings.guestOwnerHash &&
            hashGuestToken(socket.user.guestOwnerToken) ===
              settings.guestOwnerHash;

      if (!isOwner) return;

      try {
        const allowJoins = !locked;

        await pool.query(
          `
      UPDATE rooms
      SET allow_joins = $1
      WHERE id = $2
      `,
          [allowJoins, roomId],
        );

        updateRoomSettingsCache(roomId, { allowJoins });
      } catch (err) {
        console.error("Failed to toggle lock:", err);
      }
    });
    socket.on("update-settings", async ({ roomId, isReadOnly }) => {
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      const isOwner =
        socket.user.type === "user"
          ? settings.ownerId === socket.user.id
          : socket.user.type === "guest-owner" &&
            settings.guestOwnerHash &&
            hashGuestToken(socket.user.guestOwnerToken) ===
              settings.guestOwnerHash;

      if (!isOwner) return;

      try {
        // Persist in DB
        await pool.query(
          `
      UPDATE rooms
      SET is_read_only = $1
      WHERE id = $2
      `,
          [isReadOnly, roomId],
        );

        // Update cache + broadcast
        updateRoomSettingsCache(roomId, { isReadOnly });
      } catch (err) {
        console.error("Failed to update read-only:", err);
      }
    });

    /* ------------------------------ TEXT UPDATE ------------------------------ */

    socket.on("text-update", ({ roomId, text }) => {
      if (!socketRateLimit(socket, "text", 100, 5000)) return;
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      const isOwner =
        socket.user.type === "user"
          ? settings.ownerId === socket.user.id
          : socket.user.type === "guest-owner" &&
            settings.guestOwnerHash &&
            hashGuestToken(socket.user.guestOwnerToken) ===
              settings.guestOwnerHash;

      // Read-only enforcement
      if (settings.isReadOnly && !isOwner) return;

      roomText.set(roomId, text);
      socket.to(roomId).emit("text-update", text);
    });
    /* ---------------- DRAW UPDATE ---------------- */

    /* ---------------- DRAW EVENT ---------------- */

    socket.on("draw-event", ({ roomId, stroke }) => {
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      const isOwner =
        socket.user.type === "user"
          ? settings.ownerId === socket.user.id
          : socket.user.type === "guest-owner" &&
            settings.guestOwnerHash &&
            hashGuestToken(socket.user.guestOwnerToken) ===
              settings.guestOwnerHash;

      // 🔐 Enforce read-only
      if (settings.isReadOnly && !isOwner) return;

      const strokes = roomDrawData.get(roomId) || [];
      strokes.push(stroke);
      roomDrawData.set(roomId, strokes);

      socket.to(roomId).emit("draw-event", stroke);
    });

    socket.on("draw-clear", ({ roomId }) => {
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      const isOwner =
        socket.user.type === "user"
          ? settings.ownerId === socket.user.id
          : socket.user.type === "guest-owner" &&
            settings.guestOwnerHash &&
            hashGuestToken(socket.user.guestOwnerToken) ===
              settings.guestOwnerHash;

      if (settings.isReadOnly && !isOwner) return;

      roomDrawData.set(roomId, []);
      io.to(roomId).emit("draw-clear");
    });
    socket.on("request-draw-sync", ({ roomId }) => {
      if (!socket.isRoomMember) return;

      const strokes = roomDrawData.get(roomId) || [];
      socket.emit("draw-sync", strokes);
    });

    socket.on("draw-undo", ({ roomId, strokeId }) => {
      if (!socket.isRoomMember) return;

      const settings = roomSettingsCache.get(roomId);
      if (!settings) return;

      const isOwner =
        socket.user.type === "user"
          ? settings.ownerId === socket.user.id
          : socket.user.type === "guest-owner" &&
            settings.guestOwnerHash &&
            hashGuestToken(socket.user.guestOwnerToken) ===
              settings.guestOwnerHash;

      if (settings.isReadOnly && !isOwner) return;

      const strokes = roomDrawData.get(roomId) || [];

      roomDrawData.set(
        roomId,
        strokes.filter((s) => s.id !== strokeId),
      );

      io.to(roomId).emit("draw-undo", strokeId);
    });

    /* ------------------------------ LEAVE ROOM ------------------------------ */

    socket.on("leave-room", () => {
      removeSocketFromRoom(socket);
    });

    /* ------------------------------ DISCONNECT ------------------------------ */

    socket.on("disconnect", () => {
      removeSocketFromRoom(socket);
      cleanupSocketRateLimits(socket.id);
    });
  });
};
