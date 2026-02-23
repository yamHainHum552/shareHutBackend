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
  // Always provide a prefix to prevent ID collisions between guest and auth users
  return `${socket.user.type}:${socket.user.id}`;
};
export const getLiveRoomSnapshot = () => {
  const rooms = [];

  for (const [roomId, usersMap] of roomUsers.entries()) {
    rooms.push({
      roomId,
      participantsCount: usersMap.size,
    });
  }

  return rooms;
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

  // We convert the map to an array and ensure we only send what the frontend needs
  const users = Array.from(usersMap.values())
    .map((entry) => entry.userData)
    .filter((u) => u && u.id); // Guests use session IDs, so u.id will exist

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
export const cleanupSocketRoom = (roomId) => {
  roomUsers.delete(roomId);
  roomText.delete(roomId);
  roomSettingsCache.delete(roomId);
  roomTyping.delete(roomId);
  roomDrawData.delete(roomId);
};

/* -------------------------------------------------------------------------- */
/*                               Initialize Socket                            */
/* -------------------------------------------------------------------------- */

export const initSocket = (serverIo) => {
  io = serverIo;

  /* ------------------------------ AUTH LAYER ------------------------------ */

  /* socket/index.js */
  io.use(async (socket, next) => {
    try {
      const parsedCookies = cookie.parse(socket.handshake.headers.cookie || "");
      const jwtToken = parsedCookies.token;

      const guestOwnerToken = socket.handshake.auth?.guestOwnerToken;
      const guestSessionId = socket.handshake.auth?.guestSessionId;
      const guestName = socket.handshake.auth?.guestName || "Guest";

      /* -------------------------------------------------- */
      /* 1️⃣ Authenticated User (JWT)                       */
      /* -------------------------------------------------- */
      if (jwtToken) {
        try {
          const payload = jwt.verify(jwtToken, env.JWT_SECRET);

          const { rows } = await pool.query(
            "SELECT id, is_banned FROM users WHERE id = $1",
            [payload.id],
          );

          if (!rows.length) {
            return next(new Error("User not found"));
          }

          if (rows[0].is_banned) {
            return next(new Error("Account banned"));
          }

          socket.user = {
            type: "user",
            id: payload.id,
          };

          return next();
        } catch (err) {
          console.error("JWT verification failed:", err.message);
          return next(new Error("Invalid JWT"));
        }
      }

      /* -------------------------------------------------- */
      /* 2️⃣ Guest Owner                                    */
      /* -------------------------------------------------- */
      if (guestOwnerToken) {
        const hashed = hashGuestToken(guestOwnerToken);

        socket.user = {
          type: "guest-owner",
          id: hashed, // 🔥 Use hashed value as stable ID
          guestOwnerToken, // keep raw for potential comparisons
          name: "Room Owner (Guest)",
        };

        return next();
      }

      /* -------------------------------------------------- */
      /* 3️⃣ Regular Guest                                  */
      /* -------------------------------------------------- */
      if (guestSessionId) {
        socket.user = {
          type: "guest",
          id: guestSessionId,
          name: guestName,
        };

        return next();
      }

      /* -------------------------------------------------- */
      /* ❌ Unauthorized                                     */
      /* -------------------------------------------------- */
      return next(new Error("Unauthorized socket connection"));
    } catch (err) {
      console.error("Socket auth error:", err.message);
      return next(new Error("Unauthorized"));
    }
  });

  /* ------------------------------ CONNECTION ------------------------------ */

  io.on("connection", (socket) => {
    /* socket/index.js */

    /* socket/index.js */

    const removeSocketFromRoom = (socket) => {
      const roomId = socket.currentRoom;
      if (!roomId) return;

      const userKey = getUserKey(socket);
      const usersMap = roomUsers.get(roomId);

      if (usersMap && usersMap.has(userKey)) {
        const entry = usersMap.get(userKey);
        entry.sockets.delete(socket.id);

        // Only remove user from list if ALL their tabs/sockets are closed
        if (entry.sockets.size === 0) {
          usersMap.delete(userKey);

          // Notify remaining users that this person actually left
          if (usersMap.size > 0) {
            emitUserList(roomId);
          }
        }
      }

      // NOTE: We do NOT delete roomUsers, roomText, or roomSettingsCache here.
      // This ensures that if the last person refreshes, the room state is
      // still there when they reconnect 200ms later.

      socket.leave(roomId);
      socket.currentRoom = null;
      socket.isRoomMember = false;
    };

    // ... inside io.on("connection") ...

    socket.on("join-room", async ({ roomId }) => {
      if (!socketRateLimit(socket, "join", 3, 10000)) return;

      const room = await findRoomById(roomId);
      if (!room) {
        socket.emit("join-denied", { reason: "Room not found" });
        return;
      }

      // 1. Settings Cache Logic
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

      // 2. Authorization
      const isOwner =
        (socket.user.type === "user" && settings.ownerId === socket.user.id) ||
        (socket.user.type === "guest-owner" &&
          settings.guestOwnerHash === socket.user.id);

      if (!isOwner) {
        if (!settings.allowJoins) {
          socket.emit("join-denied", { reason: "Room is locked" });
          return;
        }
        if (socket.user.type === "user") {
          const allowed = await isRoomMember(roomId, socket.user.id);
          if (!allowed) {
            socket.emit("approval-required");
            return;
          }
        }
      }

      // 3. State Management
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.isRoomMember = true;

      if (!roomUsers.has(roomId)) {
        roomUsers.set(roomId, new Map());
      }

      const usersMap = roomUsers.get(roomId);
      const userKey = getUserKey(socket);

      // 4. Participant Registration
      if (!usersMap.has(userKey)) {
        let userData;
        if (socket.user.type === "user") {
          const dbUser = await getUserInfo(socket.user.id);
          userData = {
            id: socket.user.id,
            name: dbUser?.name || "Member",
            type: "user",
          };
        } else {
          // Use userKey (type:id) as the unique ID for the frontend list
          userData = {
            id: userKey,
            name: socket.user.name || "Guest",
            type: socket.user.type,
          };
        }
        usersMap.set(userKey, { userData, sockets: new Set([socket.id]) });
      } else {
        // Re-attach to existing user entry (handles multi-tab and refresh)
        usersMap.get(userKey).sockets.add(socket.id);
      }

      // 5. Final Sync
      emitUserList(roomId);

      if (roomText.has(roomId))
        socket.emit("text-update", roomText.get(roomId));
      if (roomDrawData.has(roomId))
        socket.emit("draw-sync", roomDrawData.get(roomId));

      socket.emit("room-settings-updated", {
        isReadOnly: settings.isReadOnly,
        allowJoins: settings.allowJoins,
      });
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
