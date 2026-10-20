// 정산 노트 API — Vercel 서버 함수 + Neon(Postgres)
// GET  /api/ledger?action=list&pin=…        → { ok, data: { settings, expenses, transfers, checks } }
// POST /api/ledger { action:'write', pin, ops:[{op:'set'|'update'|'delete', col, id, data}] }
// GET  /api/ledger?action=ping              → { ok, db }
// 환경변수: DATABASE_URL (Neon 연동 시 자동), LEDGER_PIN (선택 — 비우면 비밀번호 없음)
import { neon } from '@neondatabase/serverless';

const COLS = new Set(['settings', 'expenses', 'transfers', 'checks']);
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
let ready = null;

// Neon 연동이 만드는 변수 이름이 프로젝트마다 다를 수 있어(접두사 등) postgres:// 값을 가진 변수를 찾는다
function dbUrl() {
  const env = process.env;
  const prefer = ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'];
  for (const k of prefer) if (env[k] && /^postgres(ql)?:\/\//.test(env[k])) return env[k];
  const keys = Object.keys(env).filter(k => /^postgres(ql)?:\/\//.test(env[k] || '')).sort((a, b) => (/UNPOOLED|NON_POOLING/.test(a) ? 1 : 0) - (/UNPOOLED|NON_POOLING/.test(b) ? 1 : 0));
  return keys.length ? env[keys[0]] : '';
}
export function dbEnvNames() {
  return Object.keys(process.env).filter(k => /DATABASE|POSTGRES|NEON|PG/i.test(k)).sort();
}
function db() {
  const url = dbUrl();
  if (!url) throw new Error('DB 접속 정보(DATABASE_URL)가 없어요. Vercel → Storage에서 Neon을 이 프로젝트에 연결하고 Redeploy 하세요.');
  return neon(url);
}
async function ensure(sql) {
  if (!ready) ready = sql`CREATE TABLE IF NOT EXISTS ledger_docs (
    col text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
    updated timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (col, id))`.catch(e => { ready = null; throw e; });
  await ready;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const body = req.method === 'POST' ? parseBody(req.body) : (req.query || {});
    const action = body.action || 'list';
    if (action === 'ping') {
      let ok = false; try { const sql = db(); await ensure(sql); ok = true; } catch (_) {}
      return res.status(200).json({ ok: true, db: ok, pinRequired: !!process.env.LEDGER_PIN, envNames: dbEnvNames(), hasUrl: !!dbUrl() });
    }
    const PIN = process.env.LEDGER_PIN || '';
    if (PIN && String(body.pin || '') !== PIN) return res.status(200).json({ ok: false, error: 'pin' });
    const sql = db(); await ensure(sql);

    if (action === 'list') {
      const rows = await sql`SELECT col, id, data FROM ledger_docs`;
      const data = { settings: {}, expenses: {}, transfers: {}, checks: {} };
      for (const r of rows) if (data[r.col]) data[r.col][r.id] = r.data;
      return res.status(200).json({ ok: true, data, ts: Date.now() });
    }
    if (action === 'write') {
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (!ops.length) return res.status(400).json({ ok: false, error: 'no ops' });
      for (const op of ops) {
        if (!COLS.has(op.col) || !ID_RE.test(String(op.id || ''))) return res.status(400).json({ ok: false, error: 'bad op' });
      }
      for (const op of ops) {
        const col = op.col, id = String(op.id);
        if (op.op === 'delete') await sql`DELETE FROM ledger_docs WHERE col = ${col} AND id = ${id}`;
        else if (op.op === 'update') {
          const patch = JSON.stringify(op.data || {});
          const r = await sql`UPDATE ledger_docs SET data = data || ${patch}::jsonb, updated = now() WHERE col = ${col} AND id = ${id} RETURNING id`;
          if (!r.length) return res.status(409).json({ ok: false, error: `update: missing ${col}/${id}` });
        } else {
          const data = JSON.stringify(op.data || {});
          await sql`INSERT INTO ledger_docs (col, id, data) VALUES (${col}, ${id}, ${data}::jsonb)
                    ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated = now()`;
        }
      }
      return res.status(200).json({ ok: true, ts: Date.now() });
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
