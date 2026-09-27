const { Server } = require("socket.io");

let io = null;

/**
 * Attaches Socket.IO to the existing HTTP server (called once from server.js).
 * The teacher dashboard connects here to receive live events; nothing needs
 * to be sent FROM the client for now, so we don't register any inbound
 * event handlers beyond basic connect/disconnect logging.
 */
function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Fetches the singleton io instance so routes can emit events after they
 * write to the database. Throws if called before initSocket() - this is
 * intentional: an un-wired emit should fail loudly in development rather
 * than silently do nothing.
 */
function getIO() {
  if (!io) {
    throw new Error("Socket.IO has not been initialized yet. Call initSocket(server) first.");
  }
  return io;
}

module.exports = { initSocket, getIO };
