import cloudinary from "../../utils/Cloudinary.js";
import { pool } from "../../config/db.js";
export const cleanupGuestRoomCloudinary = async (roomId) => {
  try {
    // 1️⃣ Get all files from DB
    const { rows } = await pool.query(
      `SELECT public_id, resource_type FROM room_files WHERE room_id = $1`,
      [roomId],
    );

    if (!rows.length) return;

    // 2️⃣ Delete each file properly using its resource_type
    for (const file of rows) {
      await cloudinary.uploader.destroy(file.public_id, {
        resource_type: file.resource_type,
        invalidate: true,
      });
    }

    // 3️⃣ Delete folder safely
    try {
      await cloudinary.api.delete_folder(`sharehut/${roomId}`);
    } catch (err) {
      if (err.error?.http_code !== 404) {
        console.error("Folder delete error:", err.message);
      }
    }

    console.log(`✅ Cloudinary cleaned for room ${roomId}`);
  } catch (err) {
    console.error("Cloudinary cleanup failed:", err.message);
  }
};
