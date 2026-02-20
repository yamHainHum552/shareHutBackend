export const cleanupGuestRoomCloudinary = async (roomId) => {
  try {
    // Delete all possible resource types
    await cloudinary.api.delete_resources_by_prefix(`sharehut/${roomId}`, {
      resource_type: "image",
    });

    await cloudinary.api.delete_resources_by_prefix(`sharehut/${roomId}`, {
      resource_type: "raw",
    });

    await cloudinary.api.delete_resources_by_prefix(`sharehut/${roomId}`, {
      resource_type: "video",
    });

    // Delete folder after resources
    try {
      await cloudinary.api.delete_folder(`sharehut/${roomId}`);
    } catch (err) {
      if (err.error?.http_code !== 404) {
        console.error("Folder delete error:", err.message);
      }
    }
  } catch (err) {
    console.error("Cloudinary cleanup failed:", err.message);
  }
};
