import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'pdfjs-dist': ['pdfjs-dist/build/pdf', 'pdfjs-dist/build/pdf.worker.min.js'],
        },
      },
    },
  },
  resolve: {
    alias: {
      'pdfjs-dist/build/pdf.worker.entry': resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js'),
    },
  },
});
