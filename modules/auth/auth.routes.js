import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import passport from "passport";

import { findUserByEmail, createUser, findUserById } from "./auth.service.js";
import { env } from "../../config/env.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const router = express.Router();

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
      },
      env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: ".sharehutlive.com",
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

router.post("/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  res.json({ success: true });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid Credentials" });
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

  const token = jwt.sign({ id: user.id, email: user.email }, env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    domain: ".sharehutlive.com",
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
    status: "active",
  });
});

export default router;
