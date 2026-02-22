import { pool } from "../config/db.js";

export const requireSuperAdmin = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [
    req.user.id,
  ]);

  if (!rows.length || rows[0].role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
};
