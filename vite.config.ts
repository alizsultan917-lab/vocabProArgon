import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

const FLAT_ROOT_FILES = [
  'style.css',
  'youtube-window.css',
  'map-window.css',
  'wallpaper-enhancements.css',
  'perf-monitor.js',
  'script.js',
  'backup-manager.js',
  'wallpaper-folder-service.js',
  'wallpaper-tone-contrast.js',
  'wallpaper-adaptive-text.js',
  'youtube-playlist-folder-service.js',
  'youtube-window.js',
  'map-symbols-data.js',
  'map-window.js',
  'README.md',
];

function copyFlatRootAssetsPlugin() {
  return {
    name: 'copy-flat-root-assets',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(outDir)) return;
      for (const fileName of FLAT_ROOT_FILES) {
        const srcPath = path.resolve(__dirname, fileName);
        const destPath = path.resolve(outDir, fileName);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), copyFlatRootAssetsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

