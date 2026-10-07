import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/game/maps';
import type { Mode } from '../src/game/modes';
import { NO_INPUT, World } from '../src/physics/world';
import type { Input, WorldEvent } from '../src/physics/world';

const FLAT = MAPS[0];
const PILLARS = MAPS[4];

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

function ofType<T extends WorldEvent['type']>(events: WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] {
  return events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
}

/** 평지 위에 놓인 공 하나가 있는 세계입니다. */
function standing(mode: Mode = 'arrows', ids: [string, number][] = [['a', 16]]): World {
  const world = new World(FLAT, mode);
  for (const [id, x] of ids) world.addBall(id, x, 11.9, true);
  run(world, 120);
  return world;
}

/** special을 steps만큼 누르고 뗍니다(떼는 step까지 진행). */
function chargeAndRelease(world: World, id: string, steps: number, ...keys: (keyof Input)[]): WorldEvent[] {
  world.setInput(id, press('special', ...keys));
  const events = run(world, steps);
  world.setInput(id, NO_INPUT);
  events.push(...run(world, 1));
  return events;
}

describe('줄', () => {
  function hanging(mode: Mode = 'grapple', local = true): World {
    const world = new World(PILLARS, mode);
    world.addBall('a', 16, 8.5, local);
    return world;
  }

  it('위 발판에 걸리고 거리가 늘어나지 않는다', () => {
    const world = hanging();
    world.setInput('a', press('special'));
    const events = run(world, 1);
    expect(ofType(events, 'rope')).toHaveLength(1);
    const anchor = world.rope('a')!;
    expect(anchor[0]).toBeCloseTo(16, 1);
    expect(anchor[1]).toBeCloseTo(6.3, 1);
    const first = Math.hypot(anchor[0] - 16, anchor[1] - 8.5);
    for (let i = 0; i < 120; i++) {
      world.step();
      const s = world.state('a')!;
      expect(Math.hypot(anchor[0] - s.x, anchor[1] - s.y)).toBeLessThanOrEqual(first + 0.05);
    }
    expect(ofType(run(world, 60), 'rope')).toHaveLength(0);
  });

  it('special을 떼면 풀리고 공이 떨어진다', () => {
    const world = hanging();
    world.setInput('a', press('special'));
    run(world, 60);
    const y0 = world.state('a')!.y;
    world.setInput('a', NO_INPUT);
    run(world, 30);
    expect(world.rope('a')).toBeNull();
    expect(world.state('a')!.y).toBeGreaterThan(y0 + 0.5);
  });

  it('위에 발판이 없으면 걸리지 않는다', () => {
    const world = new World(FLAT, 'grapple');
    world.addBall('a', 16, 5, true);
    world.setInput('a', press('special'));
    expect(ofType(run(world, 5), 'rope')).toHaveLength(0);
    expect(world.rope('a')).toBeNull();
  });

  it('클래식에서는 걸리지 않는다', () => {
    const world = hanging('classic');
    world.setInput('a', press('special'));
    run(world, 5);
    expect(world.rope('a')).toBeNull();
  });

  it('원격 공은 special로 걸리지 않고 setRope만 따른다', () => {
    const world = hanging('grapple', false);
    world.setInput('a', press('special'));
    run(world, 5);
    expect(world.rope('a')).toBeNull();
    world.setRope('a', [16, 6.3]);
    expect(world.rope('a')).toEqual([16, 6.3]);
    world.setRope('a', [16, 6.3]);
    const d0 = Math.hypot(16 - world.state('a')!.x, 6.3 - world.state('a')!.y);
    run(world, 120);
    const s = world.state('a')!;
    expect(Math.hypot(16 - s.x, 6.3 - s.y)).toBeLessThanOrEqual(d0 + 0.1);
    world.setRope('a', null);
    expect(world.rope('a')).toBeNull();
  });

  it('공이 탈락하면 줄도 없어진다', () => {
    const world = hanging();
    world.setInput('a', press('special'));
    run(world, 2);
    world.kill('a');
    expect(world.rope('a')).toBeNull();
    run(world, 2);
  });
});

describe('화살 쏘기', () => {
  it('0.5초 모으면 중간 속력으로 나간다', () => {
    const world = standing();
    const events = chargeAndRelease(world, 'a', 30);
    expect(ofType(events, 'shoot')).toHaveLength(1);
    expect(world.arrows()).toHaveLength(1);
    const shot = world.shots('a')[0];
    expect(shot.id).toBe(1);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(18.75, 0);
  });

  it('모으는 동안 aim이 방향과 정도를 알려 준다', () => {
    const world = standing();
    expect(world.aim('a')).toBeNull();
    world.setInput('a', press('special', 'up'));
    run(world, 30);
    const aim = world.aim('a')!;
    expect(aim.dx).toBeCloseTo(0);
    expect(aim.dy).toBeCloseTo(-1);
    expect(aim.charge).toBeCloseTo(0.5, 1);
    expect(world.balls()[0].aim).toEqual(aim);
  });

  it('너무 짧게 누르면 쏘지 않고, 오래 눌러도 최대 속력을 넘지 않는다', () => {
    const world = standing();
    expect(ofType(chargeAndRelease(world, 'a', 6), 'shoot')).toHaveLength(0);
    expect(chargeAndRelease(world, 'a', 90).filter((e) => e.type === 'shoot')).toHaveLength(1);
    const shot = world.shots('a')[0];
    expect(Math.hypot(shot.vx, shot.vy)).toBeLessThanOrEqual(30);
    expect(Math.hypot(shot.vx, shot.vy)).toBeGreaterThan(29);
  });

  it('위를 누르면 위로, 방향키가 없으면 마지막 좌우 방향으로 쏜다', () => {
    const world = standing();
    chargeAndRelease(world, 'a', 30, 'up');
    const up = world.shots('a')[0];
    expect(up.vy).toBeLessThan(0);
    expect(up.vx).toBeCloseTo(0);
    const other = standing();
    other.setInput('a', press('left'));
    run(other, 2);
    chargeAndRelease(other, 'a', 30);
    expect(other.shots('a')[0].vx).toBeLessThan(0);
  });

  it('쏜 뒤 1초는 모을 수 없다', () => {
    const world = standing();
    chargeAndRelease(world, 'a', 30);
    expect(ofType(chargeAndRelease(world, 'a', 30), 'shoot')).toHaveLength(0);
    run(world, 70);
    expect(ofType(chargeAndRelease(world, 'a', 30), 'shoot')).toHaveLength(1);
  });
});

describe('화살 명중과 꽂힘', () => {
  it('local 공을 맞히면 탈락하고 화살은 사라진다', () => {
    const world = standing('arrows', [
      ['a', 10],
      ['b', 13],
    ]);
    world.setInput('a', press('special', 'right'));
    run(world, 30);
    world.setInput('a', NO_INPUT);
    const events = run(world, 20);
    const outs = ofType(events, 'out');
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ id: 'b', cause: 'arrow' });
    expect(world.alive('a')).toBe(true);
    expect(world.arrows()).toHaveLength(0);
  });

  it('원격 공은 맞아도 탈락하지 않는다', () => {
    const world = new World(FLAT, 'arrows');
    world.addBall('a', 10, 11.9, true);
    world.addBall('b', 13, 11.9, false);
    run(world, 120);
    world.setInput('a', press('special', 'right'));
    run(world, 30);
    world.setInput('a', NO_INPUT);
    const events = run(world, 20);
    expect(ofType(events, 'out')).toHaveLength(0);
    expect(world.alive('b')).toBe(true);
  });

  it('꽂힌 화살은 맞히지 못하고 3초 뒤 사라진다', () => {
    const world = new World(FLAT, 'arrows');
    world.addBall('a', 10, 5, true);
    world.setInput('a', press('special', 'down'));
    run(world, 30);
    world.setInput('a', NO_INPUT);
    const events = run(world, 40);
    expect(ofType(events, 'stick')).toHaveLength(1);
    expect(world.arrows()[0].stuck).toBe(true);
    const stuck = world.arrows()[0];
    world.addBall('b', stuck.x, stuck.y - 0.5, true);
    expect(ofType(run(world, 60), 'out').filter((e) => e.cause === 'arrow')).toHaveLength(0);
    run(world, 120);
    expect(world.arrows()).toHaveLength(0);
  });
});

describe('받은 화살 맞추기', () => {
  const shot = { id: 1, x: 5, y: 5, vx: 10, vy: 0, age: 0.5 };

  it('age만큼 미리 진행하고 같은 목록은 다시 만들지 않는다', () => {
    const world = new World(FLAT, 'arrows');
    world.syncShots('r', [shot]);
    expect(world.arrows()).toHaveLength(1);
    expect(world.arrows()[0].x).toBeGreaterThan(9.7);
    expect(world.arrows()[0].x).toBeLessThan(10.3);
    world.syncShots('r', [shot]);
    expect(world.arrows()).toHaveLength(1);
    expect(world.shots('r')[0].age).toBeCloseTo(0.5, 1);
    world.syncShots('r', []);
    expect(world.arrows()).toHaveLength(0);
  });

  it('미리 진행하다 local 공을 맞히면 다음 step에 탈락이 알려진다', () => {
    const world = new World(FLAT, 'arrows');
    world.addBall('b', 8, 5.9, true);
    world.syncShots('r', [shot]);
    expect(world.arrows()).toHaveLength(0);
    world.syncShots('r', [shot]);
    expect(world.arrows()).toHaveLength(0);
    expect(ofType(world.step(), 'out')).toMatchObject([{ id: 'b', cause: 'arrow' }]);
  });
});

describe('원격 공 맞추기', () => {
  const rest = { vx: 0, vy: 0, av: 0 };

  it('가까우면 속도로, 멀면 바로 옮겨 맞춘다', () => {
    const world = new World(FLAT, 'classic');
    world.addBall('r', 10, 5, false);
    world.correct('r', { x: 10.5, y: 5, ...rest });
    expect(world.state('r')!.vx).toBeCloseTo(3, 5);
    world.correct('r', { x: 20, y: 5, ...rest });
    expect(world.state('r')!.x).toBe(20);
    expect(world.balls()[0].x).toBe(20);
  });

  it('local 공에는 효과가 없다', () => {
    const world = new World(FLAT, 'classic');
    world.addBall('a', 10, 5, true);
    world.correct('a', { x: 20, y: 5, ...rest });
    expect(world.state('a')!.x).toBe(10);
  });
});

describe('입력 복사', () => {
  it('setInput은 받은 객체를 복사한다', () => {
    const world = standing('classic');
    const input = press('right');
    world.setInput('a', input);
    run(world, 1);
    input.right = false;
    input.special = true;
    run(world, 1);
    expect(world.balls()[0].heavy).toBe(false);
  });

  it('NO_INPUT은 바꿀 수 없다', () => {
    expect(Object.isFrozen(NO_INPUT)).toBe(true);
  });
});
