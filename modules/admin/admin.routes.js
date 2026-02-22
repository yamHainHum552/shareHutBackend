import express from "express";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.js";
import * as controller from "./admin.controller.js";

const router = express.Router();

router.use(authMiddleware);
router.use(requireSuperAdmin);

// Overview stats
router.get("/stats", controller.getStats);
router.get("/live-rooms", controller.getLiveRooms);
// Users
router.get("/users", controller.getUsers);
router.patch("/users/:userId/ban", controller.toggleBan);
router.get("/metrics", controller.getAdvancedMetrics);
// Rooms
router.get("/rooms", controller.getRooms);
router.delete("/rooms/:roomId", controller.deleteRoom);

export default router;
