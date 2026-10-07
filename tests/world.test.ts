import { describe, expect, it } from 'vitest';
import type { Body } from 'planck';
import { MAPS } from '../src/game/maps';
import type { Mode } from '../src/game/modes';
import { NO_INPUT, World, packInput, unpackInput } from '../src/physics/world';
import type { Input, WorldEvent } from '../src/physics/world';

const FLAT = MAPS[0];

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

function settled(mode: Mode = 'classic'): World {
  const world = new World(FLAT, mode);
  world.addBall('a', 16, 11.9, true);
  run(world, 120);
  return world;
}

function travel(special: boolean): number {
  const world = settled();
  const x0 = world.state('a')!.x;
  world.setInput('a', special ? press('right', 'special') : press('right'));
  run(world, 60);
  return world.state('a')!.x - x0;
}

describe('입력 묶음', () => {
  it('packInput과 unpackInput이 왕복한다', () => {
    const input = press('left', 'down', 'special');
    expect(packInput(input)).toBe(1 + 8 + 16);
    expect(unpackInput(packInput(input))).toEqual(input);
    expect(unpackInput('x')).toEqual(NO_INPUT);
  });
});

describe('공의 이동', () => {
  it('시작 위치의 공은 발판 위에 멈춘다', () => {
    const world = settled();
    expect(world.state('a')!.y).toBeCloseTo(12.0, 1);
    expect(world.alive('a')).toBe(true);
  });

  it('오른쪽 입력으로 오른쪽으로 움직인다', () => {
    const world = settled();
    const x0 = world.state('a')!.x;
    world.setInput('a', press('right'));
    run(world, 60);
    expect(world.state('a')!.x).toBeGreaterThan(x0);
    expect(world.state('a')!.vx).toBeGreaterThan(0);
  });

  it('공중에서는 뛰지 않는다', () => {
    const world = new World(FLAT, 'classic');
    world.addBall('a', 16, 5, true);
    world.setInput('a', press('up'));
    const events = run(world, 5);
    expect(world.state('a')!.vy).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(0);
  });

  it('바닥에서는 뛴다', () => {
    const world = settled();
    world.setInput('a', press('up'));
    const events = run(world, 3);
    expect(world.state('a')!.vy).toBeLessThan(-5);
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(1);
  });
});

describe('무거워지기', () => {
  it('클래식에서 무거운 공은 덜 움직인다', () => {
    const ratio = travel(true) / travel(false);
    expect(ratio).toBeGreaterThanOrEqual(0.25);
    expect(ratio).toBeLessThanOrEqual(0.45);
  });

  it('클래식에서만 heavy가 켜진다', () => {
    const classic = settled('classic');
    classic.setInput('a', press('special'));
    classic.step();
    expect(classic.balls()[0].heavy).toBe(true);
    const grapple = settled('grapple');
    grapple.setInput('a', press('special'));
    grapple.step();
    expect(grapple.balls()[0].heavy).toBe(false);
  });

  it('같은 속력으로 부딪치면 보통 공의 속도 변화가 더 크다', () => {
    const world = new World(FLAT, 'classic');
    world.addBall('heavy', 14, 5, true);
    world.addBall('light', 18, 5, true);
    world.setInput('heavy', press('special'));
    world.step();
    const body = (id: string) => (world as unknown as { entries: Map<string, { body: Body }> }).entries.get(id)!.body;
    body('heavy').setLinearVelocity({ x: 8, y: 0 });
    body('light').setLinearVelocity({ x: -8, y: 0 });
    run(world, 40);
    expect(Math.abs(world.state('light')!.vx + 8)).toBeGreaterThan(Math.abs(world.state('heavy')!.vx - 8));
  });
});

describe('경계', () => {
  it('local 공이 경계 밖으로 나가면 한 번만 탈락한다', () => {
    const world = new World(FLAT, 'classic');
    world.addBall('a', 33.5, 5, true);
    world.setInput('a', press('right'));
    const events = run(world, 60);
    const outs = events.filter((e) => e.type === 'out');
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ id: 'a', cause: 'fall' });
    expect(world.alive('a')).toBe(false);
    expect(world.balls()).toHaveLength(1);
    expect(run(world, 30).filter((e) => e.type === 'out')).toHaveLength(0);
  });

  it('원격 공은 스스로 탈락하지 않고 kill로만 탈락한다', () => {
    const world = new World(FLAT, 'classic');
    world.addBall('a', 33.5, 5, false);
    world.setInput('a', press('right'));
    run(world, 60);
    expect(world.alive('a')).toBe(true);
    world.kill('a');
    expect(world.alive('a')).toBe(false);
    world.kill('a');
  });
});

describe('화살 모드', () => {
  it('special을 누르면 방향 입력으로 움직이지 않는다', () => {
    const world = settled('arrows');
    world.setInput('a', press('special', 'right'));
    run(world, 30);
    expect(Math.abs(world.state('a')!.vx)).toBeLessThan(0.05);
  });
});
