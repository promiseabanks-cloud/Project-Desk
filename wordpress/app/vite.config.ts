import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds into the plugin. The plugin reads .vite/manifest.json to print the right file names.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../project-desk/app',
    emptyOutDir: true,
    manifest: true,
    assetsDir: 'assets',
  },
})
