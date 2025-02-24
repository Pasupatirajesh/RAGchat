import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000, // Adjusts warning threshold (optional)
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendors": ["react", "react-dom"], // Splits React libraries
          "pdfjs": ["pdfjs-dist"], // Splits PDF.js
          'process.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL),
        },
      },
    },
  },
});
