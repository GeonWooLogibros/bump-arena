/**
 * 그릴 모습 계산. 물리 step 사이를 이어 그리고, 찌그러짐과 센 충돌의 짧은 멈춤을 더합니다.
 * 겉모습에만 쓰며 경기 결과에는 영향을 주지 않습니다.
 */
import type { Shape } from '../game/maps';
import { TUNING } from '../game/modes';
import { roundKey } from '../net/wire';
import { corners, nearestOnSegment } from '../physics/geometry';
import type { ArrowView, BallView } from '../physics/world';
import type { SessionView } from '../session';

/** 한 step 사이에 이보다 멀리(m) 옮겨진 것은 순간 이동으로 보고 이어 그리지 않습니다. */
export const WARP_DISTANCE = 1;

/** 세기 1인 충돌에 공이 눌리는 비율입니다. */
export const SQUASH_MAX = 0.22;
/** 무거워진 공은 눌리는 정도에 이 값을 곱합니다. 단단해 보이게 합니다. */
export const SQUASH_HEAVY = 0.4;
/** 눌린 공이 제 모양으로 돌아오기까지의 시간(초)입니다. */
export const SQUASH_TIME = 0.28;
/** 눌린 정도가 이 시간(초)마다 약 1/3로 줄어듭니다. */
const SQUASH_FADE = 0.07;
/** 눌렸다 늘어났다 하는 빠르기(라디안/초)입니다. */
const SQUASH_SWING = 38;

/** 공이 이 속력(m/s)부터 진행 방향으로 늘어나기 시작하고, STRETCH_FULL에서 STRETCH_MAX만큼 늘어납니다. */
export const STRETCH_FROM = 9;
export const STRETCH_FULL = 22;
export const STRETCH_MAX = 0.16;

/** 공 사이의 충돌 세기가 이 값 이상일 때만 화면을 잠깐 멈춥니다. */
export const HITSTOP_MIN = 0.65;
/** 멈추는 시간(초)입니다. 세기가 HITSTOP_MIN이면 SHORT, 1이면 LONG입니다. */
export const HITSTOP_SHORT = 0.05;
export const HITSTOP_LONG = 0.08;
/** 멈춘 뒤 지금 모습을 따라잡는 데 걸리는 시간(초)입니다. */
export const HITSTOP_CATCH = 0.06;
/** 멈춤이 끝난 뒤 이 시간(초) 동안은 다시 멈추지 않습니다. */
export const HITSTOP_GAP = 0.3;

/** 세기 1로 튕길 때 튕기는 발판이 눌리는 깊이(m)입니다. */
export const PAD_PRESS = 0.24;
/** 튕기는 발판에서 이보다 멀리(m) 떨어진 충돌은 그 발판의 것으로 보지 않습니다. */
const PAD_REACH = 1;

/** 그릴 공 하나입니다. */
export interface BallPose {
  ball: BallView;
  x: number;
  y: number;
  angle: number;
  /** 줄의 고정점입니다. 줄이 없으면 쓰지 않습니다. */
  ropeX: number;
  ropeY: number;
  /** 속도(m/s)입니다. 순간 이동한 직후에는 0입니다. */
  vx: number;
  vy: number;
  /** 공의 중심에서 부딪친 곳을 향하는 단위 벡터와, 그 방향으로 눌린 비율입니다. 음수이면 늘어난 것입니다. */
  nx: number;
  ny: number;
  squash: number;
}

/** 그릴 화살 하나입니다. */
export interface ArrowPose {
  arrow: ArrowView;
  x: number;
  y: number;
}

/** 눌린 방향과 정도, 눌린 뒤 지난 시간입니다. */
export interface Dent {
  nx: number;
  ny: number;
  amount: number;
  age: number;
}

/** 멈추는 순간의 위치입니다. */
interface Held {
  x: number;
  y: number;
  angle: number;
}

/** a에서 b로 t(0~1)만큼 간 값입니다. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** value가 from 이하이면 0, full 이상이면 1이고 그 사이는 고르게 늘어납니다. */
export function ramp(value: number, from: number, full: number): number {
  return Math.max(0, Math.min(1, (value - from) / (full - from)));
}

/** 처음에 amount만큼 눌린 것이 age초 뒤에 눌려 있는 정도입니다. 반대로 살짝 늘어났다가 0으로 돌아옵니다. */
export function squashAt(amount: number, age: number): number {
  if (age < 0 || age >= SQUASH_TIME) return 0;
  return amount * Math.exp(-age / SQUASH_FADE) * Math.cos(age * SQUASH_SWING);
}

/** 속력에 따라 진행 방향으로 늘어나는 비율(0~STRETCH_MAX)입니다. */
export function stretchOf(speed: number): number {
  return STRETCH_MAX * ramp(speed, STRETCH_FROM, STRETCH_FULL);
}

/** 그 세기의 충돌에 화면을 멈추는 시간(초)입니다. 약하면 0입니다. */
export function hitstopTime(strength: number): number {
  if (!(strength >= HITSTOP_MIN)) return 0;
  return mix(HITSTOP_SHORT, HITSTOP_LONG, ramp(strength, HITSTOP_MIN, 1));
}

/**
 * 멈춘 모습에서 지금 모습으로 옮겨 온 비율(0~1)입니다.
 * elapsed는 멈춘 뒤 지난 시간이고 hold는 멈추는 시간입니다. 멈춰 있는 동안 0이고, 그 뒤 HITSTOP_CATCH에 걸쳐 1이 됩니다.
 */
export function catchUp(elapsed: number, hold: number): number {
  return ramp(elapsed, hold, hold + HITSTOP_CATCH);
}

/** (x, y)에서 가장 가까운 튕기는 발판의 번호입니다. PAD_REACH 안에 없으면 -1입니다. */
export function nearestBouncy(shapes: readonly Shape[], x: number, y: number): number {
  let best = -1;
  let bestGap = PAD_REACH;
  shapes.forEach((shape, i) => {
    if (!shape.bouncy) return;
    let gap = Infinity;
    if (shape.kind === 'circle') {
      gap = Math.abs(Math.hypot(x - shape.x, y - shape.y) - shape.r);
    } else {
      const points = corners(shape) ?? [];
      points.forEach((a, k) => {
        const [px, py] = nearestOnSegment(a, points[(k + 1) % points.length], x, y);
        gap = Math.min(gap, Math.hypot(x - px, y - py));
      });
    }
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

const BLANK = { x: 0, y: 0, angle: 0, ropeX: 0, ropeY: 0, vx: 0, vy: 0, nx: 0, ny: 0, squash: 0 };

function findBall(list: readonly BallView[], id: string): BallView | null {
  for (const ball of list) if (ball.id === id) return ball;
  return null;
}

function findArrow(list: readonly ArrowView[], owner: string, id: number): ArrowView | null {
  for (const arrow of list) if (arrow.owner === owner && arrow.id === id) return arrow;
  return null;
}

/** 지난 시간을 더하고 다 돌아온 것은 지웁니다. */
function ageDents<K>(dents: Map<K, Dent>, seconds: number): void {
  for (const [key, dent] of dents) {
    dent.age += seconds;
    if (dent.age >= SQUASH_TIME) dents.delete(key);
  }
}

/** 프레임마다 그릴 공과 화살의 모습을 정합니다. 목록의 객체는 다음 프레임에 다시 씁니다. */
export class Poses {
  /** 그릴 공들입니다. SessionView의 balls와 같은 순서입니다. */
  balls: BallPose[] = [];
  arrows: ArrowPose[] = [];
  /** 그릴 발판의 시간(초)입니다. */
  time = 0;
  /** 움직임 줄이기 설정입니다. 켜져 있으면 화면을 멈추지 않습니다. */
  reduced = false;

  private readonly dents = new Map<string, Dent>();
  private readonly pads = new Map<number, Dent>();
  private readonly held = new Map<string, Held>();
  private heldTime = 0;
  /** 이번 프레임에 시작할 멈춤의 길이(초)입니다. 없으면 0입니다. */
  private asked = 0;
  /** 지금 멈춤의 길이와 시작한 뒤 지난 시간(초)입니다. 멈추고 있지 않으면 hold가 0입니다. */
  private hold = 0;
  private elapsed = 0;
  /** 다시 멈출 수 있을 때까지 남은 시간(초)입니다. */
  private rest = 0;
  private round = 0;

  /** 공이 (nx, ny) 쪽에서 세기 strength(0~1)로 부딪쳤습니다. 이미 더 깊이 눌려 있으면 그대로 둡니다. */
  squash(id: string, nx: number, ny: number, strength: number): void {
    const amount = SQUASH_MAX * Math.max(0, Math.min(1, strength));
    const dent = this.dents.get(id);
    if (dent && squashAt(dent.amount, dent.age) > amount) return;
    this.dents.set(id, { nx, ny, amount, age: 0 });
  }

  /** (x, y)에 가장 가까운 튕기는 발판을 (nx, ny) 쪽으로 누릅니다. */
  press(shapes: readonly Shape[], x: number, y: number, nx: number, ny: number, strength: number): void {
    const index = nearestBouncy(shapes, x, y);
    if (index < 0) return;
    this.pads.set(index, { nx, ny, amount: PAD_PRESS * Math.max(0, Math.min(1, strength)), age: 0 });
  }

  /** 발판이 눌린 방향과 깊이(m)입니다. 눌리지 않았으면 null입니다. 받은 객체는 바로 쓰고 버립니다. */
  pad(index: number): Dent | null {
    return this.pads.get(index) ?? null;
  }

  /** 세기 strength(0~1)의 충돌에 화면을 잠깐 멈춥니다. 약한 충돌이거나 방금 멈췄으면 아무 일도 없습니다. */
  freeze(strength: number): void {
    if (this.reduced || this.hold > 0 || this.rest > 0) return;
    this.asked = Math.max(this.asked, hitstopTime(strength));
  }

  /** 화면이 멈춰 있거나 따라잡는 중인지 여부. */
  get frozen(): boolean {
    return this.hold > 0;
  }

  /** seconds초가 지난 뒤의 그릴 모습을 정합니다. */
  update(view: SessionView | null, seconds: number): void {
    if (!view || !view.map) {
      this.clear();
      return;
    }
    const round = roundKey(view.match.game, view.match.round);
    if (round !== this.round) {
      this.clear();
      this.round = round;
    }
    ageDents(this.dents, seconds);
    ageDents(this.pads, seconds);
    this.rest = Math.max(0, this.rest - seconds);

    const prev = view.prev;
    let alpha = prev ? Math.max(0, Math.min(1, view.alpha)) : 1;
    // 멈추는 순간에는 부딪친 step의 모습을 그대로 잡아 둡니다.
    const starting = this.asked > 0;
    if (starting) {
      this.hold = this.asked;
      this.asked = 0;
      this.elapsed = 0;
      this.held.clear();
      alpha = 1;
    } else if (this.hold > 0) {
      this.elapsed += seconds;
    }
    const shown = this.hold > 0 ? catchUp(this.elapsed, this.hold) : 1;

    this.balls.length = view.balls.length;
    for (let i = 0; i < view.balls.length; i++) {
      const ball = view.balls[i];
      const pose = (this.balls[i] ??= { ...BLANK, ball });
      const was = prev ? findBall(prev.balls, ball.id) : null;
      pose.ball = ball;
      pose.x = ball.x;
      pose.y = ball.y;
      pose.angle = ball.angle;
      pose.vx = 0;
      pose.vy = 0;
      if (was?.alive && ball.alive) {
        const dx = ball.x - was.x;
        const dy = ball.y - was.y;
        if (Math.hypot(dx, dy) < WARP_DISTANCE) {
          pose.x = was.x + dx * alpha;
          pose.y = was.y + dy * alpha;
          pose.angle = mix(was.angle, ball.angle, alpha);
          pose.vx = dx / TUNING.step;
          pose.vy = dy / TUNING.step;
        }
      }
      if (ball.rope) {
        [pose.ropeX, pose.ropeY] = ball.rope;
        // 움직이는 발판에 건 줄은 고정점도 이어 그립니다. 새로 건 줄은 바로 그립니다.
        if (was?.rope && Math.hypot(ball.rope[0] - was.rope[0], ball.rope[1] - was.rope[1]) < WARP_DISTANCE) {
          pose.ropeX = mix(was.rope[0], ball.rope[0], alpha);
          pose.ropeY = mix(was.rope[1], ball.rope[1], alpha);
        }
      }
      this.hang(ball.id, pose, starting, shown);
      const dent = this.dents.get(ball.id);
      pose.nx = dent?.nx ?? 0;
      pose.ny = dent?.ny ?? 0;
      pose.squash = dent ? squashAt(dent.amount, dent.age) * (ball.heavy ? SQUASH_HEAVY : 1) : 0;
    }

    this.arrows.length = view.arrows.length;
    for (let i = 0; i < view.arrows.length; i++) {
      const arrow = view.arrows[i];
      const pose = (this.arrows[i] ??= { arrow, x: 0, y: 0 });
      const was = prev ? findArrow(prev.arrows, arrow.owner, arrow.id) : null;
      pose.arrow = arrow;
      pose.x = arrow.x;
      pose.y = arrow.y;
      if (was && Math.hypot(arrow.x - was.x, arrow.y - was.y) < WARP_DISTANCE) {
        pose.x = mix(was.x, arrow.x, alpha);
        pose.y = mix(was.y, arrow.y, alpha);
      }
      if (starting || shown < 1) this.hang(`${arrow.owner}/${arrow.id}`, pose, starting, shown);
    }

    this.time = prev ? mix(prev.time, view.time, alpha) : view.time;
    if (starting) this.heldTime = this.time;
    else if (shown < 1) this.time = mix(this.heldTime, this.time, shown);
    else if (this.hold > 0) {
      // 다 따라잡았습니다.
      this.hold = 0;
      this.rest = HITSTOP_GAP;
      this.held.clear();
    }
  }

  clear(): void {
    this.balls.length = 0;
    this.arrows.length = 0;
    this.dents.clear();
    this.pads.clear();
    this.held.clear();
    this.time = 0;
    this.asked = 0;
    this.hold = 0;
    this.elapsed = 0;
    this.rest = 0;
    this.round = 0;
  }

  /** 멈추는 순간이면 위치를 잡아 두고, 멈춰 있거나 따라잡는 중이면 잡아 둔 위치에서 shown만큼만 옮깁니다. */
  private hang(key: string, pose: { x: number; y: number; angle?: number }, starting: boolean, shown: number): void {
    if (starting) {
      this.held.set(key, { x: pose.x, y: pose.y, angle: pose.angle ?? 0 });
      return;
    }
    if (shown >= 1) return;
    const held = this.held.get(key);
    if (!held) return;
    pose.x = mix(held.x, pose.x, shown);
    pose.y = mix(held.y, pose.y, shown);
    if (pose.angle !== undefined) pose.angle = mix(held.angle, pose.angle, shown);
  }
}
