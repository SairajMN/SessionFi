import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  define: {
    // Handle Node.js globals in browser
    "process.env": JSON.stringify({}),
    global: "globalThis",
  },
  resolve: {
    alias: {
      // Polyfill for Node.js Buffer
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    include: ["buffer"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
});
