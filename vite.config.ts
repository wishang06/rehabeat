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
    include: ['src/**/*.test.ts'],
  },
});
