# 통통 대전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bonk.io 방식의 실시간 물리 대전 게임(클래식·갈고리·화살, 최대 6명, AI 포함)을 브라우저에서 동작하게 만든다.

**Architecture:** 물리(`physics`)와 진행 규칙(`game`)은 화면·통신 없이 동작하는 순수 모듈이다. `session`이 한 경기의 물리 세계·AI·라운드 진행을 묶고, `multiplayer`가 방(presence)을 읽고 써서 `session`에 상대 상태를 넘긴다. 연습하기는 나 혼자 들어 있는 메모리 방(`LocalRoom`)을 쓰므로 같이 하기와 같은 경로로 동작한다. 모든 브라우저가 전체 물리를 계산하되 자기 공(방장은 AI 공까지)만 확정해서 알린다.

**Tech Stack:** Vite 7, TypeScript(strict), Vitest, planck 1.5(물리), peerjs 1.5(공개 사이트 P2P), Canvas 2D + HTML 메뉴.

**Spec:** `docs/superpowers/specs/2026-10-07-bonk-arena-design.md` (작업 전에 반드시 읽을 것)

## Global Constraints

- 저장소는 `/Users/logibros/development/projects/game-projects/bonk-arena`. 홈 디렉토리도 git 저장소이므로 반드시 이 폴더 안에서 git 명령을 실행한다. 작업 브랜치는 `feat/game`(main에는 문서만 둔다).
- 커밋은 `git add <파일 경로들>`처럼 경로를 지정해서 한다(`git add -A` 금지). 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- 실행 의존성은 `planck`와 `peerjs`만. `peerjs`는 `import.meta.env.VITE_NET === 'p2p'`일 때 동적 import로만 불러온다.
- `npm run build` 결과는 `dist/assets` 아래에 JS 파일 하나(+CSS 하나)만 나와야 한다. 소리 파일은 `?inline`으로 JS 안에 넣는다.
- 코드 형식은 `suika-game`과 같다: 작은따옴표, 세미콜론, 들여쓰기 2칸, 줄 길이 120, 공개 함수·상수에 한국어 `/** */` 주석(합니다체).
- 화면 문구: 버튼은 "~하기" 또는 명사형, 설명·안내는 "~합니다."체. "~해 주세요", "~해요" 금지.
- localStorage는 `bonk-arena.profile.v1` 키만 읽고 쓴다. `localStorage.clear()` 금지.
- 좌표는 미터 단위, y축은 아래쪽이 양수. 화면은 가로 32m × 세로 18m.
- 색은 파랑·주황·초록·보라·노랑·청록 6가지. 분홍 계열 금지.
- macOS에는 `timeout` 명령이 없다. 테스트는 `npx vitest run`으로 실행한다(감시 모드 금지).
- planck API가 확실하지 않으면 `node_modules/planck`의 타입 선언을 읽어서 확인한다.
- 배포(아티팩트 게시, 저장소 공개, push)는 하지 않는다.

## Review Focus

1. **잘못된 presence 값**: 필드 누락, 문자열·NaN·Infinity, 수천 개짜리 화살 배열이 와도 오류 없이 기본값으로 읽고, 화살은 사람당 8개까지만 받는다. → Task 5 `wire.test.ts`
2. **탭이 가려졌다가 돌아옴**: 한 프레임의 경과 시간이 0.5초를 넘으면 밀린 시간을 계산하지 않는다. → Task 6 `session.test.ts`
3. **대전 중 방장 이탈**: 새 방장이 점수표·라운드·AI를 이어받고, AI가 계속 움직인다. → Task 6, Task 7
4. **색 충돌과 정원 초과**: 같은 색을 고른 두 사람 가운데 늦게 온 사람이 빈 색으로 옮겨지고, 사람이 늘면 AI가 줄며, 일곱 번째 사람은 안내와 함께 나간다. → Task 7 `multiplayer.test.ts`
5. **라운드 경계의 입력**: 카운트다운 중에는 입력이 적용되지 않고, 앞 라운드에서 모으던 화살·걸린 줄·무거움이 다음 라운드로 넘어가지 않는다. → Task 6 `session.test.ts`

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/game/modes.ts` | 모드 목록, 목표 점수, 모든 조정 수치(`TUNING`) |
| `src/game/maps.ts` | 맵 6개, 시작 위치 배정, 다음 맵 고르기 |
| `src/physics/geometry.ts` | 맵 도형에 대한 계산(위쪽 가장 가까운 지점, 아래 표면, 선분 충돌) |
| `src/physics/world.ts` | planck 세계: 공, 입력, 무거움, 줄, 화살, 경계, 원격 보정 |
| `src/game/round.ts` | 방장의 경기 진행(단계, 점수) |
| `src/game/bot.ts` | AI 입력 결정 |
| `src/game/lobby.ts` | 방 코드, 이름 다듬기, 색, 방장 고르기, 정원 |
| `src/net/types.ts`, `connect.ts`, `p2p-room.ts`, `peer-key.ts` | `suika-game`에서 복사해 이름만 바꿈 |
| `src/net/local-room.ts` | 나만 있는 메모리 방(연습하기) |
| `src/net/wire.ts` | presence 형식 읽기·쓰기 |
| `src/session.ts` | 한 경기 실행: 세계 만들기, 원격 상태 적용, AI, 방장 진행 |
| `src/multiplayer.ts` | 방 들어가기·나가기, 대기실, 방장 선출, 송수신 |
| `src/input.ts`, `src/audio.ts`, `src/storage.ts` | 입력, 소리, 저장 |
| `src/render/scene.ts`, `src/render/effects.ts` | 그리기 |
| `src/ui/menus.ts`, `src/style.css`, `src/main.ts` | 메뉴와 조립 |

---

### Task 1: 뼈대, 수치, 맵, 도형 계산

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.web`, `src/vite-env.d.ts`, `src/game/modes.ts`, `src/game/maps.ts`, `src/physics/geometry.ts`
- Test: `tests/maps.test.ts`, `tests/geometry.test.ts`

**Interfaces (Produces):**

```ts
// src/game/modes.ts
export type Mode = 'classic' | 'grapple' | 'arrows';
export const MODES: readonly { id: Mode; name: string; summary: string }[];
// 클래식 '무거워지기' / 갈고리 '줄 걸기' / 화살 '화살 쏘기'를 summary에 합니다체로 설명
export function readMode(value: unknown): Mode; // 모르는 값은 'classic'
export const TARGETS = [3, 5, 7] as const;
export const DEFAULT_TARGET = 5;
export const TUNING = {
  step: 1 / 60, gravity: 20, radius: 0.5, restitution: 0.5, friction: 0.3,
  accel: 18, jumpSpeed: 9, jumpCooldown: 0.15, damping: 0.3, heavyMass: 3,
  ropeReach: 8,
  arrowMinCharge: 0.2, arrowMaxCharge: 1, arrowMinSpeed: 12, arrowMaxSpeed: 30,
  arrowStuckLife: 3, arrowLife: 5, arrowCooldown: 1, arrowRadius: 0.1,
  viewW: 32, viewH: 18, boundsMargin: 2,
  countdownMs: 3000, roundLimitMs: 90000, roundEndMs: 2000,
} as const;

// src/game/maps.ts
export type Shape =
  | { kind: 'box'; x: number; y: number; w: number; h: number; angle?: number } // x,y는 중심, angle은 라디안
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'poly'; points: readonly (readonly [number, number])[] }; // 볼록, 시계 방향 무관
export interface GameMap { id: string; name: string; shapes: readonly Shape[]; spawns: readonly (readonly [number, number])[] }
export const MAPS: readonly GameMap[]; // 평지, 두 섬, 계단, 그릇, 기둥, 언덕 순서
export const RANDOM_MAP = -1;
/** 참가 순서 index인 사람이 round번째 라운드에 쓰는 시작 위치 번호. */
export function spawnSlot(index: number, round: number): number; // (index + round) % 6
/** setting이 RANDOM_MAP이면 previous와 다른 맵을, 아니면 setting을 돌려준다. */
export function nextMap(setting: number, previous: number, random: () => number): number;

// src/physics/geometry.ts
export type Point = readonly [number, number];
/** 도형을 꼭짓점 목록으로 바꾼다(원은 null). */
export function corners(shape: Shape): Point[] | null;
/** (x,y)보다 위(y가 더 작은 쪽)에 있는 발판 표면 가운데 가장 가까운 지점. reach 안에 없으면 null. */
export function closestAbove(map: GameMap, x: number, y: number, reach: number): Point | null;
/** x 위치에서 y보다 아래에 있는 가장 가까운 발판 표면의 y. 없으면 null. */
export function surfaceBelow(map: GameMap, x: number, y: number): number | null;
/** 선분 a→b가 발판에 처음 닿는 지점. 닿지 않으면 null. */
export function segmentHit(map: GameMap, a: Point, b: Point): Point | null;
/** (x,y)에서 가장 가까운 발판의 윗면 가운데 지점. */
export function nearestTop(map: GameMap, x: number, y: number): Point;
```

**맵 자료 (32×18 세계, y 아래 양수).** 시작 위치는 발판 윗면에서 0.6m 위.
- 평지 `flat`: box(16, 13, 22, 1). spawns x = 7, 10.6, 14.2, 17.8, 21.4, 25, y = 11.9
- 두 섬 `islands`: box(8, 12, 9, 1), box(24, 12, 9, 1). spawns x = 5.5, 8, 10.5, 21.5, 24, 26.5, y = 10.9
- 계단 `steps`: box(7, 14, 7, 1), box(16, 11, 7, 1), box(25, 8, 7, 1). spawns (5,12.9) (9,12.9) (14,9.9) (18,9.9) (23,6.9) (27,6.9)
- 그릇 `bowl`: box(16, 14, 12, 1), box(7.5, 12.3, 7, 1, angle 0.5), box(24.5, 12.3, 7, 1, angle -0.5). spawns x = 11.5, 13.3, 15.1, 16.9, 18.7, 20.5, y = 12.9
- 기둥 `pillars`: box(x, 13, 2.4, 6) for x = 5, 10.4, 16, 21.6, 27 그리고 box(16, 6, 5, 0.6). spawns (5,9.4) (10.4,9.4) (16,9.4) (21.6,9.4) (27,9.4) (16,5.1)
- 언덕 `hill`: circle(16, 19, 9), box(5, 9, 4, 0.6), box(27, 9, 4, 0.6). spawns (13,10.6) (16,9.4) (19,10.6) (14.5,9.8) (5,8.1) (27,8.1) — 원 위의 위치는 `19 - sqrt(81 - (x-16)^2) - 0.6`로 계산해서 넣는다.

- [ ] **Step 1: 뼈대 만들기.** `git checkout -b feat/game`. `package.json`(name `bonk-arena`, scripts는 suika-game과 동일: dev, build, build:web, preview, test), `tsconfig.json`·`vite.config.ts`·`.env.web`·`src/vite-env.d.ts`는 `../suika-game`의 것을 그대로 복사. `index.html`은 `lang="ko"`, 제목 "통통 대전", `<div id="app"></div>`, `/src/main.ts`(og 태그 없음). `src/main.ts`는 빈 파일로 둔다. `npm install planck peerjs && npm install -D typescript vite vitest`(suika-game과 같은 버전 범위).
- [ ] **Step 2: 실패하는 테스트 작성.** `tests/maps.test.ts`: 맵이 6개이고 id가 서로 다르다 / 모든 맵의 spawns가 6개다 / 모든 시작 위치에서 `surfaceBelow`가 null이 아니고 그 표면까지 거리가 0.5~0.8m다 / 모든 시작 위치가 0<x<32, 0<y<18 안이다 / `spawnSlot(0,1)!==spawnSlot(0,2)`이고 같은 라운드에서 index 0~5가 서로 다른 번호를 받는다 / `nextMap(RANDOM_MAP, 2, r)`을 여러 난수로 돌려도 2가 아니고 0~5 범위다 / `nextMap(3, 3, r)===3`.
  `tests/geometry.test.ts`(평지 맵 기준): `closestAbove(flat, 16, 15, 8)`은 발판 아랫면 (16, 13.5) / `closestAbove(flat, 16, 11, 8)`은 null(위에 발판 없음) / `closestAbove(flat, 16, 25, 8)`은 null(reach 밖) / 회전한 상자와 원에 대해서도 돌려준 지점의 y가 입력 y보다 작다 / `surfaceBelow(flat, 16, 5)===12.5`, `surfaceBelow(flat, 1, 5)===null` / `segmentHit(flat, [16,10], [16,14])`의 y가 12.5(±0.01), 발판을 지나지 않는 선분은 null / `nearestTop(islands, 3, 5)`는 왼쪽 섬 윗면 가운데 (8, 11.5).
- [ ] **Step 3: `npx vitest run`으로 실패 확인.**
- [ ] **Step 4: 구현.** 상자는 회전을 반영한 꼭짓점 4개로 바꿔 다각형과 같이 처리한다. `closestAbove`는 각 변을 y ≤ (입력 y − 0.01)인 부분으로 잘라 그 선분 위의 최근접점을 구한다. 원은 원 위의 최근접점이 조건을 만족하면 그 점, 아니면 y = (입력 y − 0.01)인 수평선과의 교점 가운데 가까운 쪽, 교점이 없으면 후보 없음.
- [ ] **Step 5: `npx vitest run`과 `npx tsc --noEmit` 통과 확인 후 커밋** (`feat: 프로젝트 뼈대와 맵, 도형 계산 추가`).

---

### Task 2: 물리 세계 — 이동, 뛰기, 무거워지기, 경계

**Files:**
- Create: `src/physics/world.ts`
- Test: `tests/world.test.ts`

**Interfaces:**
- Consumes: Task 1의 `TUNING`, `Mode`, `GameMap`, `Shape`.
- Produces:

```ts
export interface Input { left: boolean; right: boolean; up: boolean; down: boolean; special: boolean }
export const NO_INPUT: Input;
export function packInput(input: Input): number;   // 비트 1,2,4,8,16
export function unpackInput(bits: unknown): Input; // 숫자가 아니면 NO_INPUT
export interface BallState { x: number; y: number; vx: number; vy: number; av: number }
export interface BallView {
  id: string; x: number; y: number; angle: number; alive: boolean; heavy: boolean;
  rope: readonly [number, number] | null;
  aim: { dx: number; dy: number; charge: number } | null; // charge는 0~1
}
export type WorldEvent =
  | { type: 'hit'; strength: number }                       // 0~1, 충돌 세기
  | { type: 'out'; id: string; x: number; y: number; cause: 'fall' | 'arrow' }
  | { type: 'jump'; id: string } | { type: 'rope'; id: string } | { type: 'shoot'; id: string } | { type: 'stick' };

export class World {
  constructor(map: GameMap, mode: Mode);
  /** local이 true인 공은 이 브라우저가 탈락·줄·화살을 정한다. false인 공은 받은 상태를 따른다. */
  addBall(id: string, x: number, y: number, local: boolean): void;
  removeBall(id: string): void;
  setLocal(id: string, local: boolean): void;
  has(id: string): boolean;
  setInput(id: string, input: Input): void;
  /** 1/60초를 진행하고 그동안 일어난 일을 돌려준다. */
  step(): WorldEvent[];
  balls(): BallView[];
  state(id: string): BallState | null;
  alive(id: string): boolean;
  /** 받은 소식에 따라 원격 공을 탈락시킨다. 이미 탈락했으면 아무 일도 없다. */
  kill(id: string): void;
}
```

**구현 메모**
- planck: `new World({ gravity: { x: 0, y: TUNING.gravity } })`. 발판은 정적 물체 하나에 fixture 여러 개(마찰 0.3). 공은 `Circle(radius)`, density 1, restitution·friction·linearDamping은 `TUNING`. `bullet`은 쓰지 않는다.
- 힘: `baseMass = π·r²·1`. 좌우·아래 입력마다 `applyForceToCenter(baseMass × accel)`. 무거워져도 힘은 같다.
- 뛰기: `up`이 눌려 있고, 접촉 중인 contact(`isTouching()`)가 하나라도 있고, 마지막으로 뛴 지 `jumpCooldown`이 지났으면 `applyLinearImpulse(0, −baseMass × jumpSpeed)`. 이벤트 `jump`.
- 무거워지기(클래식만): `special` 동안 fixture density를 `heavyMass`로 바꾸고 `resetMassData()`. 원격 공에도 입력대로 적용한다. `BallView.heavy`.
- 화살 모드에서 `special`이 눌려 있는 공은 방향 입력으로 힘을 받지 않고 뛰지도 않는다(원격 공 포함). 줄·화살 자체는 Task 3.
- 경계: local 공의 중심이 `x < −2 || x > 34 || y > 20`이면 탈락. 탈락한 공은 물체를 세계에서 없애고 `alive=false`, `balls()`에는 마지막 위치로 남긴다. 이벤트 `out`(cause `fall`). 원격 공은 경계를 넘어도 스스로 탈락하지 않는다(`kill`로만).
- 충돌 소리: `world.on('post-solve')`에서 공이 낀 접촉의 `normalImpulses[0]`이 `baseMass × 3` 이상이면 `hit`(strength = min(1, impulse / (baseMass × 20))). 한 step에 가장 센 것 하나만.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/world.test.ts`, 평지 맵, 도우미 `run(world, steps)`):
  - `packInput`/`unpackInput` 왕복, `unpackInput('x')`는 `NO_INPUT`.
  - 시작 위치에 놓은 공은 120 step 뒤 발판 위(y ≈ 12.0 ± 0.05)에 멈춰 있다.
  - `right` 입력 60 step 뒤 x가 처음보다 크고 vx > 0.
  - 공중에서는 뛰지 않는다: (16, 5)에 놓고 `up`을 누른 채 5 step → vy > 0.
  - 바닥에서는 뛴다: 멈춘 뒤 `up` → 다음 몇 step 안에 vy < −5, `jump` 이벤트 1번.
  - 클래식에서 `special` + `right` 60 step의 이동 거리가 `right`만 60 step의 0.25~0.45배다. `balls()[0].heavy === true`.
  - 갈고리 모드에서는 `special`을 눌러도 `heavy`가 false다.
  - 무거운 공과 보통 공이 같은 속력으로 마주 부딪치면, 충돌 뒤 보통 공의 속도 변화가 무거운 공보다 크다.
  - local 공을 (33.5, 5)에 놓고 `right`를 누르면 `out` 이벤트(cause `fall`)가 한 번 나오고 `alive(id)===false`, 이후 step에서는 다시 나오지 않는다.
  - 원격 공(local=false)은 경계 밖으로 나가도 `alive`가 true이고, `kill(id)` 뒤에 false다.
  - 화살 모드에서 `special` + `right`는 공을 움직이지 않는다(vx ≈ 0).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: `npx vitest run`, `npx tsc --noEmit` 통과 확인 후 커밋** (`feat: 공의 이동과 무거워지기, 경계 판정 추가`).

---

### Task 3: 물리 세계 — 줄, 화살, 원격 맞추기

**Files:**
- Modify: `src/physics/world.ts`
- Test: `tests/world-special.test.ts`

**Interfaces (Produces, `World`에 추가):**

```ts
/** 화살의 발사 정보. age는 쏜 뒤 지난 시간(초). */
export interface ArrowShot { id: number; x: number; y: number; vx: number; vy: number; age: number }
export interface ArrowView { owner: string; x: number; y: number; angle: number; stuck: boolean }

class World {
  /** 원격 공을 받은 상태에 맞춘다. 차이가 1m 미만이면 속도를 '받은 속도 + 차이×6'으로, 아니면 바로 옮긴다. */
  correct(id: string, state: BallState): void;
  rope(id: string): readonly [number, number] | null;
  /** 원격 공의 줄을 받은 고정점에 건다. null이면 푼다. */
  setRope(id: string, anchor: readonly [number, number] | null): void;
  aim(id: string): { dx: number; dy: number; charge: number } | null;
  /** 원격 공이 겨누는 모습(그리기 전용). */
  setAim(id: string, aim: { dx: number; dy: number; charge: number } | null): void;
  /** owner가 쏜 화살 가운데 아직 남아 있는 것의 발사 정보. */
  shots(owner: string): ArrowShot[];
  /** 원격 주인의 화살을 받은 목록에 맞춘다. 모르는 번호는 만들고(age만큼 미리 진행), 목록에 없는 것은 없앤다. */
  syncShots(owner: string, shots: readonly ArrowShot[]): void;
  arrows(): ArrowView[];
}
```

**구현 메모**
- **줄(갈고리 모드, local 공)**: `special`이 눌리는 순간(이전 step에는 안 눌림) `closestAbove(map, x, y, ropeReach)`로 지점을 찾는다. 있으면 발판 물체와 공 사이에 `RopeJoint`(maxLength = 그 순간의 거리, 공 쪽 anchor는 중심)를 만들고 이벤트 `rope`. `special`을 떼면 joint를 없앤다. 원격 공은 `special` 입력으로 줄을 걸지 않고 `setRope`만 따른다(같은 고정점이면 다시 만들지 않는다).
- **화살은 planck 물체가 아니다.** 발사 정보에서 직접 적분한다: 매 step `vy += gravity·dt`, 위치 이동, 이전 위치→새 위치 선분에 대해 `segmentHit`으로 발판 충돌을 검사한다. 닿으면 그 지점에 꽂히고(`stuck`, 이벤트 `stick`) `arrowStuckLife` 뒤 사라진다. 쏜 지 `arrowLife`가 지나도 사라진다.
- **명중**: 날아가는(꽂히지 않은) 화살의 이동 선분과 **local** 공(주인 제외, 생존)의 중심 사이 거리가 `radius + arrowRadius` 이하이면 그 공이 탈락(`out`, cause `arrow`)하고 화살은 사라진다. 원격 공은 화살에 맞아도 아무 일도 없다(주인이 알려 준다).
- **쏘기(화살 모드, local 공)**: `special`을 누르고 있는 시간을 잰다(재사용 대기 중이면 0에서 멈춤). 떼는 순간 누른 시간이 `arrowMinCharge` 이상이면 발사. 속력 = min~max 사이를 (시간−0.2)/(1−0.2)로 선형 보간(1초 이상은 최대). 방향 = 누르고 있는 방향키로 만든 8방향 단위 벡터, 아무것도 없으면 마지막 좌우 방향(처음엔 오른쪽). 발사 위치 = 공 중심 + 방향 × (radius + 0.2). 화살 번호는 주인별 1부터 증가. 이벤트 `shoot`. 0.2초 미만이면 취소. 발사 뒤 `arrowCooldown` 동안 모으지 못한다. `aim(id)`는 모으는 동안 방향과 charge(0~1)를 돌려준다.
- `syncShots`의 미리 진행: age를 `step` 단위로 나눠 같은 적분을 돌린다(명중 판정 포함, 최대 `arrowLife`까지).
- `correct`: 탈락했거나 local인 공에는 아무 일도 하지 않는다. 회전 속도는 받은 값으로 둔다.
- `removeBall`·탈락 시 그 공의 줄을 없앤다(화살은 남긴다).

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/world-special.test.ts`):
  - 줄: 기둥 맵에서 가운데 위 발판(16, 6) 아래쪽 (16, 8.5)에 공을 두고 `special` → `rope(id)`가 (16, 6.3) 근처, `rope` 이벤트 1번. 120 step 동안 공과 고정점 사이 거리가 처음 거리 + 0.05를 넘지 않는다(발판이 없으면 떨어질 위치인데도). `special`을 떼면 `rope(id)===null`이고 공이 떨어진다(y 증가).
  - 줄: 위에 발판이 없는 곳(평지 맵 (16, 5))에서는 걸리지 않는다. 클래식 모드에서는 걸리지 않는다.
  - 원격 공: `special` 입력만으로는 줄이 걸리지 않고, `setRope(id, [16, 6.3])` 뒤에 `rope(id)`가 그 값이며 거리가 제한된다. `setRope(id, null)`로 풀린다.
  - 화살: 평지에서 `special`을 30 step(0.5초) 누르고 떼면 `shoot` 이벤트, `arrows().length===1`, `shots(id)[0]`의 속력이 12 + 18×(0.3/0.8) ≈ 18.75(±0.5).
  - 화살: 6 step(0.1초)만 누르고 떼면 쏘지 않는다. 90 step 눌러도 속력은 30을 넘지 않는다.
  - 화살: `special`+`up`으로 쏘면 vy < 0, vx ≈ 0. `left`를 누른 적이 있으면 방향키 없이 쏠 때 vx < 0.
  - 화살: 쏜 직후 다시 30 step 누르고 떼어도 두 번째는 나가지 않는다(대기 1초). 70 step 뒤에는 나간다.
  - 명중: A(local)가 오른쪽으로 쏘고 3m 옆에 B(local)가 있으면 몇 step 안에 `out`(id B, cause `arrow`)이 나오고 화살이 사라진다. A 자신은 탈락하지 않는다.
  - 명중: B가 원격(local=false)이면 탈락하지 않는다.
  - 꽂힘: 아래로 쏜 화살은 `stuck`이 되고, B가 그 위를 지나가도 탈락하지 않으며, 3초(180 step) 뒤 `arrows()`에서 사라진다.
  - `syncShots('r', [{id:1,x:5,y:5,vx:10,vy:0,age:0.5}])` 뒤 화살의 x가 10 근처(±0.3)이고, 같은 목록을 다시 넣어도 화살이 하나다. 빈 목록을 넣으면 사라진다.
  - `correct`: 원격 공을 (10,5)에 두고 `correct(id, {x:10.5,y:5,vx:0,vy:0,av:0})` → `state(id).vx ≈ 3`. `correct(id, {x:20,y:5,...})` → 바로 x=20. local 공에는 효과가 없다.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 전체 테스트와 `tsc` 통과 확인 후 커밋** (`feat: 줄 걸기와 화살, 원격 공 맞추기 추가`).

---

### Task 4: 경기 진행과 AI

**Files:**
- Create: `src/game/round.ts`, `src/game/bot.ts`
- Test: `tests/round.test.ts`, `tests/bot.test.ts`

**Interfaces:**
- Consumes: `Mode`, `TUNING`, `nextMap`, `GameMap`, `Input`, `NO_INPUT`, `surfaceBelow`, `nearestTop`.
- Produces:

```ts
// src/game/round.ts
export type Phase = 'lobby' | 'countdown' | 'play' | 'roundEnd' | 'matchEnd';
export interface Settings { mode: Mode; target: number; mapSetting: number; bots: number }
export const DEFAULT_SETTINGS: Settings; // classic, 5, RANDOM_MAP, 1
export interface Match {
  settings: Settings;
  /** 경기를 시작할 때마다 1씩 오른다. */
  game: number;
  phase: Phase;
  /** 이 단계가 시작된 뒤 지난 시간(밀리초). */
  ms: number;
  round: number;
  map: number;
  scores: Record<string, number>;
  /** 이번 라운드에 참가한 사람과 AI의 id. 순서가 시작 위치를 정한다. */
  roster: string[];
  /** roundEnd에서는 라운드 승자(무승부면 null), matchEnd에서는 우승자. */
  winner: string | null;
}
export function lobbyMatch(settings: Settings, game?: number): Match;
/** 대기실에서 경기를 시작한다. ids는 참가할 사람과 AI. */
export function startMatch(match: Match, ids: readonly string[], random: () => number): Match;
/** dtMs만큼 진행한다. alive는 지금 생존한 id, present는 다음 라운드에 참가할 id. */
export function advance(match: Match, dtMs: number, alive: readonly string[], present: readonly string[], random: () => number): Match;
/** 방장이 최종 결과에서 대기실로 돌아간다. */
export function toLobby(match: Match): Match;
export function botIds(count: number): string[]; // ['bot1', ...]
export function isBot(id: string): boolean;

// src/game/bot.ts
export interface BotSense {
  map: GameMap; mode: Mode;
  me: { x: number; y: number; vx: number; vy: number };
  others: readonly { x: number; y: number }[]; // 생존한 다른 공
  roped: boolean; charge: number; // 지금 모은 시간 비율 0~1
}
/** 0.15초마다 한 번만 입력을 바꾸는 AI. */
export class Bot {
  think(sense: BotSense, dt: number): Input;
}
/** 지금 상황에서 고를 입력(시간 제한 없이). */
export function decide(sense: BotSense, held: Input): Input;
```

**`advance` 규칙**
- `lobby`, `matchEnd`: ms만 더한다.
- `countdown`: ms ≥ 3000 → `play`(ms 0).
- `play`: roster 안의 생존자가 1명 이하이면 `roundEnd`(winner = 그 한 명 또는 null, 승자 점수 +1). ms ≥ 90000이면 `roundEnd`(winner null).
- `roundEnd`: ms ≥ 2000 → 점수가 target 이상인 사람이 있으면 `matchEnd`(winner = 그 사람), 없으면 다음 라운드: `round+1`, `map = nextMap(mapSetting, map, random)`, `roster = present`(scores에 없는 id는 0으로 추가), `countdown`.
- `startMatch`: `game+1`, `round=1`, `map = nextMap(mapSetting, -1, random)`, scores는 ids 모두 0, `countdown`. ids가 2명 미만이면 match를 그대로 돌려준다.
- 모든 함수는 입력 객체를 바꾸지 않고 새 객체를 돌려준다.

**`decide` 규칙 (순서대로)**
1. `surfaceBelow(map, me.x, me.y)`가 null이거나, 진행 방향으로 1m 앞(`me.x + sign(vx)`)의 `surfaceBelow`가 null이면 `nearestTop` 쪽 좌우 입력. 아래에 발판이 없고 vy > 0이면 `up`도 누르고, 갈고리 모드면 `special`도 누른다.
2. 그 밖에는 가장 가까운 `others` 쪽 좌우 입력(없으면 `NO_INPUT`). 상대가 1.5m 이상 높이 있으면 `up`.
3. 클래식: 가장 가까운 상대와의 거리가 1.6m 미만이면 `special`.
4. 화살: 가장 가까운 상대가 12m 안이면 `special`을 누르고 상대 방향의 좌우(높이 차가 2m 이상이면 상하도) 입력. `charge ≥ 0.5`이면 `special`을 뗀다(다음 결정에서 발사).

- [ ] **Step 1: 실패하는 테스트 작성.**
  `tests/round.test.ts`: `startMatch` 뒤 phase `countdown`, round 1, game 1, scores 모두 0 / 한 명으로는 시작되지 않는다 / 2999ms에는 `countdown`, 3000ms에 `play` / `play`에서 alive가 `['a']`이면 `roundEnd`, winner `a`, `scores.a===1` / alive가 `[]`이면 winner null, 점수 변화 없음 / roster에 없는 id가 alive에 있어도 세지 않는다 / 90000ms가 지나면 무승부 / `roundEnd` 2000ms 뒤 round 2, `countdown`, 맵이 무작위 설정이면 이전과 다름 / present에 새 id가 있으면 roster와 scores에 들어간다 / target 3에서 a가 3점이 되면 `matchEnd`, winner `a` / `toLobby` 뒤 phase `lobby`, settings 유지, game 유지 / 원본 객체가 바뀌지 않는다(`Object.freeze`한 입력으로 호출) / `botIds(2)`와 `isBot`.
  `tests/bot.test.ts`(평지 맵): 발판 왼쪽 끝 바깥 (3, 11)에서 `right`를 누른다 / 발판 위에서 상대가 오른쪽에 있으면 `right` / 클래식에서 상대가 1m 옆이면 `special` / 갈고리에서 발판 밖 허공에 떨어지는 중이면 `special` / 화살에서 상대가 8m 옆이고 charge 0이면 `special`, charge 0.6이면 `special`이 false / `Bot.think`를 dt 0.05로 두 번 불렀을 때 상황이 바뀌어도 입력이 그대로이고, 누적 0.15초가 지나면 바뀐다.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 전체 테스트와 `tsc` 통과 확인 후 커밋** (`feat: 경기 진행과 AI 추가`).

---

### Task 5: 통신 계층 — 복사, 메모리 방, presence 형식, 대기실 규칙

**Files:**
- Create: `src/net/types.ts`, `src/net/connect.ts`, `src/net/p2p-room.ts`, `src/net/peer-key.ts`(이상 `../suika-game/src/net/`에서 복사), `src/net/local-room.ts`, `src/net/wire.ts`, `src/game/lobby.ts`
- Test: `tests/p2p-room.test.ts`(복사), `tests/local-room.test.ts`, `tests/wire.test.ts`, `tests/lobby.test.ts`

**복사할 때 바꾸는 것:** `hostIdFor`의 접두어 `suika-game-` → `bonk-arena-`(테스트의 기대값도), `connect.ts`의 `CLAUDE_GAME_URL`은 빈 문자열(배포 뒤에 채운다는 주석), `peer-key.ts`의 저장 키가 있으면 `bonk-arena` 접두어로. 그 밖의 내용은 그대로 둔다.

**Interfaces (Produces):**

```ts
// src/net/local-room.ts
/** 나만 들어 있는 방. 연습하기에서 같이 하기와 같은 경로를 쓰기 위한 것입니다. */
export function createLocalRoom(now?: () => number): NamedRoomLike;
// peers()는 [{ peer: 'me', sameTab: true, kind: 'user', presence, updatedAt }]. presence(patch)는 합쳐서 저장하고 onPeers 핸들러를 부른다.

// src/game/lobby.ts
export const MAX_PLAYERS = 6;
export const NAME_LIMIT = 12;
export const COLORS: readonly { name: string; fill: string; edge: string }[]; // 파랑 #3b82f6, 주황 #f97316, 초록 #22c55e, 보라 #8b5cf6, 노랑 #eab308, 청록 #06b6d4 (edge는 더 어두운 색)
export function makeRoomCode(rand: () => number): string;     // suika-game과 같은 5글자
export function parseRoomCode(text: string): string | null;
export function roomName(code: string): string;               // `ba-${code}`
export function cleanName(value: unknown, fallback?: string): string;
export interface Seat { peer: string; since: number; color: number; hosting: boolean }
/** 방에 들어온 순서(since, 같으면 peer 사전순). */
export function seatOrder<T extends { peer: string; since: number }>(list: readonly T[]): T[];
/** 방장: host 정보를 올리고 있는 사람 가운데 순서가 가장 앞인 사람. 아무도 올리지 않으면 전체에서 가장 앞인 사람. */
export function pickHost(seats: readonly Seat[]): string | null;
/** 순서가 앞선 사람과 색이 겹치면 아무도 쓰지 않는 가장 앞 번호의 색을 돌려준다. 겹치지 않으면 원래 색. */
export function resolveColor(seats: readonly Seat[], me: string): number;
/** AI n번째(0부터)가 쓸 색: 사람이 쓰지 않는 색을 앞에서부터. */
export function botColors(humanColors: readonly number[], count: number): number[];

// src/net/wire.ts
export const MAX_SHOTS = 8;
export interface BallWire {
  b: BallState; i: number; a: boolean;
  rp: readonly [number, number] | null;
  am: readonly [number, number, number] | null; // dx, dy, charge
  ar: ArrowShot[];
}
export interface HostWire extends Match { bs: Record<string, BallWire> } // AI들의 공
export interface PeerState {
  peer: string; me: boolean;
  name: string; color: number; ready: boolean; since: number;
  /** 공 상태가 속한 라운드 열쇠(game×1000+round). 경기 중이 아니면 0. */
  key: number;
  /** 보낼 때마다 오르는 번호. */
  n: number;
  ball: BallWire | null;
  host: HostWire | null;
}
export function roundKey(game: number, round: number): number;
export function encodeBall(ball: BallWire): Record<string, unknown>;   // 숫자는 소수 둘째 자리로 반올림
export function decodeBall(value: unknown): BallWire | null;
export function encodeHost(host: HostWire): Record<string, unknown>;
export function decodeHost(value: unknown): HostWire | null;
/** presence를 읽는다. 잘못된 값은 기본값(이름 '플레이어', 색 0, ready false, since 0, key 0, ball null, host null)으로 바꾼다. */
export function readPeer(peer: string, me: boolean, presence: Readonly<Record<string, unknown>>): PeerState;
```

presence의 키: `name, color, ready, since, key, n, ball, host`. `decodeHost`는 phase가 다섯 값 가운데 하나가 아니거나 settings가 없으면 null. 점수는 0~99 정수, roster는 문자열 12개까지, `bs`는 5개까지, target은 `TARGETS`에 없으면 5, bots는 0~5, mapSetting은 −1~5, map은 0~5로 고정한다. 좌표·속도는 유한한 숫자가 아니면 그 공 전체를 null로 본다. 좌표는 ±1000, 속도는 ±200으로 자른다.

- [ ] **Step 1: 복사와 이름 바꾸기**, 복사한 `tests/p2p-room.test.ts`가 통과하는지 확인.
- [ ] **Step 2: 실패하는 테스트 작성.**
  `tests/local-room.test.ts`: peers가 한 명이고 `sameTab`이다 / `presence({a:1})` 뒤 `presence({b:2})`이면 둘 다 들어 있다 / `onPeers` 핸들러가 불리고, 돌려받은 함수로 해제된다 / `leave()`가 오류 없이 끝난다.
  `tests/lobby.test.ts`: 방 코드 만들기와 `parseRoomCode('https://x/#abcde')` / `cleanName`이 제어 문자를 지우고 12자로 자른다 / `seatOrder`가 since, peer 순이다 / `pickHost`: 아무도 hosting이 아니면 가장 앞사람, 뒤에 온 사람만 hosting이면 그 사람, 둘이 hosting이면 앞사람, 빈 목록이면 null / `resolveColor`: 겹치지 않으면 그대로, 앞사람과 겹치면 빈 색 가운데 가장 앞 번호, 뒷사람과 겹치면 그대로 / `botColors([0,2], 3)`은 `[1,3,4]`.
  `tests/wire.test.ts`: `encodeBall`→JSON 왕복→`decodeBall`이 같은 값(소수 둘째 자리) / `encodeHost` 왕복 / `readPeer('p', false, {})`가 기본값 / name이 숫자, color가 99 또는 'x', since가 NaN이어도 기본값 / ball의 x가 `'1'`·`NaN`·`Infinity`이면 ball이 null / 화살 5000개가 와도 8개만 남는다 / 화살 항목이 배열이 아니거나 숫자가 아니면 그 항목만 버린다 / host의 phase가 `'x'`이면 host가 null / scores에 음수·문자열이 있으면 0 / roster가 100개면 12개.
- [ ] **Step 3: 실패 확인.**
- [ ] **Step 4: 구현.**
- [ ] **Step 5: 전체 테스트와 `tsc` 통과 확인 후 커밋** (`feat: 통신 계층과 presence 형식, 대기실 규칙 추가`).

---

### Task 6: Session — 한 경기 실행

**Files:**
- Create: `src/session.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `World`, `Input`, `WorldEvent`, `Match`, `Settings`, `startMatch`, `advance`, `toLobby`, `lobbyMatch`, `botIds`, `isBot`, `Bot`, `MAPS`, `spawnSlot`, `PeerState`, `HostWire`, `BallWire`, `roundKey`.
- Produces:

```ts
/** 상대 공의 받은 위치를 이만큼 앞으로 옮겨서 맞춥니다(초). 통신 지연의 어림값입니다. */
export const NET_LEAD = 0.1;
/** 한 프레임의 경과 시간이 이보다 길면 밀린 시간을 계산하지 않습니다(밀리초). */
export const MAX_FRAME_MS = 500;

export interface Frame {
  /** 내가 방장인지 여부. */
  hosting: boolean;
  /** 방장이 올린 경기 상태(내가 방장이면 무시한다). */
  host: HostWire | null;
  /** 방에 있는 다른 사람들. */
  peers: readonly PeerState[];
}
export interface SessionView {
  match: Match;
  map: GameMap | null;          // 대기실이면 null
  balls: BallView[];
  arrows: ArrowView[];
  /** 내가 이번 라운드에 참가하지 않고 구경 중인지 여부. */
  watching: boolean;
  me: string;
}
export class Session {
  constructor(me: string, random?: () => number);
  readonly match: Match;                    // 지금 따르고 있는 경기 상태
  /** 방장: 설정을 바꾼다(대기실에서만). */
  setSettings(patch: Partial<Settings>): void;
  /** 방장: 경기를 시작한다. humans는 참가할 사람의 id(나 포함, 자리 순서). */
  start(humans: readonly string[]): void;
  /** 방장: 최종 결과에서 대기실로 돌아간다. */
  backToLobby(): void;
  /** 매 프레임. 세계를 진행하고 그동안의 일을 돌려준다. */
  update(dtMs: number, input: Input, frame: Frame): WorldEvent[];
  /** 내가 올릴 공 상태. 참가 중이 아니면 key 0, ball null. */
  mine(): { key: number; ball: BallWire | null };
  /** 방장일 때 올릴 경기 상태(AI 공 포함). */
  hostWire(): HostWire;
  view(): SessionView;
}
```

**동작**
- **방장일 때(`frame.hosting`)**: `match`를 `advance`로 진행한다. alive 목록 = roster 가운데 (나: 내 세계에서 생존) + (AI: 내 세계에서 생존) + (다른 사람: `frame.peers`에 있고, `key`가 지금 라운드 열쇠와 다르거나 `ball.a`가 true). present 목록 = `[나, ...peers의 peer(자리 순서 그대로), ...botIds(n)]`, 여기서 n = min(settings.bots, 6 − 사람 수), 전체 6명까지.
- **방장이 아닐 때**: `frame.host`가 있으면 `match`를 그것으로 바꾼다(없으면 유지).
- **방장이 된 순간**(직전 프레임에는 아니었음): 가지고 있던 `match`를 그대로 이어서 진행한다. 세계 안의 AI 공을 `setLocal(id, true)`로 바꾸고 `Bot`을 만든다. 방장이 아니게 되면 반대로 한다.
- **세계 만들기**: `roundKey(match.game, match.round)`가 지금 세계의 열쇠와 다르고 phase가 `lobby`가 아니면 `new World(MAPS[match.map], match.settings.mode)`를 만들고 roster의 i번째를 `spawns[spawnSlot(i, match.round)]`에 놓는다. 나와 (방장일 때의) AI는 local. phase가 `lobby`이면 세계를 버린다.
- **진행**: phase가 `play`, `roundEnd`, `matchEnd`일 때만 고정 간격(1/60초)으로 step한다(누적 시간 방식, 한 프레임 최대 10 step). `countdown`에서는 step하지 않고 누적 시간도 0으로 둔다. 내 입력은 `play`일 때만 적용하고 그 밖에는 `NO_INPUT`. `dtMs > MAX_FRAME_MS`이면 그 프레임은 0으로 본다(방장의 `advance`에도 0).
- **원격 적용**(매 프레임, step 전에): peers 가운데 `key`가 지금 열쇠와 같고 `ball`이 있는 사람에 대해
  - `ball.a === false`이면 `kill`.
  - `n`이 지난번에 본 값과 다르면: `setInput(unpackInput(ball.i))`, `correct(위치 + 속도×NET_LEAD)`, `setRope(ball.rp)`, `setAim`, `syncShots(peer, ball.ar)`.
  - roster에 있는데 `frame.peers`에 없는 사람(AI와 나 제외)은 `kill`.
  - 방장이 아니면 `match.bs`(HostWire)의 AI 공에도 같은 처리를 한다(새 소식 여부는 방장의 `n`으로 판단).
- **AI(방장)**: step마다 생존한 AI에 대해 `Bot.think`로 입력을 정해 `setInput`.
- `mine()`: 내가 roster에 있고 세계가 있으면 `{ key, ball: { b: state, i: packInput(지금 입력), a: alive, rp: rope, am: aim, ar: shots(me) } }`. 탈락한 뒤에도 `a:false`로 계속 올린다.
- `hostWire()`: `{ ...match, bs: AI마다 같은 형식 }`.
- 돌려주는 이벤트 가운데 `out`은 local 공뿐 아니라 `kill`로 탈락시킨 원격 공에 대해서도 한 번 만들어 준다(효과·소리용, cause `fall`).

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/session.test.ts`; 도우미 `solo()` = 방장이고 peers가 빈 Frame, `tick(session, ms, input, frame)` = 16ms씩 나눠 update):
  - 연습: `setSettings({bots:1}); start(['me'])` → phase `countdown`, roster `['me','bot1']`, `view().balls.length===2`.
  - 카운트다운 2.9초 동안 `right`를 눌러도 내 공의 x가 그대로다(Review Focus 5). 3초 뒤 `play`가 되고 그때부터 움직인다.
  - AI가 움직인다: `play` 2초 뒤 bot1의 x 또는 vx가 처음과 다르다.
  - 내가 왼쪽으로 계속 가서 떨어지면 `out` 이벤트, `roundEnd`, `scores.bot1===1`, 2초 뒤 round 2와 새 세계(내 공이 다시 생존, 시작 위치).
  - 화살 모드에서 `special`을 누른 채 라운드가 끝나고 다음 라운드가 시작되면 `view()`의 내 공 `aim`이 null이고 화살이 없다(Review Focus 5).
  - `update(5000, …)` 한 번으로는 phase가 넘어가지 않고 공도 움직이지 않는다(Review Focus 2).
  - 참가자 쪽: `hosting:false`, `host` = 방장 세션의 `hostWire()`(JSON 왕복), peers = [방장의 PeerState] → 같은 맵·같은 roster로 세계가 만들어지고, 방장의 공이 받은 상태를 따라간다(방장 공을 2초 움직인 뒤 참가자 화면의 그 공 x 차이 < 1.5).
  - 참가자 쪽: 방장의 `ball.a=false`를 받으면 그 공이 탈락하고 `out` 이벤트가 한 번 나온다.
  - 참가자 쪽: roster에 있는 사람이 peers에서 사라지면 탈락 처리된다.
  - 방장 쪽: 다른 사람이 `a:false`를 올리면 alive에서 빠져 `roundEnd`가 된다. 그 사람의 `key`가 아직 이전 라운드이면 생존으로 본다.
  - 방장 이탈(Review Focus 3): 참가자 세션이 `host`를 몇 프레임 받은 뒤 `hosting:true, host:null, peers:[]`로 바뀌면, scores·round·game이 유지되고, AI 공이 계속 움직이며, `hostWire().bs`에 AI가 들어 있다.
  - 대전 중에 들어온 사람: 방장의 present에 새 peer가 있으면 다음 라운드 roster에 들어가고, 그 사람의 세션은 그 전까지 `watching===true`다.
  - `mine()`: 경기 전에는 `{key:0, ball:null}`, 경기 중에는 key가 `roundKey(1,1)`, 탈락 뒤에는 `ball.a===false`.
  - 사람 5명 + bots 설정 3이면 roster는 6명(AI 1명)이다.
  - `backToLobby()` 뒤 phase `lobby`, `view().map===null`.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 전체 테스트와 `tsc` 통과 확인 후 커밋** (`feat: 한 경기를 실행하는 Session 추가`).

---

### Task 7: Multiplayer — 방, 대기실, 방장 선출, 송수신

**Files:**
- Create: `src/multiplayer.ts`
- Test: `tests/multiplayer.test.ts`

**Interfaces:**
- Consumes: `LobbyLike`, `NamedRoomLike`, `createLocalRoom`, `readPeer`, `encodeBall`, `encodeHost`, `PeerState`, `Session`, `Frame`, lobby 도우미 전부, `Settings`.
- Produces:

```ts
export const SEND_INTERVAL = 60;   // 밀리초
export const SETTLE_MS = 2000;     // 방에 들어온 직후 방장 권한을 쓰지 않는 시간
export type Stage = 'idle' | 'joining' | 'lobby' | 'game';
export interface LobbyRow { id: string; name: string; color: number; host: boolean; ready: boolean; me: boolean; bot: boolean }
export interface LobbyView {
  practice: boolean; code: string; invite: string;
  rows: LobbyRow[]; isHost: boolean; ready: boolean; canStart: boolean; settled: boolean;
  settings: Settings; myColor: number;
  /** 다른 사람이 쓰고 있어서 고를 수 없는 색 번호. */
  takenColors: number[];
  /** AI를 더 넣을 수 있는 최대 수(6 − 사람 수). */
  maxBots: number;
}
export interface PlayerInfo { id: string; name: string; color: number; me: boolean; bot: boolean }
export class Multiplayer {
  stage: Stage; error: string | null; code: string;
  readonly session: Session | null;
  constructor(lobby: LobbyLike | null, inviteBase: string, hooks: { onStage(stage: Stage): void }, now?: () => number, random?: () => number);
  create(name: string, color: number): Promise<void>;
  join(text: string, name: string, color: number): Promise<void>;
  /** 연습하기: 나만 있는 방에 들어간다. 통신이 없어도 된다. */
  practice(name: string, color: number): void;
  leave(message?: string | null): void;
  toggleReady(): void;
  setColor(color: number): void;
  setSettings(patch: Partial<Settings>): void;   // 방장만
  start(): void;                                  // 방장만
  backToLobby(): void;                            // 방장만
  /** 매 프레임. 방을 읽고, Session을 진행하고, 내 상태를 보낸다. */
  update(dtMs: number, input: Input): WorldEvent[];
  lobbyView(): LobbyView | null;
  /** 점수표와 이름표에 쓸 참가자 정보(사람과 AI). */
  players(): PlayerInfo[];
  isHost(): boolean;
}
```

**동작**
- `enter` 흐름·오류 문구는 `suika-game/src/multiplayer.ts`의 `create/join/enter/leave`를 따른다(문구는 합니다체: '방 코드를 다시 확인하십시오.' 대신 '방 코드가 올바르지 않습니다.', '방에 들어가지 못했습니다. 잠시 후 다시 시도할 수 있습니다.', '이 환경에서는 같이 하기를 사용할 수 없습니다.', '방을 찾을 수 없습니다.', '방이 가득 찼습니다.').
- 방에 들어가면 `Session`을 만들고(id는 내 peer 값, 알기 전에는 임시로 'me'였다가 peers에서 `sameTab`인 항목으로 확정 — Session을 그때 만든다) presence에 `name, color, ready:false, since, key:0, n:0, ball:null, host:null`을 올린다.
- 읽기: `room.peers()`에서 `kind === 'agent'`는 뺀다. `readPeer`로 바꾸고 `seatOrder`로 정렬, 앞에서 6명만 사람으로 본다.
- **방장 선출**: `pickHost(seats)`(hosting = `host !== null`). 내가 뽑혔고 settle이 지났으면(연습 방은 즉시) 방장으로 행동하고 `host`를 올린다. 내가 뽑히지 않았으면 `host: null`을 올린다. 방을 직접 만든 사람은 settle을 기다리지 않는다.
- **단계**: 방장의 `match.phase`가 `lobby`이면 `lobby`, 아니면 `game`. 방장을 아직 모르면 `lobby`.
- **들어온 직후 확인**(settle 뒤 한 번): 방을 만들지 않았는데 나 혼자면 '방을 찾을 수 없습니다.'로 나간다. 내 자리가 7번째 이후이면 '방이 가득 찼습니다.'로 나간다(Review Focus 4).
- **색**: 매 프레임 `resolveColor`로 확인해서 달라지면 내 색을 바꿔 올린다(Review Focus 4). `setColor`는 `takenColors`에 있으면 무시한다.
- **설정**: 방장만. `bots`는 0~`maxBots`로 자른다. 사람이 늘어 `maxBots`가 줄면 방장이 `bots`를 줄인다. 연습 방에서는 `bots`가 최소 1이다.
- **시작**: 방장이고, settle이 지났고, 방장을 뺀 모든 사람이 ready이고, 사람 수 + bots ≥ 2일 때 `session.start(사람 id들)`.
- **송신**: `SEND_INTERVAL`마다(또는 내 `alive`가 바뀐 즉시) `presence({ key, n: ++n, ball: encodeBall(...)|null, host: 방장이면 encodeHost(session.hostWire()) 아니면 null })`. 대기실에서는 값이 바뀌었을 때만 보낸다(방장의 설정 변경, ready, 색).
- `update`: Frame을 만들어 `session.update`를 부르고 이벤트를 돌려준다. `stage`가 바뀌면 `hooks.onStage`.
- `players()`: 사람은 presence의 이름·색, AI는 이름 `AI 1`…, 색은 `botColors`.
- 경기가 대기실로 돌아오면 내 `ready`를 false로 되돌린다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/multiplayer.test.ts`). 테스트용 `FakeLobby`를 만든다: `join(name)`이 같은 이름의 방을 공유하는 `NamedRoomLike`를 돌려주고, 각 참가자의 presence를 메모리에 모아 `peers()`로 보여 주며(`sameTab`은 본인만 true), `leave()`하면 사라진다. 시계는 주입한 `now`를 쓴다.
  - `practice` 직후 stage `lobby`, `lobbyView().practice===true`, rows에 나와 AI 1명, `canStart===true`. `start()` 뒤 `update`를 돌리면 stage `game`.
  - 연습에서 `setSettings({bots:0})`은 1로 고정된다. `setSettings({mode:'arrows'})`가 반영된다.
  - 방 만들기 → 다른 사람이 들어오기 → 두 쪽 `lobbyView().rows.length===2`, 만든 사람이 host, 들어온 사람은 `isHost===false`.
  - 들어온 사람이 ready 하기 전에는 `canStart===false`, ready 뒤 true. `start()` 뒤 양쪽 stage가 `game`이 되고 양쪽 `session.match.round===1`.
  - 방장이 아닌 사람의 `setSettings`·`start`는 아무 일도 하지 않는다.
  - 없는 방 코드로 들어가면 settle 뒤 stage `idle`, error '방을 찾을 수 없습니다.'.
  - 잘못된 코드 문자열은 바로 error '방 코드가 올바르지 않습니다.'.
  - 같은 색 두 사람: 늦게 온 사람의 `myColor`가 다른 색으로 바뀌고, `takenColors`에 상대 색이 들어 있다.
  - 사람 6명이 있는 방에 일곱 번째가 들어오면 settle 뒤 '방이 가득 찼습니다.'로 나간다.
  - bots 3인 방에 사람이 5명이 되면 방장의 `settings.bots`가 1이 된다.
  - 경기 중 방장이 `leave()`하면 남은 사람이 `isHost()===true`가 되고 stage가 `game`으로 유지되며 점수가 유지된다.
  - 경기 중에 새 사람이 들어오면 그 사람의 stage가 `game`이고 `session.view().watching===true`다.
  - 방장이 `backToLobby()`하면 모두 stage `lobby`, ready가 false다.
  - `lobby`가 null이면 `create`는 error '이 환경에서는 같이 하기를 사용할 수 없습니다.', `practice`는 동작한다.
  - 송신: 경기 중 60ms보다 짧은 간격으로는 presence를 다시 보내지 않는다(방의 presence 호출 횟수로 확인).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 전체 테스트와 `tsc` 통과 확인 후 커밋** (`feat: 방과 대기실, 방장 선출을 맡는 Multiplayer 추가`).

---

### Task 8: 화면 — 입력, 그리기, 메뉴, 소리, 저장, 조립

**Files:**
- Create: `src/input.ts`, `src/storage.ts`, `src/audio.ts`, `src/sounds/*.mp3`, `src/render/scene.ts`, `src/render/effects.ts`, `src/ui/menus.ts`, `src/style.css`
- Modify: `src/main.ts`, `src/vite-env.d.ts`(`*.mp3?inline` 선언)
- Test: `tests/storage.test.ts`, `tests/scene-layout.test.ts`

**Interfaces (Produces):**

```ts
// src/storage.ts
export const PROFILE_KEY = 'bonk-arena.profile.v1';
export interface Profile { name: string; color: number }
export function loadProfile(store: Store | null): Profile;   // 깨진 값이면 { name: '', color: 0 }
export function saveProfile(store: Store | null, profile: Profile): void;

// src/input.ts
/** 키보드(방향키, WASD, X/스페이스)와 터치 버튼의 입력을 읽습니다. */
export function attachInput(root: HTMLElement): { read(): Input; setTouchVisible(show: boolean): void };

// src/render/scene.ts
export interface ViewBox { scale: number; offsetX: number; offsetY: number } // 화면 px = 세계 m × scale + offset
/** 창 크기에 16:9로 맞춘다. */
export function fitView(width: number, height: number): ViewBox;
export function drawScene(ctx: CanvasRenderingContext2D, s: {
  width: number; height: number; view: SessionView | null; players: PlayerInfo[]; effects: Effects; time: number;
}): void;

// src/audio.ts
export function createAudio(): { unlock(): void; toggle(): boolean; muted: boolean; play(name: SoundName, volume?: number): void };
export type SoundName = 'hit' | 'out' | 'shoot' | 'stick' | 'rope' | 'jump' | 'tick' | 'go' | 'win' | 'click';
```

**구현 메모**
- **소리**: Kenney `impact-sounds`와 `interface-sounds`(CC0)를 scratch 폴더에 내려받는다. 내려받는 주소는 `https://kenney.nl/assets/impact-sounds` 페이지 HTML 안의 `media/pages/assets/...zip` 링크에서 얻는다(`curl -sL`). 소리 10개를 골라 `ffmpeg -i x.ogg -ac 1 -b:a 48k x.mp3`로 바꿔 `src/sounds/`에 둔다(파일 하나 20KB 이하). `import url from './sounds/hit.mp3?inline'`으로 불러와 `fetch(url)`→`decodeAudioData`로 재생한다. 내려받을 수 없으면 Web Audio로 짧은 소리를 합성하고 그 사실을 보고한다. 충돌 소리는 strength로 음량을 정하고 50ms 안에 다시 내지 않는다.
- **그리기**: 배경 `#1e2433`, 발판 `#55627a`(윗변 강조선 `#7f8ea8`), 경계 밖은 더 어두운 색. 공은 `COLORS[color].fill`, 테두리 `edge`(보통 2px, 무거우면 5px와 안쪽 원), 회전을 보여 주는 반지름 선, 공 위에 이름(내 공은 흰색 굵게, 작은 삼각형 표시). 줄은 밝은 선, 화살은 길이 0.9m 선과 촉. 모으는 중에는 공에서 방향으로 뻗는 선과 charge만큼 채워지는 호. 탈락한 공은 그리지 않는다.
- **점수표**(캔버스 위쪽 가운데): 참가자마다 색 원 + 점수 숫자, 목표 점수 표시, 탈락한 사람은 흐리게. 왼쪽 위에 "N 라운드 · 맵 이름 · 모드 이름".
- **문구**(캔버스 가운데): 카운트다운 3·2·1, `roundEnd`에서 "○○ 승리" 또는 "무승부", 구경 중이면 아래쪽에 "다음 라운드부터 참가합니다."
- **효과**: 탈락 지점에 그 공 색의 조각 12개가 0.6초 동안 퍼진다. 센 충돌(strength > 0.6)에는 화면을 0.15초 흔든다.
- **메뉴(HTML)**: `suika-game/src/ui/menus.ts`의 구조(`createMenus(root, actions)` + `show(view)`로 바뀐 부분만 다시 그림)를 따른다.
  - 처음 화면: 제목 "통통 대전", 한 줄 설명 "공으로 상대를 밀어내는 대전 게임입니다.", 이름 입력, 색 6개 고르기, 버튼 "연습하기"·"방 만들기", 방 코드 입력과 "방 들어가기", 조작 안내(방향키 또는 WASD: 이동과 뛰기, X 또는 스페이스: 특수 동작), 오류 문구. 연결 중이면 "연결하는 중입니다.", 연결할 수 없으면 "이 환경에서는 연습하기만 할 수 있습니다."
  - 대기실: (연습이 아니면) 방 코드와 "초대 링크 복사" 버튼, 참가자 목록(색 원, 이름, 방장·준비 표시, AI), 색 고르기(taken은 비활성), 방장에게는 모드(3개, 설명 포함)·목표 점수(3·5·7)·맵("무작위" + 6개)·AI 수(− +) 조절과 "시작하기", 참가자에게는 같은 설정을 읽기 전용으로 보여 주고 "준비하기"/"준비 취소", "나가기".
  - 경기 중: 오른쪽 위에 소리 켜기/끄기와 "나가기"만.
  - 최종 결과(`matchEnd`): "○○ 우승", 점수표, 방장에게 "대기실로 돌아가기", 참가자에게 "방장이 대기실로 돌아가기를 기다립니다.", "나가기".
- **터치 버튼**: `(pointer: coarse)`일 때만, 경기 중에만 보인다. 왼쪽 아래 ← → ↑ ↓, 오른쪽 아래 큰 특수 동작 버튼(모드에 따라 "무겁게"/"줄"/"화살"). `pointerdown/up/cancel/leave`로 처리하고 `touch-action: none`.
- **main.ts**: `connect()` 뒤 `new Multiplayer(...)`. 연결 전에도 연습하기가 되도록 `Multiplayer(null, …)`로 먼저 만들었다가 연결되면 (방에 들어가 있지 않을 때) 교체한다. 주소의 `#코드`를 방 코드 칸에 미리 넣는다. 매 프레임: 입력 읽기 → `mp.update(dt, input)` → 이벤트로 소리·효과 → `drawScene` → `menus.show`. 프로필은 방에 들어갈 때와 색을 바꿀 때 저장한다. 개발 중 확인용으로 `import.meta.env.DEV`일 때만 `window.__game = { mp }`를 둔다.

- [ ] **Step 1: 실패하는 테스트 작성.** `tests/storage.test.ts`: 저장·불러오기 왕복 / 깨진 JSON·잘못된 색이면 기본값 / `PROFILE_KEY` 외의 키를 건드리지 않는다(가짜 Store에 기록된 키 확인) / store가 null이거나 예외를 던져도 오류가 없다. `tests/scene-layout.test.ts`: `fitView(1600, 900)`의 scale 50, offset 0 / `fitView(1000, 1000)`은 가로에 맞추고 세로 가운데 정렬(scale 31.25, offsetY 218.75) / `fitView(2000, 900)`은 세로에 맞추고 가로 가운데 정렬.
- [ ] **Step 2: 실패 확인 후 구현**(storage, fitView 먼저, 이어서 나머지).
- [ ] **Step 3: `npx vitest run`, `npm run build`, `npm run build:web` 통과.** `ls dist/assets`에 JS 하나와 CSS 하나만 있는지 확인한다.
- [ ] **Step 4: 커밋** (`feat: 화면과 입력, 소리를 붙여 게임 완성`).

---

### Task 9: 브라우저 확인, 손맛 조정, README

**Files:**
- Create: `README.md`, `.github/workflows/pages.yml`(`../suika-game`에서 복사)
- Modify: 확인하면서 드러난 문제의 해당 파일, `src/game/modes.ts`(수치 조정)

- [ ] **Step 1: 연습하기 확인.** `npm run dev`(백그라운드)로 열어 세 모드를 각각 한 경기씩 진행한다. 확인할 것: 공이 발판을 뚫지 않는다 / 뛰기가 한 번에 한 번만 된다 / 무거워지면 테두리가 굵어지고 덜 밀린다 / 줄에 매달려 흔들린다 / 화살이 포물선으로 날아가 꽂히고 AI가 맞으면 탈락한다 / 점수표·카운트다운·승리 문구·최종 결과가 나온다 / 대기실로 돌아가 다시 시작할 수 있다. 숨은 탭에서는 `requestAnimationFrame`이 멈추므로 눈에 보이는 탭에서 확인한다.
- [ ] **Step 2: 같이 하기 확인.** `npx vite --mode web`으로 탭 두 개: 방 만들기 → 초대 링크로 들어가기 → 준비 → 시작 → 서로 밀어내기 → 라운드 승패 → 최종 결과 → 대기실. 방장 탭을 닫으면 남은 탭이 방장이 되어 계속되는지 확인한다. 가려진 탭은 타이머가 느려지므로 확인 사이에 3초 이상 기다린다.
- [ ] **Step 3: 손맛 조정.** 공이 너무 느리거나 미끄러우면 `TUNING`의 `accel`, `damping`, `restitution`, `jumpSpeed`를 조정한다. AI가 스스로 떨어지기만 하면 `decide`의 여유 거리를 늘린다. 바꾼 값에 맞춰 테스트 기대값을 고친다.
- [ ] **Step 4: README 작성**(합니다체 한국어): 게임 소개, 실행 방법(`npm install`, `npm run dev`, `npx vite --mode web`, `npm test`, `npm run build`), 조작, 모드 세 가지, 같이 하기의 동작 방식과 한계, 폴더 구조, 소리 출처(Kenney, CC0).
- [ ] **Step 5: 전체 테스트·빌드 통과 확인 후 커밋** (`docs: README 추가와 손맛 조정`).

---

## Self-Review 결과

- 설계 문서의 3장(규칙·조작·모드·수치·맵·AI)은 Task 1~4, 4장(화면·진행·겉모습·소리·저장)은 Task 4·8, 5장(같이 하기)은 Task 5~7, 6장(확인)은 각 Task의 테스트와 Task 9가 맡는다. 7장(배포)은 범위 밖이다.
- 설계 문서의 "방장은 들어온 시각이 가장 이른 사람" 규칙은, 시계가 어긋난 사람이 들어와 방장을 빼앗지 않도록 "이미 방장 정보를 올리고 있는 사람을 우선한다"로 보강했다(Task 5 `pickHost`).
- 화살은 planck 물체가 아니라 발사 정보에서 직접 계산한다. 모든 화면이 같은 발사 정보로 같은 궤적을 얻기 위해서다.
