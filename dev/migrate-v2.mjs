// 도쿄 단일 여행 데이터 → 여행 여러 개 구조(api/v2.js)로 복사.  기존 행은 지우지 않는다 (옛 사이트가 계속 동작). 내용은 api/_lib/migrate.js
//
//   LEDGER_FAKE=1 LEDGER_FAKE_FILE=/tmp/x.json node dev/migrate-v2.mjs --admin 은유          (미리보기: 무엇을 할지 출력만)
//   LEDGER_FAKE=1 LEDGER_FAKE_FILE=/tmp/x.json node dev/migrate-v2.mjs --admin 은유 --apply  (가짜 저장소에 실제로 씀)
//   운영 Neon 에 쓰려면 --prod 도 같이 줘야 한다 (.env 의 DATABASE_URL). 그 전에 백업할 것.
//   (배포된 사이트에서는 사용자가 아무도 없을 때 로그인 화면의 '도쿄 데이터 가져오기' = action migrateLegacy 로도 됨)
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const flag = k => args.includes('--' + k);

if (!process.env.LEDGER_FAKE) {
  try { for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); } } catch (_) {}
  if (!flag('prod')) { console.error('LEDGER_FAKE=1 이 없으면 운영 DB 입니다. 운영에 하려면 --prod 를 붙이세요.'); process.exit(1); }
  console.log('⚠ 운영 Neon DB');
} else delete process.env.DATABASE_URL;

const { store } = await import('../api/_lib/store.js');
const { migrateLegacy } = await import('../api/_lib/migrate.js');
const r = await migrateLegacy(await store(), { adminName: opt('admin'), tripId: opt('trip') || undefined, title: opt('title') || undefined, apply: flag('apply') });
console.log(r.log.join('\n'));
console.log(`쓰기 ${r.writes}건${flag('apply') ? ' 완료' : ' — 미리보기만. --apply 로 실행'}`);
