// 도쿄 단일 여행 데이터(settings/trip + plan/food/places/meta/memos/expenses/transfers) → 여행 여러 개 구조로 복사.
// 기존 행은 지우지 않는다(옛 사이트 계속 동작). 이미 있는 행은 건너뜀. dev/migrate-v2.mjs 와 api/v2.js(migrateLegacy) 가 같이 씀.
export const LEGACY_COLS = ['plan', 'food', 'places', 'meta', 'memos', 'expenses', 'transfers'];

export async function migrateLegacy(db, { adminName, tripId = 'tokyo-2026-10', title = '도쿄 덕질 여행', apply = false } = {}) {
  const log = [];
  const legacy = await db.get('settings', 'trip');
  if (!legacy) throw new Error('settings/trip 이 없어요 (옮길 도쿄 데이터 없음)');
  const plan = [];
  const auth = await db.get('sys', 'auth');
  if (auth && auth.secret !== legacy.secret) throw new Error('sys/auth 가 이미 다른 키로 있어요');
  if (!auth) plan.push(['sys', 'auth', { secret: legacy.secret, created: Date.now(), from: 'settings/trip' }]);   // 같은 키 → 멤버 비밀번호 그대로

  const members = [];
  for (const [i, p] of legacy.people.entries()) {
    const id = 'u-' + i; members.push(id);
    if (!(await db.get('users', id))) plan.push(['users', id, { name: p.name, pinHash: p.pinHash, admin: p.name === adminName, created: Date.now() }]);
  }
  if (!(await db.get('trips', tripId)))
    plan.push(['trips', tripId, { title, city: '도쿄', country: '일본', start: '2026-10-24', end: '2026-10-28', currency: 'JPY',
      rateManual: +legacy.rateManual > 0 ? +legacy.rateManual : 0, rateAuto: legacy.rateAuto || null, members, created: Date.now() }]);

  for (const col of LEGACY_COLS) {
    const to = `t:${tripId}:${col}`;
    const have = new Set((await db.all(to)).map(r => r.id));
    const rows = (await db.all(col)).filter(r => !have.has(r.id));
    for (const r of rows) plan.push([to, r.id, r.data]);
    log.push(`${col}: ${rows.length}개${have.size ? ` (이미 ${have.size}개)` : ''}`);
  }
  log.push('사람: ' + legacy.people.map((p, i) => `u-${i}=${p.name}${p.name === adminName ? '(관리자)' : ''}`).join(', '));
  if (apply) for (const [col, id, data] of plan) await db.put(col, id, data);
  return { writes: plan.length, log, people: legacy.people.map(p => p.name) };
}
