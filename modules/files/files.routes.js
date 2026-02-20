import express from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import cloudinary from "../../utils/Cloudinary.js";
import { authMiddlewareOptional } from "../../middleware/authMiddlewareOptional.js";
import { findRoomById, isRoomMember } from "../rooms/rooms.service.js";
import { hashGuestToken } from "../../utils/guestToken.js";
import { createFileRecord, getRoomFiles } from "./files.service.js";
import { io } from "../../socket/index.js";
import {
  getFileById,
  deleteFileRecord,
  countFilesByRoom,
} from "./files.service.js";
import { fileUploadLimiter } from "../../middleware/rateLimit.middleware.js";
import { pool } from "../../config/db.js";

const router = express.Router();

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

router.post(
  "/:roomId",
  fileUploadLimiter,
  authMiddlewareOptional,
  upload.single("file"),
  async (req, res) => {
    try {
      const room = await findRoomById(req.params.roomId);
      if (!room) return res.status(404).json({ error: "Room not found" });

      if (room.expires_at && new Date(room.expires_at) <= new Date()) {
        return res.status(403).json({ error: "Room expired" });
      }

      const isAuthRoom = !!room.owner_id;
      const isGuestRoom = !!room.guest_owner_hash;

      /* ---------- AUTH ROOM CHECK ---------- */
      if (isAuthRoom) {
        if (!req.user) return res.status(401).json({ error: "Login required" });

        const isMember = await isRoomMember(room.id, req.user.id);
        if (!isMember) return res.status(403).json({ error: "Not a member" });
      }

      /* ---------- GUEST ROOM CHECK ---------- */
      if (isGuestRoom && !req.user) {
        if (!room.allow_joins) {
          return res.status(403).json({ error: "Room locked" });
        }
      }

      if (!req.file) {
        return res.status(400).json({ error: "File required" });
      }

      /* ---------- MIME VALIDATION ---------- */
      const allowedTypes = [
        "image/",
        "application/pdf",
        "text/",
        "application/json",
        "application/zip",
      ];

      const isAllowed = allowedTypes.some((type) =>
        req.file.mimetype.startsWith(type),
      );

      if (!isAllowed) {
        return res.status(400).json({ error: "File type not allowed" });
      }

      /* ---------- UPLOAD TO CLOUDINARY ---------- */
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `sharehut/${room.id}`,
            resource_type: "auto",
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );

        stream.end(req.file.buffer);
      });

      const fileId = uuid();

      await createFileRecord({
        id: fileId,
        roomId: room.id,
        uploadedBy: req.user?.id || null,
        uploadedByGuest: !req.user,
        publicId: result.public_id,
        url: result.secure_url,
        resourceType: result.resource_type,
        format: result.format,
        size: result.bytes,
      });

      /* ---------- SOCKET BROADCAST ---------- */
      /* ---------- SOCKET BROADCAST ---------- */
      if (io) {
        io.to(room.id).emit("file-added", {
          id: fileId,
          url: result.secure_url,
          format: result.format,
          size: result.bytes,
          resourceType: result.resource_type, // 🔥 ADD THIS
        });
      }

      res.json({ success: true, fileId, url: result.secure_url });
    } catch (err) {
      console.error("File upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);
router.delete("/:fileId", authMiddlewareOptional, async (req, res) => {
  try {
    const file = await getFileById(req.params.fileId);
    if (!file) return res.status(404).json({ error: "File not found" });

    const room = await findRoomById(file.room_id);
    if (!room) return res.status(404).json({ error: "Room not found" });

    let isOwner = false;

    /* -------- AUTH OWNER -------- */
    if (req.user && room.owner_id === req.user.id) {
      isOwner = true;
    }

    /* -------- GUEST OWNER -------- */
    const guestOwnerToken = req.headers["x-guest-owner-token"];
    if (
      guestOwnerToken &&
      room.guest_owner_hash &&
      hashGuestToken(guestOwnerToken) === room.guest_owner_hash
    ) {
      isOwner = true;
    }

    if (!isOwner) {
      return res
        .status(403)
        .json({ error: "Only room owner can delete files" });
    }

    /* -------- DELETE CLOUDINARY ASSET -------- */
    await cloudinary.uploader.destroy(file.public_id, {
      invalidate: true,
      resource_type: file.resource_type,
    });

    /* -------- DELETE DB RECORD -------- */
    await deleteFileRecord(file.id);

    /* -------- CHECK IF ROOM IS GUEST ROOM -------- */
    const isGuestRoom = !!room.guest_owner_hash;

    if (isGuestRoom) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) FROM room_files WHERE room_id = $1`,
        [room.id],
      );

      const remainingFiles = Number(rows[0].count);

      if (remainingFiles === 0) {
        try {
          await cloudinary.api.delete_folder(`sharehut/${room.id}`);
        } catch (err) {
          if (err.error?.http_code !== 404) {
            console.error("Folder cleanup error:", err.message);
          }
        }
      }
    }

    /* -------- SOCKET BROADCAST -------- */
    if (io) {
      io.to(room.id).emit("file-deleted", { fileId: file.id });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("File deletion error:", err);
    res.status(500).json({ error: "Deletion failed" });
  }
});

router.get("/:roomId", authMiddlewareOptional, async (req, res) => {
  const files = await getRoomFiles(req.params.roomId);
  res.json(files);
});

export default router;
