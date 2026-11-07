# 작업 방식

## 브랜치

```text
main ← 배포할 때만 (dev → main)
 └ dev ← 기능·수정을 모으는 기본 브랜치
    ├ feature/<이슈번호>-<짧은-이름>   예) feature/1-signal-pipeline
    └ fix/<이슈번호>-<짧은-이름>       예) fix/7-realtime-reconnect
```

- `main`: 배포본. 직접 커밋하지 않는다. 배포할 때 `dev`를 합친다.
- `dev`: GitHub 기본 브랜치. 작업 브랜치는 여기서 따고 여기로 합친다.

## 순서

1. **이슈 등록**: 기능 하나, 오류 하나마다 이슈를 만든다. 무엇을, 왜, 끝났다고 볼 기준을 적는다.
2. **브랜치**: `dev`에서 이슈 번호를 딴 브랜치를 만든다.
   ```bash
   git switch dev && git pull
   git switch -c feature/12-visitor-notes
   ```
3. **작업·커밋**: 커밋 메시지에 이슈 번호를 단다(`… (#12)`).
4. **PR → dev**: 본문에 `Closes #12`. 확인이 끝나면 `dev`로 합친다(스쿼시).
5. **배포**: 모아서 내보낼 때 `dev → main` PR을 만들어 합친다. `main`에 들어가면 배포된다.

## 이슈 라벨

- `feature`: 새 기능
- `bug`: 오류
- `docs`: 문서
- `asset`: 3D 에셋(Blender)

## 이슈·PR 템플릿

이슈는 에이전트에게 주는 지시서이기도 하다. 그래서 폼이 강제하는 것: 기능 하나만, **하지 않을 것**까지 적은 범위, 확인할 수 있는 완료 기준, 어디부터 볼지(관련 파일). 빈 이슈는 막혀 있다.

| 폼 | 언제 |
|---|---|
| 기능 (`feature.yml`) | 새 기능·개선 |
| 오류 (`bug.yml`) | 재현 단계·환경·스크린샷 |
| 3D 에셋 (`asset.yml`) | Blender 모델·라이트 베이킹·애니메이션 |

CLI(에이전트)로 이슈를 만들 때도 같은 칸을 본문 제목으로 쓴다: `gh issue create --label feature --title "[기능] …" --body-file …`.

PR 템플릿(`pull_request_template.md`)이 묻는 것: 연결 이슈, 무엇을 왜, **실제로 확인한 것과 결과**(명령·화면·숫자, 못 한 것은 못 했다고), 전후 스크린샷, 위험과 되돌리기, 민감 정보 점검, AI 작성 여부(사람 / AI 보조 / 에이전트 작성 + 사람 검토, 모델).

## 이미지 첨부

`gh` CLI는 이슈·PR에 이미지를 직접 붙이지 못한다. 그래서 **`image-assets` 프리릴리스**에 올리고 그 주소를 마크다운으로 붙인다(일반 `gh` 인증만 필요, 공개 저장소라 로그인 없이 보임).

```bash
scripts/gh-image.sh shot.png                 # → ![shot](https://github.com/…/releases/download/image-assets/shot-20261108-101500.png)
scripts/gh-image.sh -p 12 before.png after.png   # 이슈·PR 번호를 앞에 붙임
```

- 파일 이름에 시각을 붙여, 같은 이름을 다시 올려도 예전 댓글의 그림이 바뀌지 않는다.
- `image-assets`는 배포 릴리스가 아니다. **드래프트로 바꾸지 말 것**(드래프트의 파일은 로그인 안 한 사람에게 404).
- 민감한 화면(키·개인 정보·회사 화면)은 올리지 않는다. 한번 올린 파일은 누구나 받을 수 있다.
- 브라우저에서 이슈를 쓸 때는 그냥 끌어다 놓아도 된다.
