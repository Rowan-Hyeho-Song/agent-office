# 배포·설정 체크리스트

사무실을 실제로 켜는 데 필요한 설정을 한곳에 모았습니다. #1(신호 통로)·#24(문서 수집)·#38(작성자 거름)·#25(주인 로그인·결재)를 모두 머지한 뒤 **위에서부터 한 번에** 합니다(#1 결재: 보류 → 한꺼번에). 비밀값(키·토큰)은 이 문서·이슈·PR에 적지 않습니다.

## 0. 준비할 비밀값과 값

| 이름 | 만드는 법 | 넣는 곳 |
|---|---|---|
| `OFFICE_HOOK_TOKEN` | 긴 무작위 문자열(예: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`) | Vercel, 내 PC `~/.agent-office/hook.json` |
| `OFFICE_DOCS_TOKEN` | 위와 같은 방법으로 **다른 값** | Vercel, GitHub 저장소 Secrets |
| Supabase 서버 키 | Supabase → Project Settings → API Keys → secret key(`sb_secret_…`) | Vercel만 |
| Supabase 읽기 키 | 같은 화면의 publishable key(`sb_publishable_…`) | Vercel(`VITE_` 변수, 페이지에 실림) |
| 내 GitHub 숫자 ID | `gh api user --jq .id` (비밀값 아님) | Supabase `office_owner`, Vercel `OFFICE_OWNER_GITHUB_ID` |
| `GITHUB_ISSUES_TOKEN` | GitHub → Settings → Developer settings → Fine-grained tokens → Generate. **Repository access: Only select repositories → agent-office 하나. Permissions: Issues → Read and write. 그 밖의 권한은 모두 No access**(Metadata: Read는 자동으로 붙음). 만료일을 정해 두고 갱신 | Vercel만 |
| GitHub OAuth 앱 | GitHub → Settings → Developer settings → OAuth Apps → New. Homepage = `<사무실 주소>`, Callback URL = Supabase → Authentication → Providers → GitHub 화면에 나오는 주소(`https://<project>.supabase.co/auth/v1/callback`) | Client ID·Secret을 Supabase GitHub 공급자에 |

`GITHUB_ISSUES_TOKEN`은 결재 결과(`✅ 결재`) 댓글을 **내 계정으로** 답니다. 그래서 #38 거름(주인만)을 그대로 통과하고, Action이 같은 이슈의 결재를 닫습니다.

## 1. Supabase (방명록과 같은 프로젝트)

SQL Editor에서 **이 순서로** 한 번씩 실행합니다. 모두 다시 실행해도 안전합니다(`if not exists`, `on conflict`, `create or replace`). 방명록 테이블은 건드리지 않습니다.

- [ ] `supabase/office.sql`: `agents`(이름·색 시드), `agent_status`, `agent_events`(마지막 test·build 결과 칸 포함, #44), Realtime (#1)
- [ ] `supabase/docs.sql`: `docs`, `projects`, `docs_cover` 뷰, Realtime (#24)
  - 서재 진행 상황(#241): `docs_cover` 뷰에 `progress` 열이 더해졌다. 이 파일을 다시 실행한 뒤 `node scripts/docs/backfill.mjs <owner/name>`으로 기존 이슈의 단계를 채운다(안 채우면 칩이 없을 뿐 서재는 그대로 열린다). 워크플로는 PR · 브랜치 이벤트도 받는다(`.github/workflows/docs.yml`).
- [ ] `supabase/approvals.sql`: `office_owner`, `is_owner()`, `approvals`, `approvals_pending` 뷰, 주인의 문서 읽기 정책, Realtime (#25)
- [ ] 주인 등록(한 줄): `insert into public.office_owner (github_id) values ('<내 GitHub 숫자 ID>') on conflict do nothing;`
- [ ] Authentication → Providers → GitHub 켜기(0단계 OAuth 앱의 Client ID·Secret)
- [ ] Authentication → URL Configuration → Redirect URLs에 `<사무실 주소>/**` 추가과 책상 방 프록시 주소 `https://rowansong-dev.vercel.app/rooms/office/app/**`(도메인을 붙이면 `https://rowansong.dev/rooms/office/app/**`도)

확인: Table Editor에 표가 생기고 `agents`에 4줄, `agent_status`에 4줄(`off`)이 있으면 됩니다.

## 2. Vercel 새 프로젝트 (agent-office)

- [ ] Vercel → Add New → Project → `agent-office` 저장소 가져오기. Framework는 Vite(자동), Production Branch는 `main`
- [ ] Environment Variables(Production):

| 변수 | 값 | 쓰는 곳 |
|---|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` | `/api/events`, `/api/docs`, `/api/approve`, `/api/approvals` |
| `SUPABASE_SECRET_KEY` | 서버 키 | 같음(브라우저에 안 감) |
| `OFFICE_HOOK_TOKEN` | 0단계 값 | `/api/events`, `/api/approvals`(결재 훅) |
| `OFFICE_DOCS_TOKEN` | 0단계 값 | `/api/docs` |
| `OFFICE_PUBLIC_REPOS` | `Rowan-Hyeho-Song/agent-office,Rowan-Hyeho-Song/rowansong.dev` (기본값과 같아 생략 가능. #424: rowansong.dev 저장소는 비공개지만 사무실에서는 공개로 보임) | `/api/docs` · `/api/timeline` · `/api/events` 등급 |
| `OFFICE_BANNED_WORDS` | 가릴 낱말을 쉼표로(회사 이름 등). 없으면 비움 | `/api/docs` 필터 |
| `OFFICE_OWNER_GITHUB_ID` | 내 GitHub 숫자 ID | `/api/approve` 주인 확인 |
| `GITHUB_ISSUES_TOKEN` | 0단계 세분화 토큰 | `/api/approve` 결재 댓글 |
| `VITE_SUPABASE_URL` | `SUPABASE_URL`과 같은 값 | 페이지(실시간 구독, 로그인) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 읽기 키 | 페이지 |

- [ ] `dev → main` 배포 PR을 머지하면 배포됩니다. 배포 주소를 아래 단계에 씁니다(`<사무실 주소>`).

확인:
- `curl -X POST <사무실 주소>/api/events` → `401`(토큰 없음)
- `curl -X POST <사무실 주소>/api/docs` → `401`
- `curl -X POST <사무실 주소>/api/approve -d '{"id":1,"result":"승인"}'` → `403`(주인 아님)
- `curl <사무실 주소>/api/approvals?seat=3&since=2026-01-01` → `401`
- 사무실 페이지 왼쪽 위 목록에 "연습 모드"가 **없으면** 실시간 소스에 붙은 것입니다. 오른쪽 아래에 "결재 대기 N건"이 보입니다.

## 3. GitHub 저장소 Secrets (문서 수집, #24)

- [ ] agent-office → Settings → Secrets and variables → Actions → New repository secret
  - `OFFICE_DOCS_URL` = `<사무실 주소>/api/docs`
  - `OFFICE_DOCS_TOKEN` = 0단계 값
- [ ] 지난 기록 가져오기(한 번): 내 PC에서
  ```bash
  node scripts/docs/backfill.mjs Rowan-Hyeho-Song/agent-office --dry-run   # 개수 확인: 파일철 수 = 내 이슈 수, 외부 작성 0
  OFFICE_DOCS_URL=<사무실 주소>/api/docs OFFICE_DOCS_TOKEN=<값> node scripts/docs/backfill.mjs Rowan-Hyeho-Song/agent-office
  ```

확인:
- 아무 이슈에 협의 기록 댓글을 달면 1분 안에 Actions의 "office docs"가 초록. Supabase `docs`에 `minutes` 행이 생김
- 그 댓글을 고치면 같은 행의 `updated_at`만 바뀜(새 행 없음)
- (가능하면) 다른 GitHub 계정으로 댓글을 달면 Action이 건너뜀(#38)

**타임랩스 점(#413)**은 같은 두 secret을 씁니다. 주소는 `OFFICE_DOCS_URL`의 `/api/docs`를 `/api/timeline`으로 바꾼 것입니다(따로 정하려면 `OFFICE_TIMELINE_URL`). 새 secret은 필요 없습니다.

- [ ] 지난 기록 채우기: Actions → "office timeline" → Run workflow. `dry_run` 켜고 한 번(점 개수, 서버가 받지 않을 점 0인지 확인) → 끄고 한 번. 같은 키는 덮어써서 두 번 돌려도 중복이 없습니다
- 확인: dev에 push하면 몇 분 안에 "office timeline"이 초록이고, 로그에 `work N → stored N`. 이슈를 열거나 협의 기록 · 결재 댓글을 달아도 점이 하나 들어옵니다

## 4. 내 PC 훅 (신호 #1·#34, 결재 #25)

- [ ] `~/.agent-office/hook.json`:
  ```json
  { "endpoint": "<사무실 주소>/api/events", "token": "<OFFICE_HOOK_TOKEN>", "log": true }
  ```
- [ ] `~/.claude/settings.json`의 `hooks`에 등록(`hooks/README.md` 설치 2단계): 신호 훅 일곱 이벤트(`async`, PostToolUse·PostToolUseFailure는 `Bash|PowerShell`만, #44), 결재 훅 두 이벤트(`async` 아님, timeout 5). 경로는 agent-office를 받아 둔 위치
- [ ] 네 세션의 이름에 역할 낱말이 있는지 확인: 기획 · Blender · 디자이너 · 코더

확인:
- 각 세션에서 도구를 한 번 쓰고 `~/.agent-office/hook.log`를 봄: `titled=true … → 200`
- 사무실 목록의 그 에이전트 문구가 1~2초 안에 바뀜
- 다른 프로젝트 폴더의 세션은 `skip: outside projects`
- 확인이 끝나면 `"log": true`는 지워도 됩니다

## 5. 주인 로그인·결재 (#25)

- [ ] `<사무실 주소>/?owner` → "주인 로그인(GitHub)" → 내 계정으로 로그인 → 오른쪽 아래 결재함이 열림
- [ ] 다른 GitHub 계정(또는 시크릿 창에서 로그인 안 함)으로 같은 주소 → 결재함이 열리지 않음("주인 계정이 아니에요")

확인(완료 기준):
- 아무 이슈에 `### 🖊 결재 요청` 댓글(형식은 #25) → 1분 안에 결재함에 뜸
- 결재함에서 결재 → 같은 이슈에 `### ✅ 결재` 댓글이 내 계정으로 달림 → 결재함에서 사라짐
- 그 요청을 올린 역할의 세션에서 새 입력을 하면(또는 새 세션) 결재 결과가 문맥에 들어옴. 훅 출력은 `echo '{"session_id":"t","hook_event_name":"SessionStart","session_title":"프로젝트 코더","cwd":"<agent-office 경로>"}' | node hooks/approval-hook.mjs`로 직접 볼 수 있음
- 세분화 토큰 권한 화면을 캡처해 둠: 저장소 하나, Issues Read and write, Metadata Read 말고는 없음

## 6. 버전과 배포 (2026-11-14부터)

배포마다 [유의적 버전](https://semver.org/lang/ko/)(MAJOR.MINOR.PATCH)을 붙인다. 첫 버전은 `v1.0.0`(배포 PR #464)이다.

| 올리는 자리 | 언제 | 예 |
|---|---|---|
| MAJOR | 방 구성 · 데이터 구조를 크게 바꿔 예전과 호환되지 않을 때 | 1.4.2 → 2.0.0 |
| MINOR | 새 기능이 하나라도 들어간 배포 | 1.0.0 → 1.1.0 |
| PATCH | 고침 · 문서 · 성능만 들어간 배포(핫픽스) | 1.1.0 → 1.1.1 |

배포 순서
1. dev에서 `package.json`의 `version`을 올리는 커밋(`chore(release): vX.Y.Z`)을 만든다.
2. dev → main PR 제목을 `release: vX.Y.Z — 한 줄 요약`으로 하고, 사용자 승인 뒤 merge(merge commit)한다.
3. main에 태그 `vX.Y.Z`와 GitHub Release를 만든다(`gh release create vX.Y.Z --target main --generate-notes`, 위에 한두 줄 요약).
4. 서재의 배포 묶음(docs-ui.md 2.6)과 타임랩스 배포 점은 이 버전을 머리 줄에 쓴다.

책상 방(rowansong.dev)도 같은 규칙으로 따로 버전을 센다. 두 저장소를 함께 배포할 때는 각자 올린다.
