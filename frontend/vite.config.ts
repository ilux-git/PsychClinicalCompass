import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const prefixes = [
  "/auth",
  "/patients",
  "/surveys",
  "/survey-assignments",
  "/adherence",
  "/analytics",
  "/participation",
  "/conversations",
  "/alerts",
  "/clinical-decisions",
  "/tasks",
  "/doctors",
  "/health",
];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      prefixes.map((path) => [path, { target: "http://127.0.0.1:8780" }]),
    ),
  },
});
