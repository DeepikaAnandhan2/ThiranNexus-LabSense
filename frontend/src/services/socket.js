import { io } from "socket.io-client";

// Vite only proxies /api (see vite.config.js) - Socket.IO needs the real
// backend origin. Override with VITE_SOCKET_URL if the backend ever runs
// somewhere other than localhost:5000.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

const socket = io(SOCKET_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});

export default socket;
