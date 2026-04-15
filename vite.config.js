import { defineConfig } from "vite";

export default defineConfig({
  // CRITICO per Electron: usa path relativi nel build (./assets invece di /assets)
  base: "./",

  build: {
    outDir:    "dist",
    emptyOutDir: true,
  },

  server: {
    port:       5173,
    strictPort: true,
    open:       false,   // Electron apre la finestra, non il browser
  }
});
