# tokyo-trip 작업 규칙

- **수정 전 반드시 `git pull --ff-only origin main` 먼저.** 이 저장소는 여러 세션·기기에서 동시에 고치는 경우가 있어서, pull 없이 작업하면 다른 세션이 올린 내용을 덮어쓴다. (10/16에 eSIM 메모가 두 번 사라진 원인)
- 푸시 직전에도 `git pull --ff-only` 한 번 더. 충돌이 나면 덮어쓰지 말고 양쪽 내용을 합친다.
- `index.html` 한 파일이 사이트 전체다. 다른 세션이 추가한 블록(메모 탭의 eSIM, 도쿄역·선물, 쇼핑 등)을 모를 수 있으니, 어떤 블록을 통째로 지우기 전에 `git log -p`로 누가 왜 넣었는지 확인한다.
- 커밋 후 GitHub Pages 반영까지 1~2분. 확인은 `gh run list --limit 1`.
- `.omc/state/hud-state.json`은 커밋하지 않는다.
- 정산 노트(공용 지출·정산·멤버별 개인 지출·공용/개인 메모)는 하단 "정산" 탭(`#p-ledger` 안 `#ledger-root`)에 `ledger.js` + `ledger.css`로 붙는다. `ledger.html`은 같은 모듈을 단독으로 띄우는 껍데기.
- 정산 노트 서버: `api/ledger.js`(Vercel 서버 함수) + Neon Postgres(`ledger_docs` 테이블, 저장 계층 `api/_lib/store.js`). 멤버별 숫자 비밀번호 → HMAC 토큰. 개인 항목(owner=멤버 번호)은 서버가 본인에게만 내려준다. 배포는 Vercel이 main 푸시마다 자동(https://tokyo-trip-seven.vercel.app). GitHub Pages 쪽엔 API가 없어 정산 노트가 안 뜬다.
- 로컬 미리보기: `node dev/server.js` → http://localhost:8770 (DB 대신 `dev/.data.json`, 커밋 금지. `DATABASE_URL=… node dev/server.js` 면 실제 Neon). 깃 페이지 등 다른 호스트에서 열린 페이지는 `ledger.js`의 `API_HOST`(Vercel)로 교차 요청하고 서버가 github.io/vercel.app/localhost 출처를 CORS 허용한다.
