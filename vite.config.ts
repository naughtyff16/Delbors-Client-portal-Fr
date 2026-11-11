import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Client + vendor portal — separate build so external users never download internal screens (ADR-004).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  preview: { port: 4174 },
  // Source maps off for public hosting (don't ship source); opt in with SOURCEMAP=true.
  build: { target: 'es2022', sourcemap: process.env.SOURCEMAP === 'true', assetsInlineLimit: 0 },
});
