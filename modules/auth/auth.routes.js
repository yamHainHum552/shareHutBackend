import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";

import { findUserByEmail, createUser, findUserById } from "./auth.service.js";
import { env } from "../../config/env.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 1️⃣ Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // 2️⃣ Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res
        .status(409)
        .json({ error: "User already exists with this email" });
    }

    // 3️⃣ Hash password
    const hash = await bcrypt.hash(password, 10);

    // 4️⃣ Create user
    await createUser(uuid(), name, email, hash);

    return res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register error:", error);

    // 5️⃣ Handle DB unique constraint edge case
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
  if (!user)
    return res.status(401).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: "Invalid email or password" });

  const token = jwt.sign({ id: user.id }, env.JWT_SECRET);
  res.json({ token });
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
