import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * Optional authentication middleware
 *
 * - If Authorization header is present → validate JWT
 * - If valid → attach req.user
 * - If missing → continue as guest
 * - If invalid → reject
 */
export const authMiddlewareOptional = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return next(); // guest access allowed
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
