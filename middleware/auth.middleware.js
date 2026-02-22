import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../config/db.js";

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized - No token" });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (!decoded?.id) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    const { rows } = await pool.query(
      "SELECT is_banned FROM users WHERE id = $1",
      [decoded.id],
    );

    if (!rows.length) {
      return res.status(401).json({ error: "User not found" });
    }

    if (rows[0].is_banned) {
      return res.status(403).json({ error: "Account banned" });
    }

    req.user = decoded;
    return next();
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

export const authMiddlewareOptional = (req, res, next) => {
  try {
    const token = req.cookies?.token;

    if (!token) return next();

    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;

    return next();
  } catch (err) {
    console.error("Optional auth error:", err.message);
    return next(); // do NOT hard fail
  }
};
