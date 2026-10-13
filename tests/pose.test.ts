import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/game/maps';
import type { Shape } from '../src/game/maps';
import { TUNING } from '../src/game/modes';
import { DEFAULT_SETTINGS, lobbyMatch } from '../src/game/round';
import type { ArrowView, BallView } from '../src/physics/world';
import {
  HITSTOP_CATCH,
  HITSTOP_GAP,
  HITSTOP_LONG,
  HITSTOP_MIN,
  HITSTOP_SHORT,
  PAD_PRESS,
  Poses,
  SQUASH_HEAVY,
  SQUASH_MAX,
  SQUASH_TIME,
  STRETCH_FROM,
  STRETCH_FULL,
  STRETCH_MAX,
  catchUp,
  hitstopTime,
  mix,
  nearestBouncy,
  ramp,
  squashAt,
  stretchOf,
} from '../src/render/pose';
import type { SessionView } from '../src/session';

function ballAt(id: string, x: number, y: number, patch: Partial<BallView> = {}): BallView {
  return { id, x, y, angle: 0, alive: true, heavy: false, heft: 1, fuel: 1, locked: false, rope: null, aim: null, ...patch };
}

function arrowAt(id: number, x: number, y: number): ArrowView {
  return { owner: 'a', id, x, y, angle: 0, stuck: false };
}

/** was에서 now로 한 step 움직인 뒤 alpha만큼 지난 모습입니다. */
function viewOf(now: BallView[], was: BallView[] | null, alpha: number, patch: Partial<SessionView> = {}): SessionView {
  return {
    match: { ...lobbyMatch({ ...DEFAULT_SETTINGS }), phase: 'play', game: 1, round: 1 },
    map: MAPS[0],
    shapes: MAPS[0].shapes,
    balls: now,
    arrows: [],
    watching: false,
    me: 'a',
    prev: was && { balls: was, arrows: [], time: 0 },
    time: 0,
    alpha,
    ...patch,
  };
}

describe('섞기', () => {
  it('mix는 두 값 사이를 비율만큼 간다', () => {
    expect(mix(2, 6, 0)).toBe(2);
    expect(mix(2, 6, 0.25)).toBe(3);
    expect(mix(2, 6, 1)).toBe(6);
  });

  it('ramp는 범위 밖에서 0과 1에 머문다', () => {
    expect(ramp(5, 10, 20)).toBe(0);
    expect(ramp(15, 10, 20)).toBe(0.5);
    expect(ramp(30, 10, 20)).toBe(1);
  });
});

describe('이어 그리기', () => {
  it('직전 모습과 지금 모습 사이를 alpha만큼 간 곳에 그린다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 10.2, 5, { angle: 1 })], [ballAt('a', 10, 5)], 0.25), 0.004);
    expect(poses.balls).toHaveLength(1);
    expect(poses.balls[0].x).toBeCloseTo(10.05);
    expect(poses.balls[0].y).toBeCloseTo(5);
    expect(poses.balls[0].angle).toBeCloseTo(0.25);
  });

  it('한 step에 움직인 거리로 속도를 구한다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 10.2, 5)], [ballAt('a', 10, 5)], 0.5), 0.004);
    expect(poses.balls[0].vx).toBeCloseTo(0.2 / TUNING.step);
    expect(poses.balls[0].vy).toBeCloseTo(0);
  });

  it('직전 모습이 없으면 지금 모습을 그대로 그린다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 10, 5)], null, 0), 0.004);
    expect(poses.balls[0].x).toBe(10);
    expect(poses.balls[0].vx).toBe(0);
  });

  it('순간 이동한 공은 이어 그리지 않는다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 20, 5)], [ballAt('a', 10, 5)], 0.5), 0.004);
    expect(poses.balls[0].x).toBe(20);
    expect(poses.balls[0].vx).toBe(0);
  });

  it('직전 모습에 없던 공은 지금 위치에 그린다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 10, 5), ballAt('b', 3, 3)], [ballAt('a', 10, 5)], 0.5), 0.004);
    expect(poses.balls[1].x).toBe(3);
  });

  it('탈락한 공은 마지막 위치에 둔다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 10.2, 5, { alive: false })], [ballAt('a', 10, 5)], 0.5), 0.004);
    expect(poses.balls[0].x).toBe(10.2);
  });

  it('화살은 번호가 같은 것끼리 이어 그리고 새 화살은 바로 그린다', () => {
    const poses = new Poses();
    const view = viewOf([], [], 0.5, { arrows: [arrowAt(2, 6, 4), arrowAt(3, 9, 9)] });
    view.prev!.arrows = [arrowAt(1, 0, 0), arrowAt(2, 5.6, 4)];
    poses.update(view, 0.004);
    expect(poses.arrows.map((p) => p.x)).toEqual([expect.closeTo(5.8), 9]);
  });

  it('움직이는 발판에 건 줄의 고정점도 이어 그리고, 새로 건 줄은 바로 그린다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 10, 5, { rope: [12, 2] })], [ballAt('a', 10, 5, { rope: [11.9, 2] })], 0.5), 0.004);
    expect(poses.balls[0].ropeX).toBeCloseTo(11.95);
    poses.update(viewOf([ballAt('a', 10, 5, { rope: [20, 2] })], [ballAt('a', 10, 5, { rope: [12, 2] })], 0.5), 0.004);
    expect(poses.balls[0].ropeX).toBe(20);
  });

  it('발판의 시간도 두 step 사이를 잇는다', () => {
    const poses = new Poses();
    const view = viewOf([], [], 0.5, { time: 2 });
    view.prev!.time = 1;
    poses.update(view, 0.004);
    expect(poses.time).toBeCloseTo(1.5);
  });

  it('공의 수가 줄어도 지난 프레임의 공이 남지 않고, 객체는 다시 쓴다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 1, 1), ballAt('b', 2, 2)], null, 0), 0.004);
    const first = poses.balls[0];
    poses.update(viewOf([ballAt('b', 2, 2)], null, 0), 0.004);
    expect(poses.balls).toHaveLength(1);
    expect(poses.balls[0]).toBe(first);
    expect(poses.balls[0].ball.id).toBe('b');
  });

  it('경기가 없으면 비운다', () => {
    const poses = new Poses();
    poses.update(viewOf([ballAt('a', 1, 1)], null, 0), 0.004);
    poses.update(null, 0.004);
    expect(poses.balls).toHaveLength(0);
  });
});

describe('찌그러짐', () => {
  it('부딪친 순간 가장 많이 눌리고, 반대로 조금 늘어났다가 제 모양으로 돌아온다', () => {
    expect(squashAt(0.2, 0)).toBeCloseTo(0.2);
    const values = Array.from({ length: 28 }, (_, i) => squashAt(0.2, i * 0.01));
    expect(Math.min(...values)).toBeLessThan(0);
    expect(Math.min(...values)).toBeGreaterThan(-0.1);
    expect(Math.max(...values.slice(1))).toBeLessThan(0.2);
    expect(squashAt(0.2, SQUASH_TIME)).toBe(0);
    expect(Math.abs(squashAt(0.2, SQUASH_TIME - 0.001))).toBeLessThan(0.01);
  });

  it('충돌 세기에 비례하고 한도를 넘지 않는다', () => {
    const poses = new Poses();
    const view = viewOf([ballAt('a', 1, 1), ballAt('b', 5, 1)], null, 0);
    poses.update(view, 0);
    poses.squash('a', 0, 1, 0.5);
    poses.squash('b', 1, 0, 7);
    poses.update(view, 0);
    expect(poses.balls[0].squash).toBeCloseTo(SQUASH_MAX * 0.5);
    expect(poses.balls[0].ny).toBe(1);
    expect(poses.balls[1].squash).toBeCloseTo(SQUASH_MAX);
  });

  it('시간이 지나면 사라진다', () => {
    const poses = new Poses();
    const view = viewOf([ballAt('a', 1, 1)], null, 0);
    poses.update(view, 0);
    poses.squash('a', 0, 1, 1);
    poses.update(view, SQUASH_TIME + 0.01);
    expect(poses.balls[0].squash).toBe(0);
    expect(poses.balls[0].ny).toBe(0);
  });

  it('더 깊이 눌려 있는 동안의 약한 충돌은 무시한다', () => {
    const poses = new Poses();
    const view = viewOf([ballAt('a', 1, 1)], null, 0);
    poses.update(view, 0);
    poses.squash('a', 0, 1, 1);
    poses.squash('a', 1, 0, 0.2);
    poses.update(view, 0);
    expect(poses.balls[0].ny).toBe(1);
    poses.squash('a', 1, 0, 1);
    poses.update(view, 0.01);
    expect(poses.balls[0].nx).toBe(1);
  });

  it('무거워진 공은 덜 눌린다', () => {
    const poses = new Poses();
    const view = viewOf([ballAt('a', 1, 1, { heavy: true })], null, 0);
    poses.update(view, 0);
    poses.squash('a', 0, 1, 1);
    poses.update(view, 0);
    expect(poses.balls[0].squash).toBeCloseTo(SQUASH_MAX * SQUASH_HEAVY);
  });

  it('무거워지기의 효과가 다 줄어든 공은 평소만큼 눌린다', () => {
    const poses = new Poses();
    const view = viewOf([ballAt('a', 1, 1, { heavy: true, heft: 0 })], null, 0);
    poses.update(view, 0);
    poses.squash('a', 0, 1, 1);
    poses.update(view, 0);
    expect(poses.balls[0].squash).toBeCloseTo(SQUASH_MAX);
  });

  it('느릴 때는 늘어나지 않고 빠를수록 한도까지 늘어난다', () => {
    expect(stretchOf(STRETCH_FROM)).toBe(0);
    expect(stretchOf((STRETCH_FROM + STRETCH_FULL) / 2)).toBeCloseTo(STRETCH_MAX / 2);
    expect(stretchOf(100)).toBe(STRETCH_MAX);
  });
});

describe('센 충돌의 짧은 멈춤', () => {
  it('약한 충돌에는 멈추지 않고, 셀수록 길게 멈춘다', () => {
    expect(hitstopTime(HITSTOP_MIN - 0.01)).toBe(0);
    expect(hitstopTime(HITSTOP_MIN)).toBeCloseTo(HITSTOP_SHORT);
    expect(hitstopTime(1)).toBeCloseTo(HITSTOP_LONG);
    expect(hitstopTime(Number.NaN)).toBe(0);
  });

  it('멈춰 있는 동안 0이고 그 뒤 따라잡는다', () => {
    expect(catchUp(0, 0.05)).toBe(0);
    expect(catchUp(0.05, 0.05)).toBe(0);
    expect(catchUp(0.05 + HITSTOP_CATCH / 2, 0.05)).toBeCloseTo(0.5);
    expect(catchUp(0.05 + HITSTOP_CATCH, 0.05)).toBe(1);
  });

  /** 공이 한 프레임(1/60초)에 0.1m씩 오른쪽으로 가는 모습을 n번째 프레임까지 진행합니다. */
  function advance(poses: Poses, n: number): number {
    poses.update(viewOf([ballAt('a', 10 + 0.1 * n, 5)], [ballAt('a', 10 + 0.1 * (n - 1), 5)], 1), TUNING.step);
    return poses.balls[0].x;
  }

  it('부딪친 순간의 모습을 잠깐 유지한 뒤 지금 모습을 따라잡는다', () => {
    const poses = new Poses();
    advance(poses, 1);
    poses.freeze(1);
    const at = advance(poses, 2);
    expect(at).toBeCloseTo(10.2);
    expect(poses.frozen).toBe(true);
    // 0.08초(약 5프레임) 동안은 그대로입니다.
    for (let n = 3; n <= 6; n++) expect(advance(poses, n)).toBeCloseTo(at);
    const xs: number[] = [];
    for (let n = 7; n <= 12; n++) xs.push(advance(poses, n));
    // 따라잡는 동안에는 뒤로 가지 않고, 끝나면 지금 위치와 같습니다.
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(xs[xs.length - 1]).toBeCloseTo(11.2);
    expect(poses.frozen).toBe(false);
  });

  it('멈추는 동안 발판의 시간과 화살도 멈춘다', () => {
    const poses = new Poses();
    const frame = (n: number): SessionView => {
      const view = viewOf([], [], 1, { time: n / 60, arrows: [arrowAt(1, n, 0)] });
      view.prev!.time = (n - 1) / 60;
      view.prev!.arrows = [arrowAt(1, n - 1, 0)];
      return view;
    };
    poses.update(frame(1), TUNING.step);
    poses.freeze(1);
    poses.update(frame(2), TUNING.step);
    poses.update(frame(3), TUNING.step);
    expect(poses.time).toBeCloseTo(2 / 60);
    expect(poses.arrows[0].x).toBeCloseTo(2);
  });

  it('약한 충돌에는 멈추지 않는다', () => {
    const poses = new Poses();
    advance(poses, 1);
    poses.freeze(HITSTOP_MIN - 0.05);
    advance(poses, 2);
    expect(poses.frozen).toBe(false);
    expect(advance(poses, 3)).toBeCloseTo(10.3);
  });

  it('멈춘 직후에는 다시 멈추지 않는다', () => {
    const poses = new Poses();
    advance(poses, 1);
    poses.freeze(1);
    let n = 2;
    for (; n < 40 && (n === 2 || poses.frozen); n++) advance(poses, n);
    expect(poses.frozen).toBe(false);
    poses.freeze(1);
    advance(poses, n++);
    expect(poses.frozen).toBe(false);
    for (let i = 0; i < Math.ceil(HITSTOP_GAP * 60) + 1; i++) advance(poses, n++);
    poses.freeze(1);
    advance(poses, n);
    expect(poses.frozen).toBe(true);
  });

  it('움직임 줄이기가 켜져 있으면 멈추지 않는다', () => {
    const poses = new Poses();
    poses.reduced = true;
    advance(poses, 1);
    poses.freeze(1);
    advance(poses, 2);
    expect(poses.frozen).toBe(false);
  });

  it('라운드가 바뀌면 멈춤과 찌그러짐을 버린다', () => {
    const poses = new Poses();
    advance(poses, 1);
    poses.freeze(1);
    poses.squash('a', 0, 1, 1);
    advance(poses, 2);
    const next = viewOf([ballAt('a', 3, 3)], null, 0);
    next.match = { ...next.match, round: 2 };
    poses.update(next, TUNING.step);
    expect(poses.frozen).toBe(false);
    expect(poses.balls[0].x).toBe(3);
    expect(poses.balls[0].squash).toBe(0);
  });
});

describe('튕기는 발판의 눌림', () => {
  const shapes: Shape[] = [
    { kind: 'box', x: 16, y: 13, w: 10, h: 1 },
    { kind: 'box', x: 5, y: 13, w: 4, h: 1, bouncy: true },
    { kind: 'circle', x: 25, y: 10, r: 1, bouncy: true },
  ];

  it('충돌 지점에서 가장 가까운 튕기는 발판을 찾는다', () => {
    expect(nearestBouncy(shapes, 5, 12.5)).toBe(1);
    expect(nearestBouncy(shapes, 25, 9)).toBe(2);
  });

  it('튕기는 발판이 가까이 없으면 -1이다', () => {
    expect(nearestBouncy(shapes, 16, 12.5)).toBe(-1);
    expect(nearestBouncy([shapes[0]], 5, 12.5)).toBe(-1);
  });

  it('눌린 발판은 세기에 비례한 깊이만큼 밀렸다가 돌아온다', () => {
    const poses = new Poses();
    poses.update(viewOf([], null, 0), 0);
    poses.press(shapes, 5, 12.5, 0, 1, 0.5);
    const dent = poses.pad(1);
    expect(dent).not.toBeNull();
    expect(dent!.ny).toBe(1);
    expect(squashAt(dent!.amount, dent!.age)).toBeCloseTo(PAD_PRESS * 0.5);
    expect(poses.pad(0)).toBeNull();
    poses.update(viewOf([], null, 0), SQUASH_TIME + 0.01);
    expect(poses.pad(1)).toBeNull();
  });
});
