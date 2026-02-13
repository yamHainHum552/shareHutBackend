import http from "http";
import { Server } from "socket.io";
import app from "./app.js";
import { env } from "./config/env.js";
import { initSocket } from "./socket/index.js";
import { deleteExpiredGuestRooms } from "./modules/rooms/rooms.service.js";

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true,
  },
});

// Every 5 minutes
setInterval(
  async () => {
    try {
      await deleteExpiredGuestRooms();
      console.log("Expired guest rooms cleaned");
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  },
  5 * 60 * 1000,
);

initSocket(io);

server.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});
