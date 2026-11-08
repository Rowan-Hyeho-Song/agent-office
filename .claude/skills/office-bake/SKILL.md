---
name: office-bake
description: agent-office의 3D 사무실을 굽거나 glb를 고칠 때 쓴다. 대상은 assets/blender/office_bake.py → public/models/office.glb와 아틀라스 webp다. Blender로 사물·노드를 더하거나 바꿀 때, build-office.sh로 다시 구울 때, 미리보기를 렌더할 때, office.glb의 노드·extras·UV·피벗을 검사할 때, 코더에게 넘길 노드 표를 쓸 때 쓴다. (Baking or changing the office 3D assets / fixing office.glb.)
---

# office-bake: 사무실 3D 굽기

사무실은 Blender 스크립트 하나가 처음부터 만든다. 모델링 → Cycles 굽기 → OIDN → webp 아틀라스 → glTF(extras) → gltf-transform meshopt 순서다. 손으로 고친 .blend는 없고, 바꿀 것은 늘 스크립트다.

## 1. 파일

| 파일 | 내용 |
|---|---|
| `assets/blender/office_bake.py` | 방 전체. 맨 위 docstring이 **노드 계약**(앱이 읽는 이름·extras)의 원본이다. 노드를 더하면 여기부터 고친다 |
| `assets/blender/bakekit.py` | 공통 도구: `W`, `Mx`, `box`, `cyl`, `quad`, `text`, `join`, `place`, `pivot`, `baked`, `live`, 재질(`plastic`, `emitter`, `screen_mat`), 굽기·저장 |
| `assets/blender/build-office.sh` | 굽기 → 최적화 → `public/models/`에 설치 |
| `docs/design/*.md` | 사물의 치수·색·위치 시안(디자이너). 시안에 없는 것은 디자이너와 정한다 |
| `src/office/nodes.tsx` | 앱이 glb를 읽는 곳: `prepare()`(재질 교체), `rebase()`(pivot_at으로 원점 재구성), `GLOW` |
| `check-glb.mjs`(이 폴더) | 노드·extras·UV·이름 검사(5절) |

## 2. 굽기와 미리보기 (Windows, Git Bash)

```bash
cd assets/blender
rm -f out/office/office.blend@ out/office/office.blend1   # 먼저 지운다(아래 함정)
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" ./build-office.sh
```

- 마지막 줄에 `DONE`과 `ls public/models`가 나와야 끝난 것이다.
- **`MSYS_NO_PATHCONV=1`을 붙이지 않는다.** 붙이면 `/c/Repo/...`가 Blender에 그대로 넘어가 저장에 실패한다.
- **남은 `office.blend@`가 있으면 "Version backup failed"로 스크립트가 glb 내보내기 전에 멈춘다.** 그래도 빌드 스크립트는 계속 돌아서 **옛 glb를 최적화해 설치**한다. 그래서 굽기 전에 지우고, 로그에서 `DONE`을 확인한다.
- Blender는 한 번에 하나만 돌린다(굽기 둘을 동시에 하지 않는다). 시간이 걸리면 백그라운드로 돌리고 끝나기를 기다린다.
- 도장 글꼴 `out/fonts/Galmuri11-Bold.ttf`는 build-office.sh가 처음 한 번 받는다(jsdelivr galmuri@2.40.3, OFL). 미리보기만 따로 돌릴 때는 그 전에 한 번 빌드했거나 직접 받아 둔다. 저장소에는 넣지 않는다.

미리보기(굽기 없이 Cycles 렌더, 수십 초):

```bash
"$BLENDER" --background --factory-startup --python office_bake.py -- "$PWD/out/preview" --preview --shot=overview,library
"$BLENDER" --background --factory-startup --python office_bake.py -- "$PWD/out/preview" --preview --shot=none   # 만들기만, 삼각형 수 출력
```

- 샷 이름은 `office_bake.py`의 `if PREVIEW:` 블록에 있다. 새 사물은 확대 샷을 거기에 더한다. 앱이 할 일(숨기기·기울이기·색 바꾸기)을 흉내 낸 미리보기는 그 블록 안에서만 바꾼다.
- `--tris`를 붙이면 부분별 삼각형 수를 찍는다.

## 3. 좌표와 노드 규칙

**좌표.** 모든 치수는 **웹 좌표**로 쓴다. y가 위, 방 앞이 +z, 뒷벽이 −z, 왼벽이 −x다(`HX, HZ = 3.5, 2.75`).
- `W(x, y, z)` = Blender `(x, −z, y)`다.
- `Mx(loc, rx, ry, rz)`는 웹 기준 Euler XYZ다. 양의 rx는 +y를 +z 쪽으로 돌린다.
- 축 벡터로 행렬을 만들 때 Blender 열 순서는 **(x, −z, y)**다. 웹 축을 그대로 열에 넣으면 틀린다(#27 손 방향 버그).
- 책상 소품은 `frame(at)` 책상 틀 안에서 만들고 `place()`로 옮긴다.

**피벗.** 움직이거나 도는 노드는 `pivot(o, M)`으로 만든다.
- extras `pivot_at`(웹 좌표)이 붙는다. meshopt 양자화가 노드 원점을 옮기기 때문에, 앱은 노드 위치가 아니라 `pivot_at`으로 원점을 다시 세운다.
- 이름을 `pivot`으로 하지 않는다. three GLTFLoader(r187+)는 자식이 있는 노드의 `extras.pivot`을 따로 처리해 깨뜨린다.

**노드 구조.**
- live 노드는 모두 **최상위**에 두고, 붙이는 것은 앱이 한다.
- 자식으로 둔 **메시**는 `rebase()`가 부모 틀로 펴 버려 제 피벗을 잃는다. 따로 도는 부분(도장, 손가락)은 최상위 노드로 둔다.
- 자식으로 남는 것은 이름 있는 빈 노드(`_grip`)뿐이다.

**live 종류**(`live(o, kind)`, `prepare()`가 재질을 정함):

| 종류 | 앱에서 | 쓰는 곳 |
|---|---|---|
| (atlas) `baked(o, atlas)` | `MeshBasicMaterial` + 아틀라스, **앞면만 그림** | 움직이지 않는 것. 얇은 판은 양면 사본이나 solidify로 |
| `bot` | 내보낸 PBR 그대로, 실시간 조명 | 에이전트, 앱이 보이기·색을 바꾸는 것(서류 장, 파일철) |
| `prop` | PBR, **PropBank가 집어 듦**(extras prop, home, grip) | 손에 드는 것만. 누르는 대상에 쓰지 않는다 → `hit_*` |
| `neon` | emissive × `GLOW` 2.6, 조명 없음 | 빛나는 것(켜고 끔) |
| `screen`, `face` | 캔버스 슬롯(extras `screen`, `aspect`, `w`, `h`, `ppm`). 꺼진 화면 재질로 나감 | 모니터, 달력, 이름표 |
| `anchor` | 메시 없는 빈 노드 + `pivot_at` | 바라볼 점 |

**빈 노드.**
- `nav_<id>`(extras `nav`, `ry`): 동선
- `surface_<name>`(`w`, `h`, `normal`): 앱이 붙이는 면
- `hit_<name>`(`hit`, `size [w, h, d]`, 노드 위치·회전 = 상자): 누르는 곳

**난수.** `RNG = Random(7)`은 방 전체가 순서대로 같이 쓴다. 무엇을 빼더라도 **그 자리의 난수는 그대로 뽑는다**(책장 칸 1–3, 옛 화분의 20번). 새 사물은 제 난수를 쓴다(`DRNG = Random(43)`, `LRNG = Random(67)`처럼 이슈 번호로).

**이름.** 겹치지 않게 짓는다. Blender가 겹친 이름에 `.001`을 붙이면 three에서는 점이 빠져 `x001`이 되고, 앱이 그 노드를 못 찾는다. 이름은 Blender가 아니라 **glb에서** 확인한다(5절 스크립트가 잡는다).

## 4. 굽기에서 뺄 것

움직이거나 앱이 숨기는 노드는 굽기 전에 `hide_render`로 뺀다. 안 그러면 그림자가 구워져 남는다.
- 대상은 `office_bake.py`의 `# agents and props move` 아래 루프에 있다. 지금은 `agent_*`, live `prop`, `shelf_r*`다.
- 새 접두어가 생기면 그 루프에 더한다.
- 제자리에 늘 있는 live(서류 더미, 신호등 등)는 굽기에 넣어 접촉 그림자를 남긴다.

## 5. 검사

**glb 검사**(브라우저 없이 Node에서, 앱과 같은 GLTFLoader + MeshoptDecoder):

```bash
node .claude/skills/office-bake/check-glb.mjs                                  # public/models/office.glb
node .claude/skills/office-bake/check-glb.mjs --want hit_library,neon_approval --show "^hit_"
```

- 출력: 종류별 노드 수와 삼각형, 겹친 이름(`x001`), `--want` 빠짐(종료 코드 1), 캔버스 칸 UV(extras `canvas`, `cell`, `grid`)가 제 칸 안인지, `--show` 노드의 월드 위치·크기·extras
- 새 노드는 `--want`로 이름을 모두 넘겨 확인한다.

**눈으로 보기.**
1. 앱: `pnpm dev`를 띄운 뒤 `?debug=1`로 연다. `&cam=x,y,z,tx,ty,tz`로 카메라를 고정하고, 디버그 판(작업 중, 결재 +1, 굽기 시작 등)으로 LIVE를 움직여 본다. 기본 카메라 컷은 늘 남긴다.
2. 앱이 아직 모르는 동작(숨기기, pivot_at 중심 회전, 재질 복제·색)은 three.js 검사 페이지에서 흉내 내 본다. vite가 떠 있으면 `/node_modules/.vite/deps/three.js`를 import해 쓸 수 있다.
3. 에이전트가 **일하는 자리에 있을 때** 가려지지 않는지 본다. Cycles 미리보기에는 에이전트가 쉬는 자리에 있다(#43: 서류함이 옆자리 머리에 가림).
4. 끝나면 dev 서버를 끈다. 사용자는 다른 기기에서 일하므로 이 PC에 서버를 남기지 않는다. 포트가 남았으면 그 node 프로세스를 끝낸다.

## 6. glTF 내보내기 함정 (일부는 외부 출처, THIRD_PARTY.md)

- **절차적 텍스처는 glb로 안 나간다.** Noise, Color Ramp, Noise → Bump가 그렇다. `plastic(grain=…)`의 결 범프는 굽기(아틀라스)에만 남는다. live PBR 부분은 기본색·거칠기·금속도 값만 나간다. 발광은 나간다(emissiveFactor + `KHR_materials_emissive_strength`).
- **이름이 바뀐다.** 공백은 `_`가 되고 점은 빠진다(`Sphere.003` → `Sphere003`). 코드가 쓰는 이름은 glb에서 확인한다.
- **압축은 맨 끝에 한 번만.** meshopt를 다시 걸지 않는다.
- **`gltf-transform optimize`의 기본값은 메시를 바꾼다**(simplify, join, instance, palette, prune). build-office.sh는 이것들을 모두 끈 채로 meshopt만 건다. 그 플래그를 빼지 않는다.
  - `--prune-attributes false`: glb에 텍스처가 없어 UV가 "안 쓰임"으로 지워지는 것을 막는다.
  - `--flatten false --prune false`: `nav_*`, `hit_*` 같은 빈 노드를 지키는 것이다.
- **`export_apply=True`가 맞다.** 외부 글은 Array 모디파이어 때문에 False를 권하지만, 우리는 Array가 없고 solidify·bevel을 적용해 내보내야 한다.
- **WebP는 내려받는 크기만 줄이고 GPU 메모리는 줄이지 않는다.** 2048 아틀라스 하나가 밉맵까지 약 21 MB, 넷이면 약 85 MB다. GPU 메모리를 줄이는 길은 크기 축소나 KTX2(#83에서 따로 다룸)다.
- 들여다보기: `pnpm dlx @gltf-transform/cli@4 inspect public/models/office.glb`

## 7. 크기와 예산

- 굽기 **전에** `ls -l public/models`를 적어 두고, 뒤와 비교해 PR에 쓴다(glb, 아틀라스별, 합계).
- 지금까지 지킨 선:
  - 모델 합계 3 MB 이하(#43)
  - 에이전트 하나 약 2.6천 삼각형(#27)
  - 자리당 책상 소품 4천 이하(#43)
- 넘으면 분할 수부터 줄인다(토러스·구 세그먼트, bevel seg).

## 8. PR 노드 표

코더가 그대로 잇도록 PR 본문에 표를 둔다. 좌표는 웹(m)이고 모두 최상위라고 적는다.

| 노드 | 종류 | 피벗(pivot_at) | extras | 앱이 하는 일 |
|---|---|---|---|---|
| `shelf_r<r>_b<k>` | live bot | 책등 바닥 오른쪽 앞 모서리 | `shelf`, `slot` | 보이기, 표지 색, 마지막 권 −8° 기대기 |

- glTF에는 "숨김"이 없어서 모든 노드가 보이는 채로 나간다. **앱이 기본으로 숨겨야 하는 것**(예: SECRET 도장)은 표에 적는다. 앱이 잇기 전까지 dev 화면이 어떻게 보이는지는 "위험" 절에 적는다.
- 스크린샷은 `scripts/gh-image.sh -p <이슈번호> 파일.png`로 올린다. 기본 카메라 전후 + 확대 컷을 넣는다.
- 이슈 → `feature/<n>-slug`(dev에서) → PR(dev). 디자이너 확인은 PR에 남는다. 협의는 이슈에 `🗂 에이전트 간 협의 기록`으로 남긴다.

## 9. 지난 함정

| 이슈 | 함정 | 지금 규칙 |
|---|---|---|
| #27 | 축 벡터를 Blender 열에 그대로 넣어 손가락이 몸 안쪽을 봄 | 열 순서 (x, −z, y) |
| #27 | `_grip` 회전을 0이라고 문서에 씀 → #20 소품이 뒤집힐 뻔 | 계산한 실제 값을 three.js로 재서 적는다 |
| #27 | 에이전트 하나 3.1–3.6천 삼각형 | 세그먼트를 낮춰 2.3–2.6천 |
| #43 | 집어 드는 소품의 그림자가 탁자에 구워져 남음 | `prop`은 굽기에서 뺀다 |
| #43 | 미리보기에선 보이던 서류함이 앱에서 옆자리 머리에 가림 | 일하는 자리에서 앱으로 본다 |
| #67 | 캔버스 라벨이 거꾸로, 행이 뒤집힘 | 캔버스 텍스처 `flipY = false`(아틀라스와 같은 glTF 규칙). v = 0이 캔버스 맨 위 |
| #67 | 30권과 도장이 앱에서 다 보임 | 앱이 기본으로 숨길 것을 노드 표에 적는다 |
| #67 | 누르는 대상을 `prop`으로 하면 PropBank가 집어 감 | `hit_*` 빈 노드 |
| 병합 | squash 병합 뒤 dev를 합치면 같은 내용으로 충돌 | dev 쪽이 내 커밋과 같은지 확인한 뒤 `git checkout --ours` |
| 병합 | 다른 PR이 의존성을 더함 | `pnpm install --frozen-lockfile` |
