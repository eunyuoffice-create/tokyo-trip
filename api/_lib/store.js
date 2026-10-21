// 문서 저장소: 기본은 Neon(Postgres) ledger_docs 테이블, LEDGER_FAKE=1 이면 로컬 JSON 파일(개발용)
let impl = null;

function dbUrl() {
  const env = process.env;
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'])
    if (env[k] && /^postgres(ql)?:\/\//.test(env[k])) return env[k];
  const keys = Object.keys(env).filter(k => /^postgres(ql)?:\/\//.test(env[k] || ''));
  return keys.length ? env[keys[0]] : '';
}
export function dbEnvNames() {
  return Object.keys(process.env).filter(k => /DATABASE|POSTGRES|NEON|PG/i.test(k)).sort();
}
export function hasDbUrl() { return !!dbUrl() || !!process.env.LEDGER_FAKE; }

async function neonStore() {
  const url = dbUrl();
  if (!url) throw new Error('DB 접속 정보(DATABASE_URL)가 없어요. Vercel → Storage에서 Neon을 이 프로젝트에 연결하고 Redeploy 하세요.');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  await sql`CREATE TABLE IF NOT EXISTS ledger_docs (
    col text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
    updated timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (col, id))`;
  return {
    async all(col) {
      const rows = col ? await sql`SELECT col, id, data FROM ledger_docs WHERE col = ${col}` : await sql`SELECT col, id, data FROM ledger_docs`;
      return rows.map(r => ({ col: r.col, id: r.id, data: r.data }));
    },
    async get(col, id) {
      const r = await sql`SELECT data FROM ledger_docs WHERE col = ${col} AND id = ${id}`;
      return r.length ? r[0].data : null;
    },
    async put(col, id, data) {
      await sql`INSERT INTO ledger_docs (col, id, data) VALUES (${col}, ${id}, ${JSON.stringify(data)}::jsonb)
                ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated = now()`;
    },
    async patch(col, id, data) {
      const r = await sql`UPDATE ledger_docs SET data = data || ${JSON.stringify(data)}::jsonb, updated = now() WHERE col = ${col} AND id = ${id} RETURNING id`;
      return r.length > 0;
    },
    async del(col, id) { await sql`DELETE FROM ledger_docs WHERE col = ${col} AND id = ${id}`; },
    // 변경 감지용 버전: 행 수 + 마지막 수정 시각 (삭제는 행 수로 잡힘). 내용은 안 읽어서 가볍다
    async version(cols) {
      const r = await sql`SELECT count(*)::int n, coalesce(max(updated), 'epoch')::text m FROM ledger_docs WHERE col = ANY(${cols})`;
      return r[0].n + '|' + r[0].m;
    },
  };
}

async function fakeStore() {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const file = process.env.LEDGER_FAKE_FILE || fileURLToPath(new URL('../../dev/.data.json', import.meta.url)); // 경로에 한글이 있어도 동작
  let mem = {};
  try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { mem = {}; }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(mem, null, 1)); } catch (_) {} };
  const key = (c, i) => c + '/' + i;
  const boot = Date.now().toString(36); const ver = {}; const bump = c => { ver[c] = (ver[c] || 0) + 1; };
  return {
    async all(col) { return Object.entries(mem).filter(([k]) => !col || k.startsWith(col + '/')).map(([k, data]) => ({ col: k.split('/')[0], id: k.slice(k.indexOf('/') + 1), data })); },
    async get(col, id) { return mem[key(col, id)] ?? null; },
    async put(col, id, data) { mem[key(col, id)] = data; bump(col); save(); },
    async patch(col, id, data) { const k = key(col, id); if (!(k in mem)) return false; mem[k] = { ...mem[k], ...data }; bump(col); save(); return true; },
    async del(col, id) { delete mem[key(col, id)]; bump(col); save(); },
    async version(cols) { return boot + '|' + cols.map(c => ver[c] || 0).join('.'); },
  };
}

export async function store() {
  if (!impl) impl = (process.env.LEDGER_FAKE ? fakeStore() : neonStore()).catch(e => { impl = null; throw e; });
  return impl;
}
