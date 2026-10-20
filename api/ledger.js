// 정산 노트 API — Vercel 서버 함수 + Neon(Postgres). 저장 계층은 api/_lib/store.js
// 모든 호출: POST /api/ledger  { action, token?, ... }   (GET ?action=ping 만 예외)
//  ping                         → { ok, db }
//  status                       → { ok, setup, people:[name], rate }
//  setup  {people:[{name,pin}], rate, me}   최초 1회. 멤버·비밀번호 생성 → { token, me }
//  login  {me, pin}             → { token, me }
//  list   (token)               → { me, people, rate, expenses, transfers, memos }  (개인 항목은 본인 것만)
//  write  (token) {ops:[{op:'set'|'update'|'delete', col, id, data}]}
//  settings (token) {names?, rate?, addMember?:{name,pin}, setPin?:{me?:idx, pin}}
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { store, dbEnvNames, hasDbUrl } from './_lib/store.js';

const COLS = new Set(['expenses', 'transfers', 'memos']);
const PRIVATE_COLS = new Set(['expenses', 'memos']);   // owner 필드로 개인/공용 구분
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const TOKEN_DAYS = 90;

const hashPin = (secret, pin) => createHash('sha256').update(secret + ':' + String(pin)).digest('hex');
const sign = (secret, s) => createHmac('sha256', secret).update(s).digest('hex');
function makeToken(secret, me) { const exp = Date.now() + TOKEN_DAYS * 864e5; const p = me + '.' + exp; return p + '.' + sign(secret, p); }
function readToken(secret, t) {
  if (typeof t !== 'string') return null;
  const [me, exp, sig] = t.split('.');
  if (!/^\d+$/.test(me || '') || !/^\d+$/.test(exp || '') || !sig) return null;
  if (sign(secret, me + '.' + exp) !== sig || +exp < Date.now()) return null;
  return +me;
}
const ownerOf = d => (d && d.owner !== null && d.owner !== undefined && d.owner !== '') ? +d.owner : null;
const DEFAULT_RATE = 8.4;
function publicTrip(trip) {
  const auto = trip.rateAuto && +trip.rateAuto.value > 0 ? trip.rateAuto : null;
  const manual = +trip.rateManual > 0 ? +trip.rateManual : (trip.rate && trip.rateManualLegacy ? +trip.rate : 0);
  const rate = manual || (auto ? +auto.value : 0) || DEFAULT_RATE;
  return { people: (trip.people || []).map(p => ({ name: p.name || '' })), rate: +rate.toFixed(3),
    rateInfo: { mode: manual ? 'manual' : 'auto', auto: auto ? { value: +(+auto.value).toFixed(3), date: auto.date, src: auto.src } : null } };
}
/* 환율 자동 갱신: 하루 한 번 공개 환율(JPY→KRW) 받아 settings/trip.rateAuto 에 저장 */
async function fetchRate() {
  const get = async (url, pick) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
    try { const r = await fetch(url, { signal: c.signal }); const j = await r.json(); return pick(j); } finally { clearTimeout(t); } };
  try { return await get('https://open.er-api.com/v6/latest/JPY', j => ({ value: +j.rates.KRW, date: String(j.time_last_update_utc || '').slice(5, 16).trim(), src: 'ExchangeRate-API' })); } catch (_) {}
  try { return await get('https://api.frankfurter.dev/v1/latest?base=JPY&symbols=KRW', j => ({ value: +j.rates.KRW, date: j.date, src: 'ECB' })); } catch (_) {}
  return null;
}
async function refreshRate(db, trip) {
  if (!trip) return trip;
  const at = trip.rateAuto && trip.rateAuto.at || 0;
  if (Date.now() - at < 6 * 3600e3) return trip;           // 6시간 안에 받아왔으면 그대로
  const r = await fetchRate();
  const next = { ...trip, rateAuto: r && r.value > 0 ? { ...r, at: Date.now() } : { ...(trip.rateAuto || {}), at: Date.now() } };
  try { await db.put('settings', 'trip', next); } catch (_) {}
  return next;
}

// 교차 출처 허용: 깃허브 페이지(eunyuoffice-create.github.io)와 로컬에서 같은 서버를 쓴다. 인증은 토큰(본문)이라 쿠키 없음.
const ORIGINS = [/^https:\/\/[a-z0-9-]+\.github\.io$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
function cors(req, res) {
  const o = req.headers && req.headers.origin;
  if (o && ORIGINS.some(r => r.test(o))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const body = req.method === 'POST' ? parseBody(req.body) : (req.query || {});
    const action = body.action || 'status';
    if (action === 'ping') {
      let db = false; try { await store(); db = true; } catch (_) {}
      return res.status(200).json({ ok: true, db, hasUrl: hasDbUrl(), envNames: dbEnvNames() });
    }
    const db = await store();
    let trip = await db.get('settings', 'trip');
    if (trip && (action === 'list' || action === 'status')) trip = await refreshRate(db, trip);

    if (action === 'status') return res.status(200).json({ ok: true, setup: !!trip, ...(trip ? publicTrip(trip) : { people: [], rate: DEFAULT_RATE, rateInfo: { mode: 'auto', auto: null } }) });

    if (action === 'setup') {
      if (trip) return res.status(409).json({ ok: false, error: 'already_setup' });
      const people = Array.isArray(body.people) ? body.people : [];
      if (people.length < 2 || people.length > 6) return res.status(400).json({ ok: false, error: '멤버는 2~6명' });
      for (const p of people) if (!String(p.name || '').trim() || !/^\d{4,8}$/.test(String(p.pin || ''))) return res.status(400).json({ ok: false, error: '이름과 4~8자리 숫자 비밀번호가 필요해요' });
      const secret = randomBytes(32).toString('hex');
      const doc = { secret, rateManual: +body.rate > 0 ? +body.rate : 0, people: people.map(p => ({ name: String(p.name).trim().slice(0, 12), pinHash: hashPin(secret, p.pin) })), created: Date.now() };
      await db.put('settings', 'trip', doc);
      const me = Math.min(Math.max(+body.me || 0, 0), people.length - 1);
      return res.status(200).json({ ok: true, token: makeToken(secret, me), me, ...publicTrip(doc) });
    }

    if (!trip) return res.status(200).json({ ok: false, error: 'not_setup' });

    if (action === 'login') {
      const me = +body.me;
      const p = trip.people[me];
      if (!p || hashPin(trip.secret, body.pin) !== p.pinHash) return res.status(200).json({ ok: false, error: 'pin' });
      return res.status(200).json({ ok: true, token: makeToken(trip.secret, me), me, ...publicTrip(trip) });
    }

    const me = readToken(trip.secret, body.token);
    if (me === null || !trip.people[me]) return res.status(200).json({ ok: false, error: 'auth' });
    const visible = (col, d) => !PRIVATE_COLS.has(col) || ownerOf(d) === null || ownerOf(d) === me;

    if (action === 'list') {
      const rows = await db.all();
      const data = { expenses: {}, transfers: {}, memos: {} };
      for (const r of rows) if (data[r.col] && visible(r.col, r.data)) data[r.col][r.id] = r.data;
      return res.status(200).json({ ok: true, me, ...publicTrip(trip), ...data, ts: Date.now() });
    }

    if (action === 'write') {
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (!ops.length) return res.status(400).json({ ok: false, error: 'no ops' });
      for (const op of ops) if (!COLS.has(op.col) || !ID_RE.test(String(op.id || '')) || !['set', 'update', 'delete'].includes(op.op)) return res.status(400).json({ ok: false, error: 'bad op' });
      for (const op of ops) {
        const col = op.col, id = String(op.id);
        const existing = await db.get(col, id);
        if (existing && !visible(col, existing)) return res.status(403).json({ ok: false, error: 'forbidden' });
        if (op.op === 'delete') { await db.del(col, id); continue; }
        const data = (op.data && typeof op.data === 'object' && !Array.isArray(op.data)) ? op.data : {};
        if (PRIVATE_COLS.has(col)) {
          const next = op.op === 'update' ? { ...(existing || {}), ...data } : data;
          const o = ownerOf(next);
          if (o !== null && o !== me) return res.status(403).json({ ok: false, error: 'forbidden' });
          // 공용 → 개인 전환은 만든 사람만 (남이 올린 공용 항목을 내 개인으로 숨기지 못하게)
          if (existing && ownerOf(existing) === null && o === me && existing.by !== undefined && existing.by !== me) return res.status(403).json({ ok: false, error: 'forbidden' });
        }
        if (op.op === 'update') { if (!existing) return res.status(409).json({ ok: false, error: `missing ${col}/${id}` }); await db.patch(col, id, { ...data, upd: Date.now() }); }
        else await db.put(col, id, { ...data, by: existing ? (existing.by ?? me) : me, upd: Date.now() });
      }
      return res.status(200).json({ ok: true, ts: Date.now() });
    }

    if (action === 'settings') {
      const next = { ...trip, people: trip.people.map(p => ({ ...p })) };
      if (Array.isArray(body.names)) body.names.forEach((n, i) => { if (next.people[i] && String(n || '').trim()) next.people[i].name = String(n).trim().slice(0, 12); });
      if (body.rateAuto === true) { next.rateManual = 0; }
      else if (body.rate !== undefined && body.rate !== null && body.rate !== '') { next.rateManual = +body.rate > 0 ? +body.rate : 0; }
      if (body.addMember) {
        const { name, pin } = body.addMember;
        if (next.people.length >= 6) return res.status(400).json({ ok: false, error: '멤버는 최대 6명' });
        if (!String(name || '').trim() || !/^\d{4,8}$/.test(String(pin || ''))) return res.status(400).json({ ok: false, error: '이름과 4~8자리 숫자 비밀번호가 필요해요' });
        next.people.push({ name: String(name).trim().slice(0, 12), pinHash: hashPin(trip.secret, pin) });
      }
      if (body.setPin) {
        const idx = body.setPin.me === undefined ? me : +body.setPin.me;   // 동행이 잊었을 때 서로 재설정 가능
        if (!next.people[idx] || !/^\d{4,8}$/.test(String(body.setPin.pin || ''))) return res.status(400).json({ ok: false, error: '4~8자리 숫자' });
        next.people[idx].pinHash = hashPin(trip.secret, body.setPin.pin);
      }
      await db.put('settings', 'trip', next);
      return res.status(200).json({ ok: true, ...publicTrip(next) });
    }

    return res.status(400).json({ ok: false, error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
function parseBody(b) {
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (_) { return {}; } }
  return b;
}
