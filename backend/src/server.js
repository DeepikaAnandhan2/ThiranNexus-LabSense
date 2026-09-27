const http = require("http");
const app = require("./app");
const { initSocket } = require("./sockets");
require("dotenv").config();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Phase 6: real-time teacher dashboard. Routes emit through
// require("./sockets").getIO() after they write to the database.
initSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 ThiranNexus LabSense backend running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
});
