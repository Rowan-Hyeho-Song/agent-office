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
