# tokyo-trip 작업 규칙

- **수정 전 반드시 `git pull --ff-only origin main` 먼저.** 이 저장소는 여러 세션·기기에서 동시에 고치는 경우가 있어서, pull 없이 작업하면 다른 세션이 올린 내용을 덮어쓴다. (10/16에 eSIM 메모가 두 번 사라진 원인)
- 푸시 직전에도 `git pull --ff-only` 한 번 더. 충돌이 나면 덮어쓰지 말고 양쪽 내용을 합친다.
- `index.html` 한 파일이 사이트 전체다. 다른 세션이 추가한 블록(메모 탭의 eSIM, 도쿄역·선물, 쇼핑 등)을 모를 수 있으니, 어떤 블록을 통째로 지우기 전에 `git log -p`로 누가 왜 넣었는지 확인한다.
- 커밋 후 GitHub Pages 반영까지 1~2분. 확인은 `gh run list --limit 1`.
- `.omc/state/hud-state.json`은 커밋하지 않는다.
- 테마는 기기 다크 모드와 무관하게 항상 밝은 배경(2026-10-20 사용자 결정). `prefers-color-scheme` 블록을 다시 넣지 않는다 (index.html, ledger.html, ledger.css, middleware.js 입장 화면 모두).
- 정산 노트는 하단 "정산" 탭(`#p-ledger` 안 `#ledger-root`)에 `ledger.js` + `ledger.css`로 붙는다. 정산 탭은 한 화면(개인/공용/전체 목록이 먼저 → 아래에 정산 노트 헤더·잔액 한 줄 + 보냈어/받았어 → 자세히·정산 기록 접힘). [공용 지출]/[내 지출]과 메모 탭의 [내 메모]/[공용 메모]는 하단 메뉴 위 고정 바(`.lgbar`, 패널에 `.lg-haspad` 여백). 공용 지출 줄의 왼쪽 체크는 그 건만 정산 완료(개별 정산). 정산 메모·체크리스트는 같은 모듈이 "메모" 탭 상단 `#ledger-memo-root`에 아코디언(`details[data-accm]`, 펼침 상태는 `S.openMemos`)으로 그린다: 펼치면 항목 체크(바로 저장)·글 내용이 보이고, "수정" 버튼과 하단 [내 메모]/[공용 메모]만 시트(`openMemoEditor`)를 연다(로그인 전엔 안내 카드). 멤버 로그인·설정·로그아웃은 사이트 헤더 `#ledger-user`(`.lgslot`)의 버튼으로 열리는 시트(`openLogin`/`openSettings`)이며, 이 멤버 신원을 나중에 일정·맛집 수정 기능에도 재사용할 예정(TODO). 시트·토스트는 `body` 끝 `.lgov`에 붙어 어느 탭에서도 뜬다. "보냈어"는 그 통화의 미정산 공용 지출을 전부 `settled`로 표시하고 `transfers`에 `kind:settle` 기록(잔액 계산에서 제외, 되돌리기 가능); 일부 금액이면 `kind:partial`로 잔액에서 뺀다. `ledger.html`은 같은 모듈을 단독으로 띄우는 껍데기.
- 정산 노트 서버: `api/ledger.js`(Vercel 서버 함수) + Neon Postgres(`ledger_docs` 테이블, 저장 계층 `api/_lib/store.js`). 멤버별 숫자 비밀번호 → HMAC 토큰. 멤버 비밀번호를 잊으면 로그인 화면 "새로 정하기"(`resetPin`)가 사이트 입장 비밀번호(`SITE_PASSWORD`)로 확인하고 재설정한다. 개인 항목(owner=멤버 번호)은 서버가 본인에게만 내려준다. 배포는 Vercel이 main 푸시마다 자동(https://tokyo-trip-seven.vercel.app). GitHub Pages 쪽엔 API가 없어 정산 노트가 안 뜬다.
- 로컬 미리보기: `node dev/server.js` → http://localhost:8770 (DB 대신 `dev/.data.json`, 커밋 금지. `DATABASE_URL=… node dev/server.js` 면 실제 Neon). 루트 `.env`(커밋 금지, `.env.example` 참고)에 `SITE_PASSWORD=`·`DATABASE_URL=`을 적어 두면 `dev/server.js`가 시작할 때 읽는다. 깃 페이지 등 다른 호스트에서 열린 페이지는 `ledger.js`의 `API_HOST`(Vercel)로 교차 요청하고 서버가 github.io/vercel.app/localhost 출처를 CORS 허용한다.
- 사이트 입장 비밀번호: `middleware.js`(Vercel Edge). 환경변수 `SITE_PASSWORD`가 있으면 `/api/*` 제외 모든 경로에서 비밀번호를 묻고 쿠키 `trip_gate`(1년)로 통과시킨다. 비어 있으면 열림. GitHub Pages는 문을 달 수 없으므로 잠그려면 Pages를 꺼야 한다.
