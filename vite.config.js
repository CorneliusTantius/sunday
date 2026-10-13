import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  plugins: [preact()],
  server: { allowedHosts: ['.ts.net'] },
  build: { outDir: '../../dist', emptyOutDir: true },
});
