import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const authMiddlewareOptional = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
