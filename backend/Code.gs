/**
 * 도쿄 정산 노트 — 구글 시트 백엔드 (Apps Script 웹 앱)
 *
 * 설치:
 *  1) 여행 구글 시트 열기 → 확장 프로그램 → Apps Script
 *  2) 기본 Code.gs 내용을 지우고 이 파일 전체를 붙여넣기
 *  3) 아래 PIN 을 원하는 숫자로 바꾸고 저장 (친구에게 알려줄 공용 비밀번호)
 *  4) 배포 → 새 배포 → 유형 "웹 앱" → 실행: "나" → 액세스 권한: "모든 사용자" → 배포 → 권한 허용
 *  5) 웹 앱 URL(…/exec) 복사 → ledger.html 의 API_URL 에 넣기
 *
 * 코드를 고친 뒤에는 "배포 관리 → 연필 → 새 버전" 으로 다시 배포해야 반영됩니다.
 * 데이터는 이 시트에 _settings / _expenses / _transfers / _checks 탭으로 쌓입니다. (지우지 마세요)
 */
const PIN = '1024';            // ← 바꾸세요. 비우면('') 누구나 쓸 수 있음
const COLLECTIONS = ['settings', 'expenses', 'transfers', 'checks'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  return out_(handle_({ action: p.action || 'list', pin: p.pin }));
}
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) {}
  return out_(handle_(body));
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  try {
    if (req.action === 'ping') return { ok: true, v: 1, pinRequired: !!PIN };
    if (PIN && String(req.pin || '') !== PIN) return { ok: false, error: 'pin' };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (req.action === 'list') {
      const data = {};
      COLLECTIONS.forEach(function (c) { data[c] = readAll_(ss, c); });
      return { ok: true, data: data, ts: Date.now() };
    }
    if (req.action === 'write') {
      const ops = Array.isArray(req.ops) ? req.ops : [];
      if (!ops.length) return { ok: false, error: 'no ops' };
      const lock = LockService.getScriptLock();
      lock.waitLock(15000);
      try { ops.forEach(function (op) { applyOp_(ss, op); }); }
      finally { lock.releaseLock(); }
      return { ok: true, ts: Date.now() };
    }
    return { ok: false, error: 'unknown action' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* 시트 한 장 = 컬렉션 하나. 열: id | updated | summary | json */
function sheet_(ss, name) {
  if (COLLECTIONS.indexOf(name) < 0) throw new Error('unknown collection ' + name);
  let sh = ss.getSheetByName('_' + name);
  if (!sh) {
    sh = ss.insertSheet('_' + name);
    sh.appendRow(['id', 'updated', 'summary', 'json']);
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 320); sh.setColumnWidth(4, 600);
  }
  return sh;
}
function readAll_(ss, name) {
  const sh = sheet_(ss, name);
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  const rows = sh.getRange(2, 1, last - 1, 4).getValues();
  rows.forEach(function (r) {
    const id = String(r[0] || ''); if (!id) return;
    try { out[id] = JSON.parse(r[3]); } catch (_) {}
  });
  return out;
}
function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}
function summary_(name, d) {
  if (!d) return '';
  if (name === 'expenses') return [d.day, d.title, (d.cur === 'KRW' ? '₩' : '¥') + (d.amount || 0), '결제:' + d.payer].join(' · ');
  if (name === 'checks') return [(d.owner === null || d.owner === undefined) ? '공용' : '멤버' + d.owner, d.done ? '✓' : '□', d.text].join(' ');
  if (name === 'transfers') return [d.from + '→' + d.to, (d.cur === 'KRW' ? '₩' : '¥') + (d.amount || 0)].join(' ');
  if (name === 'settings') return (d.people || []).map(function (p) { return p.name; }).join(', ') + ' · 환율 ' + d.rate;
  return '';
}
function applyOp_(ss, op) {
  const name = op.col, id = String(op.id || '');
  if (!id) throw new Error('missing id');
  const sh = sheet_(ss, name);
  const row = findRow_(sh, id);
  if (op.op === 'delete') { if (row > 0) sh.deleteRow(row); return; }
  let data = op.data || {};
  if (op.op === 'update') {
    if (row < 0) throw new Error('update: missing ' + name + '/' + id);
    let cur = {}; try { cur = JSON.parse(sh.getRange(row, 4).getValue()); } catch (_) {}
    data = Object.assign({}, cur, data);
  }
  const vals = [[id, new Date().toISOString(), summary_(name, data), JSON.stringify(data)]];
  if (row > 0) sh.getRange(row, 1, 1, 4).setValues(vals);
  else sh.appendRow(vals[0]);
}
