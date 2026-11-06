// 여행 여러 개 API (React 앱용) — POST /api/v2  { action, token?, tripId?, ... }
// 기존 /api/ledger(도쿄 단일 여행)는 그대로 두고, 같은 ledger_docs 테이블을 다른 컬렉션 이름으로 쓴다.
//
// 저장 구조 (ledger_docs.col / id)
//   sys/auth            { secret }                      토큰 서명 키 (도쿄 이전 시 settings/trip.secret 을 그대로 써서 기존 비밀번호 유지)
//   users/<userId>      { name, pinHash, admin }        관리자가 등록. 관리자는 여행 멤버가 아니어도 모든 여행을 보고 고침
//   trips/<tripId>      { title, city, country, start, end, members:[userId], currency, rateManual, cover }
//   t:<tripId>:<col>    plan / food / places / meta / memos / expenses / transfers
//   images/<id>         사진 (모든 여행 공용, id 는 무작위)
//
// 여행 안에서 '나'(me)는 trip.members 안의 순서 번호. 지출의 payer/parts/owner, 메모의 owner 가 이 번호라서
// 도쿄 데이터를 그대로 옮겨도 뜻이 같다. 관리자가 멤버가 아니면 me = null (개인 항목은 안 보임, 공용만).
//
// actions
//   ping                                    → { ok, db, envNames }
//   users                                   → { users:[{id,name}] }          로그인 화면 이름 목록 (사이트 입장 비밀번호 뒤)
//   bootstrap {sitePw, name, pin}           → 사용자가 하나도 없을 때 첫 관리자 만들기
//   login     {userId, pin}                 → { token, user }
//   me        (token)                       → { user, trips:[요약] }
//   content   (token) {tripId, v?}          → { trip, me, v, plan, food, places, meta } | { unchanged }
//   list      (token) {tripId, v?}          → { me, v, expenses, transfers, memos, meta } | { unchanged }
//   write     (token) {tripId, ops:[{op, col, id, data}]}   col: 여행 컬렉션 또는 'images'
//   admin.createUser  (관리자) {name, pin, admin?}
//   admin.setPin      (관리자) {userId, pin}
//   admin.saveTrip    (관리자) {trip:{id?, title, city, country, start, end, members, currency}}
//   admin.deleteTrip  (관리자) {tripId}   → 여행 문서만 지움 (내용은 남김, 실수 복구용)
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { store, dbEnvNames, hasDbUrl } from './_lib/store.js';
export const config = { maxDuration: 30 };

const TRIP_COLS = new Set(['plan', 'food', 'places', 'meta', 'memos', 'expenses', 'transfers']);
const CONTENT_COLS = ['plan', 'food', 'places', 'meta'];
const LIST_COLS = ['expenses', 'transfers', 'memos', 'meta'];
const PRIVATE_COLS = new Set(['expenses', 'memos']);
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;   // userId·tripId (토큰·컬렉션 이름에 들어가므로 좁게)
const TOKEN_DAYS = 90;
const tcol = (tripId, col) => `t:${tripId}:${col}`;

const hashPin = (secret, pin) => createHash('sha256').update(secret + ':' + String(pin)).digest('hex');
const sign = (secret, s) => createHmac('sha256', secret).update(s).digest('hex');
function makeToken(secret, userId) { const exp = Date.now() + TOKEN_DAYS * 864e5; const p = 'u_' + userId + '.' + exp; return p + '.' + sign(secret, p); }
function readToken(secret, t) {
  if (typeof t !== 'string') return null;
  const [u, exp, sig] = t.split('.');
  if (!/^u_[a-z0-9-]+$/.test(u || '') || !/^\d+$/.test(exp || '') || !sig) return null;
  const want = sign(secret, u + '.' + exp);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig)) || +exp < Date.now()) return null;
  return u.slice(2);
}
const ownerOf = d => (d && d.owner !== null && d.owner !== undefined && d.owner !== '') ? +d.owner : null;
const pubUser = (id, u) => ({ id, name: u.name, admin: !!u.admin });
const pinOk = pin => /^\d{4,8}$/.test(String(pin || ''));
function pubTrip(id, t, users) {
  return { id, title: t.title || '', city: t.city || '', country: t.country || '', start: t.start || '', end: t.end || '',
    currency: t.currency || 'KRW', rate: +t.rateManual > 0 ? +t.rateManual : (t.rateAuto && +t.rateAuto.value) || null, cover: t.cover || '',
    members: (t.members || []).map(uid => ({ id: uid, name: (users[uid] && users[uid].name) || '(삭제됨)' })) };
}
async function usersMap(db) { const m = {}; for (const r of await db.all('users')) m[r.id] = r.data; return m; }
async function secretOf(db, create) {
  const a = await db.get('sys', 'auth');
  if (a && a.secret) return a.secret;
  if (!create) return null;
  const secret = randomBytes(32).toString('hex');
  await db.put('sys', 'auth', { secret, created: Date.now() });
  return secret;
}

const ORIGINS = [/^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/];
function cors(req, res) {
  const o = req.headers && req.headers.origin;
  if (o && ORIGINS.some(r => r.test(o))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
const ok = (res, o) => res.status(200).json({ ok: true, ...o });
const fail = (res, code, error, extra) => res.status(code).json({ ok: false, error, ...extra });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const body = req.method === 'POST' ? parseBody(req.body) : (req.query || {});
    const action = String(body.action || 'ping');
    if (action === 'ping') {
      let db = false; try { await store(); db = true; } catch (_) {}
      return ok(res, { db, hasUrl: hasDbUrl(), envNames: dbEnvNames() });
    }
    const db = await store();

    if (action === 'users') {
      const users = await usersMap(db);
      return ok(res, { users: Object.entries(users).map(([id, u]) => ({ id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) });
    }

    if (action === 'bootstrap') {
      if (Object.keys(await usersMap(db)).length) return fail(res, 409, 'already_setup');
      const sitePw = process.env.SITE_PASSWORD || '';
      if (sitePw) {
        const a = createHash('sha256').update(String(body.sitePw || '')).digest(), b = createHash('sha256').update(sitePw).digest();
        if (!timingSafeEqual(a, b)) return fail(res, 200, 'site_pw');
      }
      const name = String(body.name || '').trim().slice(0, 12);
      if (!name || !pinOk(body.pin)) return fail(res, 400, '이름과 4~8자리 숫자 비밀번호가 필요해요');
      const secret = await secretOf(db, true);
      const id = 'u-' + randomBytes(4).toString('hex');
      const u = { name, pinHash: hashPin(secret, body.pin), admin: true, created: Date.now() };
      await db.put('users', id, u);
      return ok(res, { token: makeToken(secret, id), user: pubUser(id, u) });
    }

    // 사진 한 장 (토큰 없이. id 는 무작위라 추측 어려움, <img> 로 바로 못 쓰니 data URL 로)
    if (action === 'image') {
      const doc = await db.get('images', String(body.id || ''));
      if (!doc) return fail(res, 404, 'not_found');
      return ok(res, { data: doc.data, w: doc.w, h: doc.h });
    }

    const secret = await secretOf(db, false);
    if (!secret) return fail(res, 200, 'not_setup');

    if (action === 'login') {
      const id = String(body.userId || '');
      const u = KEY_RE.test(id) ? await db.get('users', id) : null;
      if (!u || hashPin(secret, body.pin) !== u.pinHash) return fail(res, 200, 'pin');
      return ok(res, { token: makeToken(secret, id), user: pubUser(id, u) });
    }

    // ---- 여기부터 로그인 필요 ----
    const userId = readToken(secret, body.token);
    const user = userId && await db.get('users', userId);
    if (!user) return fail(res, 200, 'auth');
    const isAdmin = !!user.admin;

    if (action === 'me') {
      const users = await usersMap(db);
      const trips = (await db.all('trips')).filter(r => isAdmin || (r.data.members || []).includes(userId))
        .map(r => ({ ...pubTrip(r.id, r.data, users), joined: (r.data.members || []).includes(userId) }))
        .sort((a, b) => String(b.start).localeCompare(String(a.start)));
      return ok(res, { user: pubUser(userId, user), trips, users: isAdmin ? Object.entries(users).map(([id, u]) => pubUser(id, u)) : undefined });
    }

    if (action.startsWith('admin.')) {
      if (!isAdmin) return fail(res, 403, 'forbidden');
      if (action === 'admin.createUser') {
        const name = String(body.name || '').trim().slice(0, 12);
        if (!name || !pinOk(body.pin)) return fail(res, 400, '이름과 4~8자리 숫자 비밀번호가 필요해요');
        const id = 'u-' + randomBytes(4).toString('hex');
        await db.put('users', id, { name, pinHash: hashPin(secret, body.pin), admin: !!body.admin, created: Date.now() });
        return ok(res, { user: { id, name, admin: !!body.admin } });
      }
      if (action === 'admin.setPin') {
        const id = String(body.userId || ''); const u = KEY_RE.test(id) && await db.get('users', id);
        if (!u || !pinOk(body.pin)) return fail(res, 400, '4~8자리 숫자');
        await db.patch('users', id, { pinHash: hashPin(secret, body.pin) });
        return ok(res, {});
      }
      if (action === 'admin.saveTrip') {
        const t = body.trip || {};
        const id = t.id ? String(t.id) : ('tr-' + randomBytes(4).toString('hex'));
        if (!KEY_RE.test(id)) return fail(res, 400, 'bad id');
        const title = String(t.title || '').trim().slice(0, 40);
        if (!title) return fail(res, 400, '여행 이름이 필요해요');
        const users = await usersMap(db);
        const members = (Array.isArray(t.members) ? t.members : []).map(String).filter(m => users[m]);
        const prev = await db.get('trips', id);
        // 멤버 순서 = 지출·메모의 번호. 이미 있는 멤버를 빼거나 순서를 바꾸면 기존 지출의 사람이 뒤바뀌므로 막는다 (뒤에 추가만)
        if (prev && (prev.members || []).some((m, i) => members[i] !== m)) return fail(res, 400, '기존 멤버는 빼거나 순서를 바꿀 수 없어요 (뒤에 추가만 가능)');
        const next = { ...(prev || { created: Date.now() }), title, city: String(t.city || '').slice(0, 30), country: String(t.country || '').slice(0, 30),
          start: /^\d{4}-\d{2}-\d{2}$/.test(t.start || '') ? t.start : '', end: /^\d{4}-\d{2}-\d{2}$/.test(t.end || '') ? t.end : '',
          currency: /^[A-Z]{3}$/.test(t.currency || '') ? t.currency : 'KRW', rateManual: +t.rateManual > 0 ? +t.rateManual : (prev && prev.rateManual) || 0, members };
        await db.put('trips', id, next);
        return ok(res, { trip: pubTrip(id, next, users) });
      }
      if (action === 'admin.deleteTrip') {
        const id = String(body.tripId || ''); if (!KEY_RE.test(id)) return fail(res, 400, 'bad id');
        await db.del('trips', id);
        return ok(res, {});
      }
      return fail(res, 400, 'unknown action');
    }

    // ---- 여행 단위 ----
    const tripId = String(body.tripId || '');
    const trip = KEY_RE.test(tripId) && await db.get('trips', tripId);
    if (!trip) return fail(res, 404, 'no_trip');
    const idx = (trip.members || []).indexOf(userId);
    if (idx < 0 && !isAdmin) return fail(res, 403, 'forbidden');
    const me = idx < 0 ? null : idx;
    const visible = (col, d) => !PRIVATE_COLS.has(col) || ownerOf(d) === null || (me !== null && ownerOf(d) === me);

    if (action === 'content') {
      const v = 'c' + await db.version([...CONTENT_COLS.map(c => tcol(tripId, c)), 'trips']);
      if (body.v && body.v === v) return ok(res, { unchanged: true, v });
      const out = {};
      for (const col of CONTENT_COLS) { out[col] = {}; for (const r of await db.all(tcol(tripId, col))) out[col][r.id] = r.data; }
      return ok(res, { v, me, trip: pubTrip(tripId, trip, await usersMap(db)), ...out });
    }

    if (action === 'list') {
      const v = 'l' + me + ':' + await db.version(LIST_COLS.map(c => tcol(tripId, c)));
      if (body.v && body.v === v) return ok(res, { unchanged: true, v, me });
      const out = {};
      for (const col of LIST_COLS) { out[col] = {}; for (const r of await db.all(tcol(tripId, col))) if (visible(col, r.data)) out[col][r.id] = r.data; }
      return ok(res, { v, me, ...out, ts: Date.now() });
    }

    if (action === 'write') {
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (!ops.length || ops.length > 50) return fail(res, 400, 'bad ops');
      for (const op of ops) if (!(TRIP_COLS.has(op.col) || op.col === 'images') || !ID_RE.test(String(op.id || '')) || !['set', 'update', 'delete'].includes(op.op)) return fail(res, 400, 'bad op');
      for (const op of ops) if (op.col === 'images' && op.data && typeof op.data.data === 'string' && op.data.data.length > 600000) return fail(res, 413, '사진이 너무 커요');
      const by = me === null ? 'u:' + userId : me;
      for (const op of ops) {
        const col = op.col === 'images' ? 'images' : tcol(tripId, op.col), id = String(op.id);
        const existing = await db.get(col, id);
        if (existing && !visible(op.col, existing)) return fail(res, 403, 'forbidden');
        if (op.op === 'delete') { await db.del(col, id); continue; }
        const data = (op.data && typeof op.data === 'object' && !Array.isArray(op.data)) ? op.data : {};
        if (PRIVATE_COLS.has(op.col)) {
          const next = op.op === 'update' ? { ...(existing || {}), ...data } : data;
          const o = ownerOf(next);
          if (o !== null && o !== me) return fail(res, 403, 'forbidden');
          if (me !== null && existing && ownerOf(existing) === null && o === me && existing.by !== undefined && existing.by !== me) return fail(res, 403, 'forbidden');
        }
        if (op.op === 'update') { if (!existing) return fail(res, 409, `missing ${op.col}/${id}`); await db.patch(col, id, { ...data, upd: Date.now() }); }
        else await db.put(col, id, { ...data, by: existing ? (existing.by ?? by) : by, upd: Date.now() });
      }
      return ok(res, { ts: Date.now() });
    }

    return fail(res, 400, 'unknown action');
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
function parseBody(b) {
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (_) { return {}; } }
  return b;
}
