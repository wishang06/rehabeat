import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Routes the router serves from index.html. A static host with no rewrite rule
 * (the EC2 web root) needs a real file at each one, or a reload of /play is a 404.
 * Vercel uses vercel.json instead.
 */
const ROUTES = ['play', 'hud', 'doctor'];

function routeFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rehabeat-route-files',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    // After the files are written. A failed build has no index.html to copy.
    writeBundle(options) {
      const dir = options.dir ?? outDir;
      const index = path.join(dir, 'index.html');
      if (!existsSync(index)) return;
      for (const route of ROUTES) {
        mkdirSync(path.join(dir, route), { recursive: true });
        copyFileSync(index, path.join(dir, route, 'index.html'));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), routeFiles()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
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
