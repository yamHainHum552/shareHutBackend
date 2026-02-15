import express from "express";
import cors from "cors";
import passport from "./config/passport.js";
import authRoutes from "./modules/auth/auth.routes.js";
import roomRoutes from "./modules/rooms/rooms.routes.js";
import requestRoutes from "./modules/requests/requests.routes.js";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";

// import { apiLimiter, authLimiter } from "./middleware/rateLimit.middleware.js";

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-guest-owner-token",
      "x-guest-session-id",
      "x-guest-name",
    ],
  }),
);

app.use(passport.initialize());
app.use(express.json({ limit: "20kb" })); // Payload protection
// app.use(apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/requests", requestRoutes);

export default app;
