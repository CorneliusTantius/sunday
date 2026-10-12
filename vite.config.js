import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('./web', import.meta.url).pathname,
  build: { outDir: '../dist', emptyOutDir: true },
});
