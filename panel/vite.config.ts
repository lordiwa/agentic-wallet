import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    // Puerto propio: `npm run dev` levanta el panel al lado del dashboard
    // viejo de web/, que ya usa el 5173.
    port: 5174,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
