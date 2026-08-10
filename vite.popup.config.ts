import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/hbo',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/popup.ts', import.meta.url)),
      name: 'HboDualSubPopup',
      formats: ['iife'],
      fileName: () => 'popup.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
