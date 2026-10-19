# tokyo-trip 작업 규칙

- **수정 전 반드시 `git pull --ff-only origin main` 먼저.** 이 저장소는 여러 세션·기기에서 동시에 고치는 경우가 있어서, pull 없이 작업하면 다른 세션이 올린 내용을 덮어쓴다. (10/16에 eSIM 메모가 두 번 사라진 원인)
- 푸시 직전에도 `git pull --ff-only` 한 번 더. 충돌이 나면 덮어쓰지 말고 양쪽 내용을 합친다.
- `index.html` 한 파일이 사이트 전체다. 다른 세션이 추가한 블록(메모 탭의 eSIM, 도쿄역·선물, 쇼핑 등)을 모를 수 있으니, 어떤 블록을 통째로 지우기 전에 `git log -p`로 누가 왜 넣었는지 확인한다.
- 커밋 후 GitHub Pages 반영까지 1~2분. 확인은 `gh run list --limit 1`.
- `.omc/state/hud-state.json`은 커밋하지 않는다.
- `ledger.html`(정산 탭)은 별도 페이지. 데이터는 구글 시트 Apps Script 웹 앱(`backend/Code.gs`)에 저장하고, 주소는 `ledger.html` 맨 위 `API_URL` 상수에 넣는다. 설치 순서는 `backend/README.md`.
