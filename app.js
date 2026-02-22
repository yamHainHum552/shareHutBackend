import express from "express";
import cors from "cors";
import passport from "./config/passport.js";
import authRoutes from "./modules/auth/auth.routes.js";
import roomRoutes from "./modules/rooms/rooms.routes.js";
import requestRoutes from "./modules/requests/requests.routes.js";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import fileRoutes from "./modules/files/files.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());

/* -------------------- CORS FIX -------------------- */

const allowedOrigins = [
  "https://sharehutlive.com",
  "https://www.sharehutlive.com",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow curl / Postman

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("Blocked by CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
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

/* -------------------------------------------------- */

app.use(passport.initialize());
app.use(express.json({ limit: "20kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/requests", requestRoutes);

export default app;
