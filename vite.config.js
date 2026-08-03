import { defineConfig } from 'vite'

// Relative base so dist works on GitHub user pages and project pages.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  publicDir: 'public',
  server: {
    port: 5173,
    strictPort: false,
  },
})
