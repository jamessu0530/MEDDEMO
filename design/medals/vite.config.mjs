import { defineConfig } from '../../frontend/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
const path = (p) => fileURLToPath(new URL(p, import.meta.url))
export default defineConfig({
  root: path('./gallery/'),
  base: './',
  resolve: { alias: [
    { find: /^three$/, replacement: path('../../frontend/node_modules/three/build/three.module.js') },
    { find: /^three\/addons\//, replacement: path('../../frontend/node_modules/three/examples/jsm/') },
  ]},
  build: { outDir: path('../../frontend/public/medal-designs/'), emptyOutDir: false },
})
