import path from 'node:path';
import { defineConfig, normalizePath, type Plugin, type ResolvedConfig, type UserConfig } from 'vite';

export function marginConfig(sharedDirectory = process.env.MARGIN_SHARED_DIR): UserConfig {
  const customRoomDir = sharedDirectory ? path.resolve(sharedDirectory) : undefined;
  let config: ResolvedConfig;
  const privateRooms: Plugin = {
    name: 'margin-private-room-files',
    configResolved(resolved) { config = resolved; },
    configureServer(server) { server.middlewares.use(protectRoomFiles); },
    configurePreviewServer(server) { server.middlewares.use(protectRoomFiles); },
  };
  function protectRoomFiles(req: { url?: string }, res: { statusCode: number; setHeader: (key: string, value: string) => void; end: (body: string) => void }, next: () => void) {
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).replaceAll('\\', '/'); }
    catch { res.statusCode = 400; res.end('Invalid path.'); return; }
    const candidates = [path.resolve(config.root, `.${pathname}`), path.resolve(config.root, config.build.outDir, `.${pathname}`)];
    if (pathname.startsWith('/@fs/')) candidates.push(path.resolve('/', pathname.slice(5)));
    const customPath = customRoomDir?.toLowerCase();
    const insideCustomStore = customPath && candidates.some(candidate => {
      const value = candidate.toLowerCase();
      return value === customPath || value.startsWith(customPath + path.sep);
    });
    if (/(^|\/)\.margin-shared[^/]*(\/|$)/i.test(pathname) || insideCustomStore) {
      res.statusCode = 403;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Room storage is private. Open shared projects through Margin.');
      return;
    }
    next();
  }
  const authOrigin = process.env.SUPABASE_URL;
  const hosted = process.env.VITE_MARGIN_MODE === 'hosted';
  let origin = '';
  if(hosted) {
    if(!authOrigin)throw new Error('SUPABASE_URL is required to build the hosted CSP.');
    const parsed = new URL(authOrigin);
    const fixture = process.env.MARGIN_SYNTHETIC_TEST === '1' && parsed.hostname === '127.0.0.1';
    if((parsed.protocol !== 'https:' && !fixture) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')throw new Error('Invalid Supabase origin.');
    origin = parsed.origin;
  }
  return {
    // Application assets are source imports. Do not copy a public directory
    // which might accidentally contain a custom room store.
    publicDir: false,
    build: { outDir: process.env.MARGIN_BUILD_OUTDIR || 'dist', rollupOptions: { output: { manualChunks: id => hosted && id.includes('/node_modules/@supabase/') ? 'supabase-auth' : undefined } } },
    plugins: [privateRooms, { name:'margin-hosted-csp', transformIndexHtml(html) { return hosted ? html.replace("connect-src 'self' ws://127.0.0.1:5173", `connect-src 'self' ${origin}`) : html; } }],
    server: {
      cors: false,
      fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.margin-shared*/**', ...(customRoomDir ? [`${normalizePath(customRoomDir)}/**`] : [])] },
      proxy: { '/api': { target: process.env.MARGIN_API_ORIGIN || 'http://127.0.0.1:5180', changeOrigin: false } },
    },
    preview: { cors: false, proxy: { '/api': { target: process.env.MARGIN_API_ORIGIN || 'http://127.0.0.1:4180', changeOrigin: false } } },
  };
}
export default defineConfig(() => marginConfig());
