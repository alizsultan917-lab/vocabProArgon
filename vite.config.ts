import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {Readable} from 'stream';
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

let cachedAnubisCookie = '';

async function solveAnubisAndFetchStream(compUrl: string) {
  if (cachedAnubisCookie) {
    const testRes = await fetch(compUrl, {
      headers: {Cookie: cachedAnubisCookie},
    });
    const ct = (testRes.headers.get('content-type') || '').toLowerCase();
    if (testRes.ok && (ct.startsWith('video/') || ct.startsWith('audio/'))) {
      return testRes;
    }
  }
  const cRes = await fetch(compUrl);
  const ct0 = (cRes.headers.get('content-type') || '').toLowerCase();
  if (cRes.ok && (ct0.startsWith('video/') || ct0.startsWith('audio/'))) {
    return cRes;
  }
  const setCookies0 =
    typeof (cRes.headers as any).getSetCookie === 'function'
      ? ((cRes.headers as any).getSetCookie() as string[])
      : [];
  const cookies0 = setCookies0.map((c) => c.split(';')[0]).join('; ');
  const html = await cRes.text();
  const m = html.match(
    /<script id="anubis_challenge" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  const chal = JSON.parse(m[1]);
  const randomData: string = chal.challenge.randomData;
  const diff: number = chal.rules.difficulty || 2;
  let nonce = 0;
  let hash = '';
  const targetPrefix = '0'.repeat(diff);
  while (nonce < 500000) {
    hash = crypto
      .createHash('sha256')
      .update(randomData + nonce)
      .digest('hex');
    if (hash.startsWith(targetPrefix)) break;
    nonce++;
  }
  const passUrl = `https://invidious.f5.si/.within.website/x/cmd/anubis/api/pass-challenge?id=${encodeURIComponent(chal.challenge.id)}&response=${hash}&nonce=${nonce}&redir=${encodeURIComponent(compUrl)}&elapsedTime=15`;
  const pRes = await fetch(passUrl, {
    redirect: 'manual',
    headers: cookies0 ? {Cookie: cookies0} : {},
  });
  const setCookies1 =
    typeof (pRes.headers as any).getSetCookie === 'function'
      ? ((pRes.headers as any).getSetCookie() as string[])
      : [];
  const cookies1 = setCookies1
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ');
  if (cookies1) {
    cachedAnubisCookie = cookies1;
  }
  return fetch(compUrl, {
    headers: cachedAnubisCookie ? {Cookie: cachedAnubisCookie} : {},
  });
}

function ytStreamProxyPlugin() {
  return {
    name: 'yt-stream-proxy',
    configureServer(server: any) {
      server.middlewares.use(
        '/api/yt-stream',
        async (req: any, res: any) => {
          try {
            const urlObj = new URL(req.url || '', 'http://localhost:3000');
            const id = (urlObj.searchParams.get('id') || '').trim();
            const resPref = (urlObj.searchParams.get('res') || 'best').trim();
            const fmtPref = (urlObj.searchParams.get('fmt') || 'video/mp4').trim();
            if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
              res.statusCode = 400;
              res.end('Invalid video ID');
              return;
            }
            const infoRes = await fetch(
              `https://invidious.f5.si/api/v1/videos/${encodeURIComponent(id)}?local=true`,
            );
            if (!infoRes.ok) {
              res.statusCode = 502;
              res.end('Upstream metadata unavailable');
              return;
            }
            const info: any = await infoRes.json();
            const isAudio =
              resPref === 'audio' || fmtPref.startsWith('audio/');
            let chosenUrl = '';
            if (isAudio && Array.isArray(info.adaptiveFormats)) {
              const audioStream =
                info.adaptiveFormats.find(
                  (s: any) =>
                    String(s.itag) === '140' ||
                    String(s.type || '').includes('audio/mp4'),
                ) ||
                info.adaptiveFormats.find((s: any) =>
                  String(s.type || '').startsWith('audio/'),
                );
              if (audioStream?.url) chosenUrl = audioStream.url;
            }
            if (!chosenUrl && Array.isArray(info.formatStreams) && info.formatStreams[0]?.url) {
              chosenUrl = info.formatStreams[0].url;
            }
            if (!chosenUrl && Array.isArray(info.adaptiveFormats) && info.adaptiveFormats[0]?.url) {
              chosenUrl = info.adaptiveFormats[0].url;
            }
            if (!chosenUrl) {
              res.statusCode = 404;
              res.end('No stream found');
              return;
            }
            const compUrl = chosenUrl.startsWith('http')
              ? chosenUrl.replace(
                  'https://invidious.f5.si/videoplayback?',
                  'https://invidious.f5.si/companion/videoplayback?',
                )
              : `https://invidious.f5.si${chosenUrl.replace(/^\/videoplayback\?/, '/companion/videoplayback?')}`;

            const streamRes = await solveAnubisAndFetchStream(compUrl);
            if (!streamRes || !streamRes.ok || !streamRes.body) {
              res.statusCode = 502;
              res.end('Stream unavailable');
              return;
            }
            const ct = streamRes.headers.get('content-type') || 'video/mp4';
            const cl = streamRes.headers.get('content-length');
            res.setHeader('Content-Type', ct);
            res.setHeader('Access-Control-Allow-Origin', '*');
            if (cl) res.setHeader('Content-Length', cl);
            Readable.fromWeb(streamRes.body as any).pipe(res);
          } catch (e: any) {
            res.statusCode = 500;
            res.end(e?.message || 'Internal stream error');
          }
        },
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      ytStreamProxyPlugin(),
      copyFlatRootAssetsPlugin(),
    ],
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
