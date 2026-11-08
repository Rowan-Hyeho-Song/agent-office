# 사무실 훅 (#1)

Claude Code 세션이 일하는 모습을 사무실로 보내는 훅입니다. 이벤트마다 **자리 번호, 신호 종류, 활동 종류** 셋(과, 선언했을 때만 **저장소 이름과 이슈 번호**)만 `/api/events`로 보냅니다.

| 보내는 것 | 보내지 않는 것 |
|---|---|
| `seat` 0..3, `kind`(start·activity·stop·end), `activity`(아래 표), 선택: `repo`(허용 저장소 이름)와 `issue`(번호) | 세션 ID, 세션 이름, 작업 폴더, 명령 원문·인자·경로, 프롬프트, 도구 입력·출력, 답변 |

`repo`·`issue`는 아래 "맡은 이슈" 절의 선언이 있을 때만 갑니다. 이슈 **제목은 보내지 않습니다**: 서버가 이미 공개된 문서 사본에서 번호로 찾고, 비공개 저장소는 번호도 저장하지 않고 "책상 방 작업(비공개)"만 보입니다.

명령을 종류로 나누는 일은 내 PC 안에서 `classify.mjs`가 합니다. 서버는 목록에 없는 값을 받지 않습니다.

## 어떤 세션이 보내나: 허용 폴더 (#34)

훅은 사용자 설정에 등록되므로 이 PC의 **모든** Claude Code 세션에서 실행됩니다. 그래서 세션의 작업 폴더(`cwd`)가 허용 폴더 안일 때만 보냅니다. 회사 업무 같은 다른 프로젝트 세션은 이름이 무엇이든 **아무것도 보내지 않습니다**(`hook.log`에는 `skip: outside projects`).

- 기본 허용 폴더는 `**/agent-office*`, `**/rowansong.dev*`입니다. 이 두 저장소와 그 worktree(`agent-office-17` 같은 폴더)를 어디에 받아 두었든 맞습니다.
- 바꾸려면 `hook.json`에 `"projects"`를 둡니다. 형식은 `["D:/code/office", "**/agent-office*"]`처럼 씁니다. `*`는 폴더 이름 하나 안의 아무 글자, `**`는 폴더 여러 단계입니다. 대소문자와 `\`·`/` 구분은 무시하고, 맞은 폴더 아래는 모두 포함합니다.
- 선택: `"outside": "private"`이면 허용 폴더 밖 세션도 자리가 정해질 때 활동 없이 "비공개 작업 중"(`private`)만 보냅니다. 기본은 꺼져 있습니다.
- 작업 폴더 경로는 판단에만 쓰고, 보내지도 `hook.log`에 남기지도 않습니다.

## 맡은 이슈 (#182)

세션이 지금 어떤 이슈를 하는지 사무실에 보이려면, 그 폴더에서 한 번 선언합니다.

```
node hooks/task.mjs agent-office 170   # 이 폴더(와 그 아래)의 세션이 #170을 하는 중
node hooks/task.mjs --clear            # 지우기
node hooks/task.mjs                    # 지금 선언된 것 보기
```

- 범위는 **작업 폴더(git 체크아웃 폴더)별**입니다. `~/.agent-office/tasks.json`에 그 폴더 경로를 키로 저장하고, 그 폴더나 그 아래에서 시작한 세션이 모두 같은 이슈를 보냅니다. worktree마다 따로 선언합니다. `AGENT_OFFICE_TASK=agent-office#170`을 환경에 두면 그 셸에서 시작한 세션에 한해 파일보다 우선합니다.
- 저장소는 허용 목록(`hook.json`의 `"repos"`, 기본 `["agent-office", "rowansong.dev"]`)에 있어야 하고 번호는 양의 정수여야 합니다. 아니면 선언도 전송도 하지 않습니다.
- 허용 폴더 안 세션만 보냅니다. `"outside": "private"`로 도는 세션은 선언이 있어도 `repo`·`issue`를 **절대** 보내지 않습니다.
- 신호마다 현재 이슈를 실어 보내고, 없으면 서버가 지웁니다(세션이 끝나도 지웁니다). 이슈를 바꾸면 다음 신호부터 바뀝니다.
- 서버는 자기 목록(`OFFICE_TASK_REPOS`, 기본 두 저장소)에 있는 저장소와 1..1000000 번호만 받고, 아니면 그 필드만 무시합니다. 공개 저장소(`OFFICE_PUBLIC_REPOS`)는 공개·승인된 `plan` 문서에서 제목을 찾고, 그 밖의 저장소는 "비공개"로만 표시합니다.

## 자리 정하기

허용 폴더 안의 세션은 세션 이름(Claude Code의 `/rename`, 또는 에디터에서 붙인 이름)으로 자리를 정합니다. 먼저 맞는 규칙이 이깁니다. `design`·`3d`·`planning`·`coder`처럼 흔한 영어 낱말은 넣지 않았습니다(#34).

| 자리 | 에이전트 | 세션 이름에 이 말이 있으면 |
|---|---|---|
| 0 | 메모 MEMO (기획) | 기획, 메모, memo(낱말) |
| 1 | 메시 MESH (3D) | blender, 메시, mesh(낱말) |
| 2 | 휴 HUE (디자인) | 디자이너, 디자인, hue(낱말) |
| 3 | 루프 LOOP (코더) | 코더, 루프, loop(낱말) |

- 이름은 SessionStart와 UserPromptSubmit에 들어옵니다. 한 번 정해지면 그 세션의 다른 이벤트에도 같은 자리를 씁니다. 자리는 `~/.agent-office/sessions/<세션>.json`에 로컬로만 기록하고, 3일이 지나면 지웁니다.
- 이름이 없거나 맞는 규칙이 없는 세션은 아무것도 보내지 않습니다.
- 하위 에이전트(Agent 도구)의 도구 호출은 부모 세션의 활동으로 셉니다.
- 터미널에서 띄우는 세션은 `AGENT_OFFICE_SEAT=3 claude`처럼 자리를 직접 줄 수 있습니다.

## 활동 종류

| 훅 이벤트 | 도구 | activity | 사무실 문구 |
|---|---|---|---|
| UserPromptSubmit | | `think` | 생각하는 중 |
| PreToolUse | Edit · Write · MultiEdit · NotebookEdit | `edit` | 파일 편집 중 |
| PreToolUse | Read · Grep · Glob · WebFetch · WebSearch | `read` | 코드 읽는 중 |
| PreToolUse | Agent · Task | `delegate` | 일 나누는 중 |
| PreToolUse | Bash · PowerShell, 테스트 명령 | `test` | 테스트 실행 중 |
| PreToolUse | Bash · PowerShell, 빌드·타입 검사·린트 | `build` | 빌드 중 |
| PreToolUse | Bash · PowerShell, 패키지 설치 | `install` | 설치 중 |
| PreToolUse | Bash · PowerShell, git · gh | `git` | 버전 기록 중 |
| PreToolUse | Bash · PowerShell, 앱·스크립트 실행 | `run` | 앱 실행 중 |
| PreToolUse | 그 밖의 명령과 도구 | `other` | 명령 실행 중 |
| (허용 폴더 밖, `"outside": "private"`일 때만) | 모든 활동 | `private` | 비공개 작업 중 |

- Bash 명령은 `&&`, `;`, `|`로 나눈 조각 중에서 준비 단계(`cd`, 환경 변수, `echo`, `ls` …)가 아닌 첫 조각으로 판단합니다. 규칙은 `classify.mjs`의 `BASH_RULES`에 있습니다.
- 같은 활동이 이어지면 30초에 한 번만 보냅니다(`keepaliveSeconds`).

| 그 밖의 이벤트 | kind | 사무실 상태 |
|---|---|---|
| SessionStart | `start` | 출근(쉬는 중) |
| Stop(턴이 끝남) | `stop` | 카드 정리 중 → 2분 뒤 쉬는 중 |
| SessionEnd | `end` | 퇴근 |
| PostToolUse / PostToolUseFailure(Bash·PowerShell, test·build 명령만) | `result` + `ok` | 루프 신호등 초록/빨강, 메시 링 조명(#44) |

**성공/실패 값(#44)**: Claude Code는 셸 명령이 성공하면 PostToolUse를, 0이 아닌 코드로 끝나면 PostToolUseFailure를 부릅니다. 훅은 **어느 이벤트가 불렸는지만** 보고 `ok`(true/false)를 정합니다. 명령의 출력(`tool_response`)과 오류 문구(`error`)는 읽지도 보내지도 않습니다. test·build로 분류된 명령만 보내고, 허용 폴더 밖이나 `"outside": "private"` 세션은 보내지 않습니다. Blender 굽기(`blender …`, `build-*.sh`)는 build로 셉니다.

신호가 끊기면 페이지가 시간으로 판단합니다. 작업 중에 3분 동안 신호가 없으면 쉬는 중으로, 2시간 동안 없으면 퇴근으로 봅니다.

## 설치

1. 설정 파일 `~/.agent-office/hook.json`(Windows: `%USERPROFILE%\.agent-office\hook.json`):

   ```json
   { "endpoint": "https://<사무실 주소>/api/events", "token": "<OFFICE_HOOK_TOKEN과 같은 값>" }
   ```

   설치를 확인할 때는 `"log": true`를 더합니다. `~/.agent-office/hook.log`에 이벤트마다 한 줄이 남습니다(이벤트, 자리, 보낸 것, 응답 코드만 기록).

2. 사용자 설정 `~/.claude/settings.json`의 `hooks`에 아래를 더합니다. `<저장소>`는 이 저장소를 받아 둔 경로입니다.
   - 신호 훅 `office-hook.mjs`: 이벤트 일곱 개 모두 같은 명령입니다. `async`라서 도구 호출을 기다리게 하지 않습니다. PostToolUse·PostToolUseFailure는 `Bash|PowerShell`에만 겁니다(#44).
   - 결재 훅 `approval-hook.mjs`(#25): SessionStart와 UserPromptSubmit에만 겁니다. 출력이 문맥에 들어가야 하므로 `async`가 **아니고**, 대신 짧은 `timeout`을 둡니다(서버를 3초까지만 기다림).

   ```json
   {
     "hooks": {
       "SessionStart": [{ "hooks": [
         { "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true },
         { "type": "command", "command": "node \"<저장소>/hooks/approval-hook.mjs\"", "timeout": 5 }
       ] }],
       "UserPromptSubmit": [{ "hooks": [
         { "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true },
         { "type": "command", "command": "node \"<저장소>/hooks/approval-hook.mjs\"", "timeout": 5 }
       ] }],
       "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true }] }],
       "PostToolUse":        [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true }] }],
       "PostToolUseFailure": [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true }] }],
       "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true }] }],
       "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node \"<저장소>/hooks/office-hook.mjs\"", "async": true }] }]
     }
   }
   ```

3. 확인: 세션에서 아무 도구나 쓰고 `hook.log`에 `activity/… → 200`이 찍히는지 봅니다. 사무실 왼쪽 위 목록에서 그 에이전트의 문구가 1~2초 안에 바뀌면 됩니다.

## 결재 훅 (#25)

`approval-hook.mjs`는 세션이 시작되거나 내가 입력할 때, **그 세션 자리**가 올린 `🖊 결재 요청`에 새 `✅ 결재`가 났는지 `/api/approvals`에 묻습니다. 있으면 한 번만 문맥에 넣습니다. 마지막으로 넘긴 시각은 `~/.agent-office/approvals-seat-<자리>.json`에 남깁니다.

- 넣을 수 있는 내용은 처음부터 좁습니다. 서버는 주인 계정이 쓴 `🖊` 요청과 주인 계정이 쓴 `✅` 결과만 보관합니다(#38). 그래서 외부인이 이 통로로 에이전트에게 말을 넣을 수 없습니다.
- 보내는 것은 자리 번호뿐이고, 허용 폴더 밖 세션에서는 아무것도 하지 않습니다.
- Claude Code의 도구 권한 묻기(명령 실행 허용 등)는 결재로 넘기지 않습니다(plan.md 6.5).
- 결재 주소는 `hook.json`의 `endpoint`에서 `/api/events`를 `/api/approvals`로 바꾼 것이고, `"approvalsEndpoint"`로 따로 줄 수 있습니다.

문제가 있을 때 훅은 조용히 끝납니다(종료 코드는 항상 0). 원인을 보려면 터미널에서 직접 실행합니다:
`echo '{"session_id":"t","hook_event_name":"PreToolUse","tool_name":"Read"}' | AGENT_OFFICE_SEAT=3 AGENT_OFFICE_DEBUG=1 node hooks/office-hook.mjs`
