# 타임랩스 데이터: 점 · 귀속 · 공개 거름

`docs/plan.md` 6.7절의 데이터 쪽. 재생 화면이 아니라 **점을 만드는 규칙**을 적는다(#81). 코드는 `scripts/timeline/`(백필·수집, 일반 JS)와 `src/timeline/`(점 타입, 서버 쪽 거름·저장).

## 점 하나

`src/timeline/types.ts`의 `Point`.

| 칸 | 뜻 |
|---|---|
| `key` | 원천 주소(커밋·이슈·댓글의 GitHub 주소). 서버에서 유일 키, 두 번 들어와도 한 점. `review` 점은 주소 대신 해시 id |
| `project` | `owner/name` |
| `at` | 그 일이 일어난 시각(UTC, 초까지) |
| `kind` | `plan` `work` `minutes` `approval` `decision` `deploy` |
| `agent` | 자리 번호(0 기획 · 1 3D · 2 디자인 · 3 코더) 또는 `null` |
| `title` | 제목. `review` 점은 빈 문자열 |
| `secret` | 제목을 검은 줄로 보일 점(`review`) |
| `additions` `deletions` `files` | 커밋 점만. 줄 수와 파일 **개수**. 파일 이름·경로·diff는 모으지 않는다 |
| `issue` `pr` | 번호(없으면 `null`). `review` 점은 항상 `null` |
| `tier` | `public` 또는 `review`. `private`는 모으지 않으니 저장된 점에는 없다 |

## 어디서 오나

| 종류 | 원천 | 시각 | 키 |
|---|---|---|---|
| `plan` | 이슈 열림(작성자 OWNER·COLLABORATOR) | 이슈 만든 시각 | 이슈 주소 |
| `work` | **dev에 들어간 커밋** 하나(스쿼시 하나 = PR 하나, 그 전 직접 커밋도 하나씩). 병합 커밋(부모 둘)은 제외 | 커밋 시각 | 커밋 주소 |
| `deploy` | main에 있고 dev에는 없는 커밋(`dev → main` 병합 커밋) | 커밋 시각 | 커밋 주소 |
| `minutes` | `🗂 에이전트 간 협의 기록` 댓글 | 댓글 시각 | 댓글 주소 |
| `approval` | `🖊` 요청 · `✅` 결과 댓글(**주인 계정만**) | 댓글 시각 | 댓글 주소 |
| `decision` | 회의록의 `**결정**` 부분, 설계 문서(`docs/*.md`)의 `결정 기록` 표 한 줄 | 댓글 시각 / 그 날짜 | 댓글 주소 + `#decision` / `저장소/#decision-날짜-본문해시` |

- 머지된 PR은 따로 점이 되지 않는다. 그 PR의 커밋이 `work`이고, PR은 번호(`pr`)와 이슈 연결(`Closes #n`)로만 쓴다.
- 줄 수는 커밋 하나의 `stats`(GitHub API)다. 파일 수는 바뀐 파일 개수.
- 작성자 거름은 #38과 같다. 이슈·댓글·PR은 `author_association`이 OWNER·COLLABORATOR인 것만, 커밋은 주인·협업자 로그인만, 결재는 주인만. 스크립트와 `/api/timeline`이 각각 한 번씩 거른다.

## 누가 했나 (귀속)

자리 낱말은 문서 파이프라인(`src/docs/parse.ts`)과 같다: 기획·메모 = 0, Blender·3D·메시 = 1, 디자인·디자이너·휴 = 2, 코더·루프 = 3. 여러 낱말이 있으면 **먼저 나온 것**이다.

**이슈의 자리**(작업·기획 점이 따른다), 위에서부터 첫 번째:

1. 이슈 폼 "누가 하나" 칸의 낱말
2. `asset` 라벨 → 1 (에셋 폼에는 그 칸이 없고, Blender가 한다)
3. 제목 맨 앞 `[태그]`의 낱말(예: `[디자인] …` → 2)
4. 모르면 `null`

**점별 규칙**

| 종류 | 에이전트 |
|---|---|
| `work` | 커밋 제목의 `(#이슈) (#PR)` 또는 PR 본문 `Closes #n`이 가리키는 **이슈의 자리**. 이슈를 못 찾으면 `null` |
| `plan` | 이슈의 자리가 정해졌으면(= 역할 분담이 있었으면) 기획자 0이 연 것으로 본다. 아니면 `null` |
| `minutes` | 표에서 처음 말하는 에이전트. 사용자(주인)가 먼저 말하면 건너뛴다 |
| `decision` | 기획 0 (결정은 기획의 일, 6.1절) |
| `approval` | 🖊는 `**요청**` 칸의 에이전트, ✅는 그 결과가 답한 🖊의 요청자 |
| `deploy` | 항상 `null`. 사무실 전체가 밝아지는 장면이고 한 자리의 일이 아니다 |

**`null`인 것과 이유** (예외 표)

| 경우 | 이유 |
|---|---|
| 이슈·PR 없이 들어간 직접 커밋(`docs: …`, rowansong.dev의 거의 전부) | 역할 분담 이전이거나 이슈 없이 한 작업 |
| 이슈 #1~#6, #8, #10, #12 등 초기 이슈와 그 커밋 | 폼·역할이 생기기 전(`[기능]`·`[문서]` 태그는 자리를 말하지 않는다) |
| `deploy` | 위 표. "미상"이 아니라 "전체" |
| rowansong.dev의 `plan`·`work` | 이슈 폼의 "누가 하나"가 없다 |

- 결정 기록 표의 날짜는 **한국 시각 그날 0시**로 둔다(날짜만 있고 시각이 없어서). 같은 날 커밋보다 앞에 놓이고, 한 줄을 고치면 다른 점이 된다(키에 본문 해시).
- 한 번 정해진 귀속을 바꿀 땐 이 표와 `scripts/timeline/build.mjs`를 같이 고친다.

## 공개 거름

6.3과 같다. 등급은 저장소 허용 목록(`OFFICE_PUBLIC_REPOS`, 기본 이 저장소)으로 정한다.

| 등급 | 점 |
|---|---|
| `public` | 제목·줄 수·파일 수·번호·에이전트 모두 |
| `review` | 제목 비움 + `secret`. **시각·종류·에이전트·크기(줄·파일 수)만**. 원천 주소와 이슈·PR 번호도 없다. 결재 뒤 공개는 나중(9절) |
| `private`(`OFFICE_PRIVATE_REPOS`) | 모으지 않는다(저장소를 읽지도 않는다) |

- 제목은 문서와 같은 필터(`src/docs/filter.ts`: 경로·이메일·키 모양·금지어)를 거친다. 걸리면 제목을 비우고 그 점을 `review`로 내린다.
- 일반 JS 쪽 필터(`scripts/timeline/filter.mjs`)는 `src/docs/filter.ts`의 복사본이다. node가 TypeScript를 못 읽어서이고, 테스트가 둘의 결과를 맞춰 본다. 고칠 땐 같이 고친다.
- `review` 점은 **불투명**하다. `key`는 `review:<프로젝트>:<원천 주소 sha256 앞 16자>`(같은 원천이면 항상 같아서 중복 제거는 된다), `issue`·`pr`은 `null`. 원천 주소(커밋 sha 등)가 어디에도 남지 않는다. 비공개 저장소의 사본이 공개 저장소·방문자 DB에 들어가기 때문이다. 거름은 `src/timeline/points.ts`와 `scripts/timeline/build.mjs`가 똑같이 하고, 서버 DB도 같은 규칙을 제약으로 건다(`supabase/timeline.sql`).
- 그래서 `review` 프로젝트(rowansong.dev)는 **이슈 단위 "이 일의 이력 재생"을 할 수 없다**(이슈 번호가 없다). 결재로 공개된 뒤에야 번호를 되살릴 수 있다(그때 다시 수집). 프로젝트·전체 타임라인은 시각·에이전트·크기로 그대로 재생된다.

## 쓰는 법

```bash
# 요약만(종류별 점 수, 귀속 null 수)
GITHUB_TOKEN=$(gh auth token) node scripts/timeline/backfill.mjs Rowan-Hyeho-Song/agent-office --dry-run
# JSON 사본(같은 입력이면 바이트까지 같다)
GITHUB_TOKEN=$(gh auth token) node scripts/timeline/backfill.mjs Rowan-Hyeho-Song/rowansong.dev --out src/timeline/fixtures/rowansong.dev.json
```

- 토큰은 환경변수나 `gh auth token`에서만 읽고 어디에도 출력·저장하지 않는다. 요청이 한도에 걸리면 GitHub가 알려 주는 만큼 기다렸다 다시 한다.
- `src/timeline/fixtures/*.json`은 배포 전 개발용 사본이다. 저장소는 공개이므로 `review` 제목은 비어 있다. 새 이력이 쌓이면 위 명령으로 다시 만든다.
- 서버 쪽은 초안이다: `supabase/timeline.sql`, `api/timeline.ts`, `.github/workflows/timeline.yml`(손으로만 도는 초안, 아무것도 보내지 않는다). 배포 때 함께 켠다.
