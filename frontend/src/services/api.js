import axios from "axios";

// In dev, Vite proxies /api to http://localhost:5000 (see vite.config.js)
const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export default api;
