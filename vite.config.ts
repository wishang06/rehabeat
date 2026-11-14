import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The Python venv holds about 30,000 files; watching it slows every module request.
    watch: { ignored: ['**/tools/.venv/**', '**/tools/out/**', '**/test-results/**'] },
  },
  test: {
    environment: 'node',
    // tools/songs/e2e/*.e2e.ts runs Demucs, so it is left to `npm run test:songs`.
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'tools/.venv/**', 'tools/out/**'],
  },
});
