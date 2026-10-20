// 사이트 입장 비밀번호 (Vercel Edge Middleware)
// Vercel 환경변수 SITE_PASSWORD 가 있으면 첫 접속 때 비밀번호를 묻고, 맞으면 쿠키(1년)를 남겨 다시 묻지 않는다.
// 비어 있으면 아무 것도 막지 않는다. /api/* 는 자체 토큰 인증이라 제외.
import { next } from '@vercel/edge';
export const config = { matcher: ['/((?!api/).*)'] };

const COOKIE = 'trip_gate';

async function token(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tokyo-trip-gate|v1|' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function cookieOf(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : '';
}
function page(next, wrong) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>도쿄 덕질 여행</title>
<style>
:root{--bg:#F4F5F8;--surface:#fff;--fg:#171C28;--muted:#6B7280;--line:#E2E5EC;--accent:#D9372B;--accent-soft:#FBE9E6}
@media (prefers-color-scheme:dark){:root{--bg:#12151C;--surface:#1B1F28;--fg:#E9EBF1;--muted:#9AA1B0;--line:#2B3140;--accent:#F05A4D;--accent-soft:#3A1F1D;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
.card{width:100%;max-width:360px;background:var(--surface);border-radius:18px;padding:24px 20px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 10px 30px rgba(0,0,0,.08)}
h1{margin:0 0 4px;font-size:19px}p{margin:0 0 16px;color:var(--muted);font-size:13.5px;line-height:1.5}
input{width:100%;height:50px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:inherit;font:inherit;font-size:20px;text-align:center;letter-spacing:.2em;padding:0 12px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:12px;width:100%;height:48px;border:0;border-radius:12px;background:var(--accent);color:#fff;font:inherit;font-weight:700;font-size:15px}
.err{color:var(--accent);font-size:13px;margin:8px 0 0;min-height:18px}
</style></head><body><form class="card" method="post" action="/__gate">
<h1>도쿄 덕질 여행 <span style="font-weight:500;color:var(--muted);font-size:13px">10.24–28</span></h1>
<p>같이 가는 사람만 보는 페이지예요. 입장 비밀번호를 넣어주세요. 이 기기에선 한 번만 물어요.</p>
<input type="password" name="pw" inputmode="numeric" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${next.replace(/[^\w\-./?=&%#]/g, '')}">
<div class="err">${wrong ? '비밀번호가 맞지 않아요.' : ''}</div>
<button type="submit">들어가기</button></form></body></html>`;
}
const html = (body, status, extra) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...(extra || {}) } });

export default async function middleware(req) {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return next({ headers: { 'x-gate': 'open' } });   // 비밀번호 미설정 → 통과 (진단용 헤더)
  const url = new URL(req.url);
  const want = await token(pw);

  if (url.pathname === '/__gate' && req.method === 'POST') {
    let given = '', next = '/';
    try { const fd = await req.formData(); given = String(fd.get('pw') || ''); next = String(fd.get('next') || '/'); } catch (_) {}
    if (!next.startsWith('/') || next.startsWith('//')) next = '/';
    if (given === pw) {
      return new Response(null, { status: 303, headers: { location: next, 'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${want}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` } });
    }
    return html(page(next, true), 401);
  }
  if (cookieOf(req) === want) return next({ headers: { 'x-gate': 'ok' } });   // 통과
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('locked', { status: 401 });
  return html(page(url.pathname + url.search, false), 401);
}
