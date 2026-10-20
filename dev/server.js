// 로컬 미리보기: node dev/server.js [포트]  → http://localhost:8770  (DB 대신 dev/.data.json 에 저장)
// DATABASE_URL 이 있으면 실제 Neon 서버를, 없으면 dev/.data.json 가짜 저장소를 쓴다
import http from 'node:http';
import fs from 'node:fs';
// 프로젝트 루트의 .env 파일(커밋 안 됨)을 읽어 환경변수로 넣는다. 한 줄에 KEY=값. 이미 셸에서 준 값이 우선.
//   SITE_PASSWORD=...  → 정산 노트 "새로 정하기"가 로컬에서도 동작
//   DATABASE_URL=...   → dev/.data.json 대신 실제 Neon
try {
  for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]; if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
  console.log('.env 읽음' + (process.env.SITE_PASSWORD ? ' (SITE_PASSWORD 있음)' : ' (SITE_PASSWORD 비어 있음)'));
} catch (_) { console.log('.env 없음 → .env.example 을 복사해서 만들면 됨'); }
if (process.env.LEDGER_FAKE) { delete process.env.DATABASE_URL; console.log('LEDGER_FAKE=1 → 가짜 저장소 (' + (process.env.LEDGER_FAKE_FILE || 'dev/.data.json') + '), .env 의 DATABASE_URL 무시'); }
if (!process.env.DATABASE_URL) process.env.LEDGER_FAKE = '1';
else console.log('⚠ 실제 Neon DB에 연결됨 (.env DATABASE_URL). 테스트는 LEDGER_FAKE=1 로 띄울 것');
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
