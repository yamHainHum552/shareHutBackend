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

console.log(
  env.DATABASE_URL,
  env.FRONTEND_URL,
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.JWT_SECRET,
  env.MAX_ROOMS_PER_USER,
  env.PORT,
);

export default app;
