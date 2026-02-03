import http from "http";
import { Server } from "socket.io";
import app from "./app.js";
import { env } from "./config/env.js";
import { initSocket } from "./socket/index.js";

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

initSocket(io);

server.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});
