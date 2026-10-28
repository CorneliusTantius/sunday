import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  plugins: [preact(), tailwindcss()],
  server: { allowedHosts: ['.ts.net'] },
  build: { outDir: '../../dist', emptyOutDir: true },
});
