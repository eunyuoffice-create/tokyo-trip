// 도쿄 단일 여행 데이터 → 여행 여러 개 구조(api/v2.js)로 복사.  기존 행은 지우지 않는다 (옛 사이트가 계속 동작).
//
//   LEDGER_FAKE=1 LEDGER_FAKE_FILE=/tmp/x.json node dev/migrate-v2.mjs --admin 은유          (미리보기: 무엇을 할지 출력만)
//   LEDGER_FAKE=1 LEDGER_FAKE_FILE=/tmp/x.json node dev/migrate-v2.mjs --admin 은유 --apply  (가짜 저장소에 실제로 씀)
//   운영 Neon 에 쓰려면 --prod 도 같이 줘야 한다 (.env 의 DATABASE_URL). 그 전에 백업할 것.
//
// 하는 일
//   sys/auth.secret      = settings/trip.secret  (그래서 멤버 비밀번호가 그대로)
//   users/u-<번호>       = settings/trip.people[i]  {name, pinHash}, --admin 이름의 사람은 admin:true
//   trips/<--trip>       = {title, city, country, start, end, members:[u-0, u-1 ...], currency:'JPY', rateManual}
//   t:<trip>:<col>       = plan, food, places, meta, memos, expenses, transfers 의 모든 행 (이미 있으면 건너뜀)
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const flag = k => args.includes('--' + k);
const APPLY = flag('apply'), PROD = flag('prod');
const TRIP = opt('trip') || 'tokyo-2026-10';

if (!process.env.LEDGER_FAKE) {
  try { for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); } } catch (_) {}
  if (!PROD) { console.error('LEDGER_FAKE=1 이 없으면 운영 DB 입니다. 운영에 하려면 --prod 를 붙이세요.'); process.exit(1); }
  console.log('⚠ 운영 Neon DB');
} else delete process.env.DATABASE_URL;

const { store } = await import('../api/_lib/store.js');
const db = await store();
const legacy = await db.get('settings', 'trip');
if (!legacy) { console.error('settings/trip 이 없어요 (옮길 도쿄 데이터 없음)'); process.exit(1); }

const plan = [];
const existingAuth = await db.get('sys', 'auth');
if (existingAuth && existingAuth.secret !== legacy.secret) { console.error('sys/auth 가 이미 다른 키로 있어요. 중단'); process.exit(1); }
if (!existingAuth) plan.push(['put', 'sys', 'auth', { secret: legacy.secret, created: Date.now(), from: 'settings/trip' }]);

const adminName = opt('admin');
const members = [];
for (const [i, p] of legacy.people.entries()) {
  const id = 'u-' + i; members.push(id);
  if (!(await db.get('users', id))) plan.push(['put', 'users', id, { name: p.name, pinHash: p.pinHash, admin: p.name === adminName, created: Date.now() }]);
}
if (adminName && !legacy.people.some(p => p.name === adminName)) console.warn(`⚠ --admin ${adminName} 이 멤버 이름에 없어요. 관리자 없이 진행 (나중에 bootstrap 불가 → 직접 지정 필요)`);

if (!(await db.get('trips', TRIP)))
  plan.push(['put', 'trips', TRIP, { title: opt('title') || '도쿄 덕질 여행', city: '도쿄', country: '일본', start: '2026-10-24', end: '2026-10-28',
    currency: 'JPY', rateManual: +legacy.rateManual > 0 ? +legacy.rateManual : 0, rateAuto: legacy.rateAuto || null, members, created: Date.now() }]);

for (const col of ['plan', 'food', 'places', 'meta', 'memos', 'expenses', 'transfers']) {
  const to = `t:${TRIP}:${col}`;
  const have = new Set((await db.all(to)).map(r => r.id));
  const rows = (await db.all(col)).filter(r => !have.has(r.id));
  for (const r of rows) plan.push(['put', to, r.id, r.data]);
  console.log(`${col.padEnd(10)} → ${to}: ${rows.length}개 복사${have.size ? ` (이미 ${have.size}개 있음)` : ''}`);
}
console.log(`users: ${legacy.people.map((p, i) => `u-${i}=${p.name}${p.name === adminName ? '(관리자)' : ''}`).join(', ')}`);
console.log(`쓰기 ${plan.length}건${APPLY ? '' : ' — 미리보기만. --apply 로 실행'}`);
if (APPLY) { for (const [, col, id, data] of plan) await db.put(col, id, data); console.log('완료'); }
