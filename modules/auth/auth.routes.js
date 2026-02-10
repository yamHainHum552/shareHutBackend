import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import passport from "passport";

import { findUserByEmail, createUser, findUserById } from "./auth.service.js";
import { env } from "../../config/env.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const router = express.Router();

/**
 * =========================
 * GOOGLE OAUTH START
 * =========================
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

/**
 * =========================
 * GOOGLE OAUTH CALLBACK
 * =========================
 */
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
      },
      env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.redirect(`${env.FRONTEND_URL}/oauth-success?token=${token}`);
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
      return res
        .status(409)
        .json({ error: "User already exists with this email" });
    }

    await createUser({
      name,
      email,
      password,
      provider: "local",
    });

    return res.status(201).json({
      message: "User registered successfully",
    });
  } catch (error) {
    console.error("Register error:", error);

    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "User already exists with this email" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid Credentials" });
  }

  // 🔒 Block Google-only accounts
  if (user.provider === "google") {
    return res.status(400).json({
      error: "This account uses Google sign-in",
    });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid Credentials" });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({ token });
});

/**
 * =========================
 * CURRENT USER
 * =========================
 */
router.get("/me", authMiddleware, async (req, res) => {
  const user = await findUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    email: user.email,
    status: "active",
  });
});

export default router;
