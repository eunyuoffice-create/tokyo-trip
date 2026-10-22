// 일회용: 지워진 항공편(note-flight)·숙소(note-hotel) 메모를 notes-seed.js 기본값으로 다시 넣는다. 이미 있으면 건드리지 않음.
// 보기만: node dev/restore-trip-notes.mjs   실제로 넣기: node dev/restore-trip-notes.mjs --apply   (.env 의 DATABASE_URL = 실제 DB)
import fs from 'node:fs'; import vm from 'node:vm';
const root = new URL('..', import.meta.url);
for (const line of fs.readFileSync(new URL('.env', root), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('notes-seed.js', root), 'utf8'), ctx);
const SEED = ctx.window.NOTE_SEED, n = SEED.length;
const { neon } = await import('@neondatabase/serverless'); const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes('--apply');
for (const id of ['note-flight', 'note-hotel']) {
  const have = await sql`SELECT 1 FROM ledger_docs WHERE col = 'memos' AND id = ${id}`;
  if (have.length) { console.log(id, '있음 → 그대로 둠'); continue; }
  const i = SEED.findIndex(x => x.id === id), x = SEED[i];
  const data = { type: x.type, owner: null, cat: 'info', tag: x.tag || '', title: x.title, items: [], legs: x.legs || [], ...(x.hotel ? { hotel: x.hotel } : {}), blocks: [], body: x.body || '', cover: '', links: [], images: [], ts: Date.now(), order: (n - i) * 1000 };
  if (!apply) { console.log(id, '없음 → --apply 로 다시 넣을 예정:', x.title, x.tag); continue; }
  await sql`INSERT INTO ledger_docs (col, id, data) VALUES ('memos', ${id}, ${JSON.stringify(data)}::jsonb)`;
  console.log(id, '다시 넣음:', x.title, x.tag);
}
