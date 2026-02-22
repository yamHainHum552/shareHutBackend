import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import passport from "passport";

import { findUserByEmail, createUser, findUserById } from "./auth.service.js";
import { env } from "../../config/env.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import crypto from "crypto";
import {
  sendVerificationEmail,
  saveVerificationToken,
  verifyUserByToken,
} from "./email.service.js";

const router = express.Router();

router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "Invalid token" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await verifyUserByToken(hashedToken);

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Verification failed" });
  }
});

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${env.FRONTEND_URL}/login?error=google_auth_failed`,
  }),
  (req, res) => {
    const user = req.user;

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        // role: user.role,
      },
      env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    const isProd = env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      domain: isProd ? ".sharehutlive.com" : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  },
);

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const user = await createUser({
      name,
      email,
      password,
      provider: "local",
    });

    // 🔐 Generate token
    const rawToken = crypto.randomBytes(32).toString("hex");

    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await saveVerificationToken(user.id, hashedToken, expires);

    await sendVerificationEmail(user.email, rawToken);

    return res.status(201).json({
      message: "Registered successfully. Please verify your email.",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
  res.json({ success: true });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid Credentials" });
  }
  if (!user.is_verified) {
    return res.status(403).json({
      error: "Please verify your email first",
    });
  }

  if (user.provider === "google") {
    return res.status(400).json({
      error: "This account uses Google sign-in",
    });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid Credentials" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    {
      expiresIn: "7d",
    },
  );

  const isProd = env.NODE_ENV === "production";

  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    domain: isProd ? ".sharehutlive.com" : undefined,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({ success: true });
});

router.get("/me", authMiddleware, async (req, res) => {
  const user = await findUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    email: user.email,
    role: user.role,
    id: user.id,
    status: "active",
  });
});

export default router;
