import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/game/maps';
import { MODES, TUNING } from '../src/game/modes';
import type { Mode } from '../src/game/modes';
import { NO_INPUT, World } from '../src/physics/world';
import type { BallView, Input, WorldEvent } from '../src/physics/world';

const FLAT = MAPS[0];
const PILLARS = MAPS[4];
/** 1초에 해당하는 step 수입니다. */
const SECOND = 60;

function press(...keys: (keyof Input)[]): Input {
  const input = { ...NO_INPUT };
  for (const key of keys) input[key] = true;
  return input;
}

function run(world: World, steps: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...world.step());
  return events;
}

function view(world: World, id = 'a'): BallView {
  return world.balls().find((ball) => ball.id === id)!;
}

/** 평지 위에 놓인 공 하나가 있는 세계입니다. */
function standing(mode: Mode, local = true): World {
  const world = new World(FLAT, mode);
  world.addBall('a', 16, 11.9, local);
  run(world, 120);
  return world;
}

/** 기둥 맵의 위쪽 발판 아래 허공에 공 하나가 있는 세계입니다. 줄을 걸면 (16, 6.3)에 걸립니다. */
function hanging(local = true): World {
  const world = new World(PILLARS, 'grapple');
  world.addBall('a', 16, 8.5, local);
  return world;
}

describe('무거워지기 키', () => {
  it.each(MODES.map((m) => m.id))('%s: heavy를 누르면 무거워지고 special로는 무거워지지 않는다', (mode) => {
    const world = standing(mode);
    world.setInput('a', press('special'));
    world.step();
    expect(view(world).heavy).toBe(false);
    world.setInput('a', press('heavy'));
    world.step();
    expect(view(world).heavy).toBe(true);
    world.setInput('a', NO_INPUT);
    world.step();
    expect(view(world).heavy).toBe(false);
  });

  it('누르고 있으면 남은 효과가 heavyFadeTime에 걸쳐 0까지 줄어든다', () => {
    const world = standing('classic');
    expect(view(world).heft).toBe(1);
    world.setInput('a', press('heavy'));
    run(world, (TUNING.heavyFadeTime * SECOND) / 2);
    expect(view(world).heft).toBeCloseTo(0.5, 2);
    run(world, (TUNING.heavyFadeTime * SECOND) / 2 + 5);
    expect(view(world).heft).toBe(0);
    expect(view(world).heavy).toBe(true);
  });

  it('떼면 heavyRecoverTime에 걸쳐 다시 찬다', () => {
    const world = standing('classic');
    world.setInput('a', press('heavy'));
    run(world, TUNING.heavyFadeTime * SECOND + 5);
    world.setInput('a', NO_INPUT);
    run(world, (TUNING.heavyRecoverTime * SECOND) / 2);
    expect(view(world).heft).toBeCloseTo(0.5, 2);
    run(world, (TUNING.heavyRecoverTime * SECOND) / 2 + 5);
    expect(view(world).heft).toBe(1);
  });

  /** heavy를 before초 동안 누르고 있다가, 누른 채로 0.5초 동안 오른쪽으로 민 거리입니다. before가 음수이면 누르지 않습니다. */
  function pushed(before: number): number {
    const world = standing('classic');
    if (before >= 0) world.setInput('a', press('heavy'));
    run(world, Math.max(0, before) * SECOND);
    const x0 = world.state('a')!.x;
    world.setInput('a', before >= 0 ? press('heavy', 'right') : press('right'));
    run(world, SECOND / 2);
    return world.state('a')!.x - x0;
  }

  it('효과가 줄어든 만큼 덜 무겁고, 다 줄어들면 평소 무게로 움직인다', () => {
    const light = pushed(-1);
    const fresh = pushed(0);
    const half = pushed(TUNING.heavyFadeTime / 2);
    const worn = pushed(TUNING.heavyFadeTime + 0.5);
    expect(fresh).toBeLessThan(half);
    expect(half).toBeLessThan(light);
    expect(worn).toBeCloseTo(light, 5);
  });

  it('줄에 매달려 있는 동안에는 무거워질 수 없다', () => {
    const world = hanging();
    world.setInput('a', press('special', 'heavy'));
    run(world, 30);
    expect(world.rope('a')).not.toBeNull();
    expect(view(world)).toMatchObject({ heavy: false, heft: 1 });
    world.setInput('a', press('heavy'));
    run(world, 1);
    expect(view(world).heavy).toBe(true);
  });

  it('화살을 모으는 동안에는 무거워질 수 없다', () => {
    const world = standing('arrows');
    world.setInput('a', press('special', 'heavy'));
    run(world, 30);
    expect(world.aim('a')).not.toBeNull();
    expect(view(world)).toMatchObject({ heavy: false, heft: 1 });
  });

  it('원격 공도 받은 입력으로 같은 규칙을 따르고, 받은 값으로 맞춘다', () => {
    const world = standing('classic', false);
    world.setInput('a', press('heavy'));
    run(world, (TUNING.heavyFadeTime * SECOND) / 2);
    expect(view(world)).toMatchObject({ heavy: true });
    expect(view(world).heft).toBeCloseTo(0.5, 2);
    world.setMeters('a', { heft: 0.9, fuel: 1, lock: 0 });
    expect(view(world).heft).toBe(0.9);
    expect(world.meters('a')).toEqual({ heft: 0.9, fuel: 1, lock: 0 });
  });
});

describe('갈고리 충전량', () => {
  it('갈고리가 아닌 모드에서는 늘 가득 차 있고 잠기지 않는다', () => {
    const world = standing('classic');
    world.setInput('a', press('special'));
    run(world, 30);
    expect(view(world)).toMatchObject({ fuel: 1, locked: false });
  });

  it('매달려 있는 동안 ropeDrainTime에 걸쳐 줄어든다', () => {
    const world = hanging();
    expect(view(world)).toMatchObject({ fuel: 1, locked: false });
    world.setInput('a', press('special'));
    run(world, (TUNING.ropeDrainTime * SECOND) / 2);
    expect(world.rope('a')).not.toBeNull();
    expect(view(world).fuel).toBeCloseTo(0.5, 1);
  });

  it('다 쓰면 줄이 풀리고 ropeLockTime 동안 잠긴 뒤 0에서부터 ropeFillTime에 걸쳐 찬다', () => {
    const world = hanging();
    world.setInput('a', press('special'));
    run(world, TUNING.ropeDrainTime * SECOND + 2);
    expect(world.rope('a')).toBeNull();
    expect(view(world)).toMatchObject({ fuel: 0, locked: true });
    // 누르고 있어도 다시 걸리지 않습니다.
    run(world, TUNING.ropeLockTime * SECOND - 10);
    expect(world.rope('a')).toBeNull();
    expect(view(world)).toMatchObject({ fuel: 0, locked: true });
    world.setInput('a', NO_INPUT);
    run(world, 10);
    expect(view(world).locked).toBe(false);
    run(world, (TUNING.ropeFillTime * SECOND) / 2);
    expect(view(world).fuel).toBeCloseTo(0.5, 1);
    run(world, (TUNING.ropeFillTime * SECOND) / 2 + 5);
    expect(view(world).fuel).toBe(1);
  });

  it('잠긴 동안에는 새로 눌러도 걸리지 않고, 풀린 뒤에 누르면 걸린다', () => {
    const world = hanging();
    world.setMeters('a', { heft: 1, fuel: 0, lock: 0.5 });
    world.setInput('a', press('special'));
    expect(run(world, 5).filter((e) => e.type === 'rope')).toHaveLength(0);
    world.setInput('a', NO_INPUT);
    run(world, 40);
    expect(view(world).locked).toBe(false);
    world.setInput('a', press('special'));
    expect(run(world, 1).filter((e) => e.type === 'rope')).toHaveLength(1);
    expect(world.rope('a')).not.toBeNull();
  });

  it('매달리지 않는 동안 다시 찬다', () => {
    const world = hanging();
    world.setInput('a', press('special'));
    run(world, (TUNING.ropeDrainTime * SECOND) / 2);
    world.setInput('a', NO_INPUT);
    run(world, (TUNING.ropeFillTime * SECOND) / 4);
    expect(view(world).fuel).toBeCloseTo(0.75, 1);
    expect(view(world).locked).toBe(false);
  });

  it('매달린 채 다른 공과 부딪치면 줄이 풀리고 충전량이 사라지며 잠긴다', () => {
    const world = hanging();
    world.setInput('a', press('special'));
    run(world, 1);
    expect(world.rope('a')).not.toBeNull();
    // 바로 위에서 다른 공이 떨어집니다.
    world.addBall('b', 16, 7.2, true);
    run(world, 30);
    expect(world.rope('a')).toBeNull();
    expect(view(world)).toMatchObject({ fuel: 0, locked: true });
    expect(view(world, 'b')).toMatchObject({ fuel: 1, locked: false });
  });

  it('원격 공은 부딪치거나 충전량이 바닥나도 스스로 줄을 풀지 않고, 받은 값을 따른다', () => {
    const world = hanging(false);
    world.setRope('a', [16, 6.3]);
    world.addBall('b', 16, 7.2, true);
    run(world, 30);
    expect(world.rope('a')).not.toBeNull();
    expect(view(world).locked).toBe(false);
    world.kill('b');
    run(world, TUNING.ropeDrainTime * SECOND + 10);
    expect(world.rope('a')).not.toBeNull();
    expect(view(world)).toMatchObject({ fuel: 0, locked: false });
    world.setRope('a', null);
    world.setMeters('a', { heft: 1, fuel: 0, lock: 2 });
    expect(view(world)).toMatchObject({ fuel: 0, locked: true });
    run(world, 2 * SECOND + 5);
    expect(view(world).locked).toBe(false);
    expect(view(world).fuel).toBeGreaterThan(0);
  });
});

describe('마우스로 줄 걸기', () => {
  it('겨누는 위치가 있으면 공에서 그쪽으로 쏜 선이 처음 만나는 발판에 건다', () => {
    const world = hanging();
    world.setAimPoint('a', [18, 6.5]);
    world.setInput('a', press('special'));
    run(world, 1);
    const anchor = world.rope('a')!;
    expect(anchor[0]).toBeCloseTo(18.2, 1);
    expect(anchor[1]).toBeCloseTo(6.3, 1);
  });

  it('그쪽으로 닿는 발판이 없으면 위에서 가장 가까운 곳에 건다', () => {
    const world = hanging();
    world.setAimPoint('a', [10, 8.5]);
    world.setInput('a', press('special'));
    run(world, 1);
    const anchor = world.rope('a')!;
    expect(anchor[0]).toBeCloseTo(16, 1);
    expect(anchor[1]).toBeCloseTo(6.3, 1);
  });

  it('닿는 발판이 ropeReach보다 멀면 그 발판에는 걸지 않는다', () => {
    const world = new World(FLAT, 'grapple');
    world.addBall('a', 16, 3, true);
    world.setAimPoint('a', [16, 12]);
    world.setInput('a', press('special'));
    run(world, 1);
    expect(world.rope('a')).toBeNull();
  });
});
