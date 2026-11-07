# 배포·설정 체크리스트

사무실을 실제로 켜는 데 필요한 설정을 한곳에 모았습니다. #1(신호 통로)·#24(문서 수집)·#25(주인 로그인·결재)를 모두 머지한 뒤 **위에서부터 한 번에** 합니다(#1 결재: 보류 → 한꺼번에). 비밀값(키·토큰)은 이 문서·이슈·PR에 적지 않습니다.

## 0. 준비할 비밀값

| 이름 | 만드는 법 | 넣는 곳 |
|---|---|---|
| `OFFICE_HOOK_TOKEN` | 긴 무작위 문자열(예: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`) | Vercel, 내 PC `~/.agent-office/hook.json` |
| `OFFICE_DOCS_TOKEN` | 위와 같은 방법으로 **다른 값** | Vercel, GitHub 저장소 Secrets |
| Supabase 서버 키 | Supabase → Project Settings → API Keys → secret key(`sb_secret_…`) | Vercel만 |
| Supabase 읽기 키 | 같은 화면의 publishable key(`sb_publishable_…`) | Vercel(`VITE_` 변수, 페이지에 실림) |

## 1. Supabase (방명록과 같은 프로젝트)

SQL Editor에서 **이 순서로** 한 번씩 실행합니다. 모두 다시 실행해도 안전합니다(`if not exists`, `on conflict`). 방명록 테이블은 건드리지 않습니다.

- [ ] `supabase/office.sql`: `agents`(이름·색 시드), `agent_status`, `agent_events`, Realtime (#1)
- [ ] `supabase/docs.sql`: `docs`, `projects`, `docs_cover` 뷰, Realtime (#24)
- [ ] (#25에서 추가)

확인: Table Editor에 표가 생기고 `agents`에 4줄, `agent_status`에 4줄(`off`)이 있으면 됩니다.

## 2. Vercel 새 프로젝트 (agent-office)

- [ ] Vercel → Add New → Project → `agent-office` 저장소 가져오기. Framework는 Vite(자동), Production Branch는 `main`
- [ ] Environment Variables(Production):

| 변수 | 값 | 쓰는 곳 |
|---|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` | `/api/events`, `/api/docs` |
| `SUPABASE_SECRET_KEY` | 서버 키 | 같음(브라우저에 안 감) |
| `OFFICE_HOOK_TOKEN` | 0단계 값 | `/api/events` |
| `OFFICE_DOCS_TOKEN` | 0단계 값 | `/api/docs` |
| `OFFICE_PUBLIC_REPOS` | `Rowan-Hyeho-Song/agent-office` (기본값과 같아 생략 가능) | `/api/docs` 등급 |
| `OFFICE_BANNED_WORDS` | 가릴 낱말을 쉼표로(회사 이름 등). 없으면 비움 | `/api/docs` 필터 |
| `VITE_SUPABASE_URL` | `SUPABASE_URL`과 같은 값 | 페이지(실시간 구독) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 읽기 키 | 페이지 |
| (#25에서 추가) | | |

- [ ] `dev → main` 배포 PR을 머지하면 배포됩니다. 배포 주소를 아래 단계에 씁니다(`<사무실 주소>`).

확인:
- `curl -X POST <사무실 주소>/api/events` → `401`(토큰 없음)
- `curl -X POST <사무실 주소>/api/docs` → `401`
- 사무실 페이지 왼쪽 위 목록에 "연습 모드"가 **없으면** 실시간 소스에 붙은 것입니다.

## 3. GitHub 저장소 Secrets (문서 수집, #24)

- [ ] agent-office → Settings → Secrets and variables → Actions → New repository secret
  - `OFFICE_DOCS_URL` = `<사무실 주소>/api/docs`
  - `OFFICE_DOCS_TOKEN` = 0단계 값
- [ ] 지난 기록 가져오기(한 번): 내 PC에서
  ```bash
  node scripts/docs/backfill.mjs Rowan-Hyeho-Song/agent-office --dry-run   # 개수 확인: 파일철 수 = 이슈 수
  OFFICE_DOCS_URL=<사무실 주소>/api/docs OFFICE_DOCS_TOKEN=<값> node scripts/docs/backfill.mjs Rowan-Hyeho-Song/agent-office
  ```

확인:
- 아무 이슈에 협의 기록 댓글을 달면 1분 안에 Actions의 "office docs"가 초록. Supabase `docs`에 `minutes` 행이 생김
- 그 댓글을 고치면 같은 행의 `updated_at`만 바뀜(새 행 없음)

## 4. 내 PC 훅 (신호, #1·#34)

- [ ] `~/.agent-office/hook.json`:
  ```json
  { "endpoint": "<사무실 주소>/api/events", "token": "<OFFICE_HOOK_TOKEN>", "log": true }
  ```
- [ ] `~/.claude/settings.json`의 `hooks`에 다섯 이벤트 등록(`hooks/README.md` 설치 2단계). 경로는 agent-office를 받아 둔 위치
- [ ] 네 세션의 이름에 역할 낱말이 있는지 확인: 기획 · Blender · 디자이너 · 코더

확인:
- 각 세션에서 도구를 한 번 쓰고 `~/.agent-office/hook.log`를 봄: `titled=true … → 200`
- 사무실 목록의 그 에이전트 문구가 1~2초 안에 바뀜
- 다른 프로젝트 폴더의 세션은 `skip: outside projects`
- 확인이 끝나면 `"log": true`는 지워도 됩니다

## 5. (#25에서 추가) 주인 로그인·결재
