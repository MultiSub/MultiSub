import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

function copySharedIcons(): Plugin {
  const sourceDirectory = fileURLToPath(new URL('./public/icons', import.meta.url));
  const outputDirectory = fileURLToPath(new URL('./dist/netflix/icons', import.meta.url));

  return {
    name: 'copy-shared-extension-icons',
    apply: 'build',
    async closeBundle() {
      await mkdir(outputDirectory, { recursive: true });
      for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
        if (entry.isFile()) {
          await copyFile(
            fileURLToPath(new URL(`./public/icons/${entry.name}`, import.meta.url)),
            fileURLToPath(new URL(`./dist/netflix/icons/${entry.name}`, import.meta.url)),
          );
        }
      }
    },
  };
}

export default defineConfig({
  publicDir: 'netflix-public',
  plugins: [copySharedIcons()],
  build: {
    outDir: 'dist/netflix',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/netflix/content.ts', import.meta.url)),
      name: 'NetflixDualSubContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
