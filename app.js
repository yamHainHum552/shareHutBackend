import express from "express";
import cors from "cors";

import authRoutes from "./modules/auth/auth.routes.js";
import roomRoutes from "./modules/rooms/rooms.routes.js";
import requestRoutes from "./modules/requests/requests.routes.js";

// import { apiLimiter, authLimiter } from "./middleware/rateLimit.middleware.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "20kb" })); // Payload protection
// app.use(apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/requests", requestRoutes);

export default app;
