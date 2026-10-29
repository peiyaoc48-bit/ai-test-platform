import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const api = `http://127.0.0.1:${process.env.PORT || 3100}`

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': api, '/artifacts': api, '/demo': api, '/midscene': api },
  },
})
