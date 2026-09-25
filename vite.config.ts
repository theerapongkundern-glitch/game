import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset URL relative, so the same build works on
// GitHub Pages (https://<user>.github.io/<repo>/), any sub-folder, or locally.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
