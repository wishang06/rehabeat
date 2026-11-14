/** `npm run test:songs`: the end-to-end add, which runs the real Python pipeline and Demucs. */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tools/songs/e2e/**/*.e2e.ts'],
    reporters: ['verbose'], // shows the Demucs time the test prints
    testTimeout: 20 * 60 * 1000, // Demucs on a laptop CPU
    hookTimeout: 60 * 1000,
  },
});
