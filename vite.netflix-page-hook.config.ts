import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/netflix',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/netflix/page-hook.ts', import.meta.url)),
      name: 'NetflixDualSubPageHook',
      formats: ['iife'],
      fileName: () => 'page-hook.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
