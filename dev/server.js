// 로컬 미리보기: node dev/server.js [포트]  → http://localhost:8770  (DB 대신 dev/.data.json 에 저장)
// DATABASE_URL 이 있으면 실제 Neon 서버를, 없으면 dev/.data.json 가짜 저장소를 쓴다
if (!process.env.DATABASE_URL) process.env.LEDGER_FAKE = '1';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: handler } = await import('../api/ledger.js');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = +process.argv[2] || 8770;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/ledger') {
    let raw = ''; for await (const c of req) raw += c;
    const vreq = { method: req.method, body: raw, query: Object.fromEntries(u.searchParams), headers: req.headers };
    const vres = { status(c) { res.statusCode = c; return vres; }, setHeader: (k, v) => res.setHeader(k, v), json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); }, end: () => res.end() };
    return handler(vreq, vres);
  }
  let p = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log('dev server http://localhost:' + port));
