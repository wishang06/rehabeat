import { existsSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const ASSETS_ID = 'virtual:public-assets';
const RESOLVED_ASSETS_ID = `\0${ASSETS_ID}`;

/**
 * Tells the app which optional audio files exist in public/ (beatmap.json and
 * the two stems), so it only requests files that are there. Probing for a
 * missing file at runtime would log a 404 in the console on every load.
 *
 * In dev, adding or removing one of those files reloads the page.
 */
function publicAssets(): Plugin {
  let publicDir = '';
  const exists = (...parts: string[]) => existsSync(path.join(publicDir, ...parts));

  return {
    name: 'rehabeat-public-assets',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    resolveId(id) {
      return id === ASSETS_ID ? RESOLVED_ASSETS_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ASSETS_ID) return undefined;
      const hasBeatmap = exists('beatmap.json');
      const hasStems = exists('stems', 'drums.mp3') && exists('stems', 'melody.mp3');
      return `export const hasBeatmap = ${hasBeatmap};\nexport const hasStems = ${hasStems};\n`;
    },
    configureServer(server) {
      const watched = ['beatmap.json', path.join('stems', 'drums.mp3'), path.join('stems', 'melody.mp3')];
      const onChange = (file: string) => {
        if (!watched.some((name) => path.resolve(file) === path.join(publicDir, name))) return;
        const module = server.moduleGraph.getModuleById(RESOLVED_ASSETS_ID);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  plugins: [react(), publicAssets()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
