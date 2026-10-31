import { defineConfig } from 'vite';

// Relative base so the build works both locally and under a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
