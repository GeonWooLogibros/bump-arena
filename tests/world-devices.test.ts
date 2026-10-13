import { describe, expect, it } from 'vitest';
import { mapAt, moveOffset } from '../src/game/maps';
import type { GameMap, Shape } from '../src/game/maps';
import { TUNING } from '../src/game/modes';
import type { Mode } from '../src/game/modes';
import { NO_INPUT, World } from '../src/physics/world';
import type { Input, WorldEvent } from '../src/physics/world';

const SPAWNS = [4, 5, 6, 7, 8, 9].map((x) => [x, 11.9] as const);

function mapOf(...shapes: Shape[]): GameMap {
  return { id: 'test', name: '시험', shapes, spawns: SPAWNS };
}

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

/** 가로로 6m를 6초마다 오가는 발판입니다. 윗면은 y 12.5입니다. */
const FERRY: Shape = { kind: 'box', x: 10, y: 13, w: 6, h: 1, move: { dx: 6, dy: 0, period: 6 } };
/** 세로로 4m를 5초마다 오르내리는 발판입니다. */
const LIFT: Shape = { kind: 'box', x: 16, y: 14, w: 6, h: 1, move: { dx: 0, dy: -4, period: 5 } };

/** 움직이는 발판의 지금 중심입니다. */
function center(world: World, index = 0): [number, number] {
  const shape = world.shapes()[index];
  if (shape.kind !== 'box') throw new Error('상자가 아닙니다.');
  return [shape.x, shape.y];
}

describe('moveOffset', () => {
  const move = { dx: 6, dy: -2, period: 4 };

  it('처음에는 제자리이고 반 주기 뒤에 가장 멀리 갔다가 한 주기 뒤에 돌아옵니다', () => {
    expect(moveOffset(move, 0).map(Math.abs)).toEqual([0, 0]);
    expect(moveOffset(move, 2)[0]).toBeCloseTo(6);
    expect(moveOffset(move, 2)[1]).toBeCloseTo(-2);
    expect(moveOffset(move, 4)[0]).toBeCloseTo(0);
    expect(moveOffset(move, 1)[0]).toBeCloseTo(3);
  });

  it('처음에는 멈춰 있다가 천천히 움직이기 시작합니다', () => {
    expect(Math.abs(moveOffset(move, TUNING.step)[0])).toBeLessThan(0.01);
  });

  it('0초보다 앞선 시간은 0초로 봅니다', () => {
    expect(moveOffset(move, -3).map(Math.abs)).toEqual([0, 0]);
  });
});

describe('mapAt', () => {
  it('움직이는 발판이 없으면 받은 맵을 그대로 돌려줍니다', () => {
    const map = mapOf({ kind: 'box', x: 16, y: 13, w: 22, h: 1 });
    expect(mapAt(map, 3)).toBe(map);
  });

  it('움직이는 발판만 그 시간의 위치로 옮깁니다', () => {
    const floor: Shape = { kind: 'box', x: 16, y: 16, w: 4, h: 1 };
    const at = mapAt(mapOf(floor, FERRY), 3);
    expect(at.shapes[0]).toBe(floor);
    expect(at.shapes[1]).toMatchObject({ x: 16, y: 13 });
  });

  it('같은 시간을 다시 물으면 같은 객체를 돌려줍니다', () => {
    const map = mapOf(FERRY);
    expect(mapAt(map, 1.5)).toBe(mapAt(map, 1.5));
  });
});

describe('움직이는 발판', () => {
  it('step에 준 시간의 위치에 놓입니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    for (let i = 1; i <= 90; i++) world.step(i * TUNING.step);
    expect(center(world)[0]).toBeCloseTo(10 + moveOffset(FERRY.move!, 1.5)[0], 9);
  });

  it('같은 시간이면 거쳐 온 길이 달라도 같은 위치입니다', () => {
    const smooth = new World(mapOf(FERRY), 'classic');
    for (let i = 1; i <= 180; i++) smooth.step(i * TUNING.step);
    // 시간이 건너뛰거나 뒤로 간 세계입니다.
    const jumpy = new World(mapOf(FERRY), 'classic');
    for (const t of [0.4, 0.4, 2.2, 1.1, 2.9, 3]) jumpy.step(t);
    jumpy.step(3);
    expect(center(jumpy)[0]).toBeCloseTo(center(smooth)[0], 9);
    // planck 물체도 같은 곳에 있어서, 그 위에 놓은 공이 떨어지지 않습니다.
    jumpy.addBall('a', center(jumpy)[0], 11.9, true);
    for (let i = 0; i < 60; i++) jumpy.step(3);
    expect(jumpy.state('a')!.y).toBeCloseTo(12, 1);
  });

  it('시간이 멈춰 있으면 움직이지 않습니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    for (let i = 0; i < 60; i++) world.step(0);
    expect(center(world)).toEqual([10, 13]);
  });

  it('시간을 주지 않으면 step마다 1/60초씩 흐릅니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    run(world, 180);
    expect(center(world)[0]).toBeCloseTo(16, 3);
  });

  it('가로로 움직이는 발판 위에 선 공이 발판과 함께 움직입니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    world.addBall('a', 10, 11.9, true);
    // 처음 내려앉는 동안 조금 밀린 뒤로는 발판 위의 같은 곳에 머뭅니다.
    run(world, 60);
    const settled = world.state('a')!.x - center(world)[0];
    expect(Math.abs(settled)).toBeLessThan(0.5);
    let worst = 0;
    for (let i = 0; i < 720; i++) {
      world.step();
      worst = Math.max(worst, Math.abs(world.state('a')!.x - center(world)[0] - settled));
    }
    expect(world.alive('a')).toBe(true);
    expect(worst).toBeLessThan(0.15);
    expect(world.state('a')!.y).toBeCloseTo(12, 1);
  });

  it('움직이는 발판 위에 뛰어내린 공이 발판 밖으로 밀려나지 않습니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    // 발판이 가장 빠르게 지나가는 1.5초에 맞춰 발판 가운데 위에서 떨어뜨립니다.
    for (let i = 1; i <= 80; i++) world.step(i * TUNING.step);
    world.addBall('a', center(world)[0] + 0.5, 11, true);
    run(world, 240);
    expect(world.alive('a')).toBe(true);
    expect(Math.abs(world.state('a')!.x - center(world)[0])).toBeLessThan(2.5);
    expect(world.state('a')!.y).toBeLessThan(12.1);
  });

  it('발판 위에서 좌우를 누르면 평지에서처럼 움직입니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    world.addBall('a', 10, 11.9, true);
    run(world, 30);
    world.setInput('a', press('right'));
    run(world, 30);
    const flat = new World(mapOf({ kind: 'box', x: 10, y: 13, w: 6, h: 1 }), 'classic');
    flat.addBall('a', 10, 11.9, true);
    run(flat, 30);
    flat.setInput('a', press('right'));
    run(flat, 30);
    const onFerry = world.state('a')!.x - center(world)[0];
    expect(onFerry).toBeGreaterThan(1);
    expect(onFerry).toBeCloseTo(flat.state('a')!.x - 10, 0);
  });

  it('세로로 움직이는 발판이 공을 태우고 오르내립니다', () => {
    const world = new World(mapOf(LIFT), 'classic');
    world.addBall('a', 16, 12.9, true);
    run(world, 150);
    expect(center(world)[1]).toBeCloseTo(10, 3);
    expect(world.state('a')!.y).toBeCloseTo(9, 1);
    run(world, 150);
    expect(world.state('a')!.y).toBeCloseTo(13, 1);
  });

  it.each([0.02, 0.05, 0.1, 0.2, 0.3, 0.4, -0.02, -0.05, -0.1, -0.2, -0.3, -0.4])(
    '시간이 %f초 튀어도 세로로 움직이는 발판에 탄 공이 떠오르거나 묻히지 않습니다',
    (jump) => {
      // 1.25초에는 발판이 가장 빠르게 올라가고 3.75초에는 가장 빠르게 내려갑니다.
      for (const from of [1.25, 3.75]) {
        const world = new World(mapOf(LIFT), 'classic');
        world.addBall('a', 16, 12.9, true);
        let time = 0;
        while (time < from) world.step((time += TUNING.step));
        time += jump;
        for (let i = 0; i < 180; i++) {
          world.step((time += TUNING.step));
          expect(world.alive('a')).toBe(true);
          const gap = center(world)[1] - 0.5 - (world.state('a')!.y + TUNING.radius);
          expect(gap).toBeLessThan(0.3);
          expect(gap).toBeGreaterThan(-0.3);
        }
      }
    },
  );

  it('발판을 바로 옮길 때 가로로 움직이는 발판에 탄 공도 함께 옮깁니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    world.addBall('a', 10, 11.9, true);
    for (let i = 1; i <= 90; i++) world.step(i * TUNING.step);
    const before = world.state('a')!.x - center(world)[0];
    // 1.5초 뒤로 건너뜁니다. 발판은 3m쯤 옮겨집니다.
    for (let i = 1; i <= 30; i++) world.step(3 + i * TUNING.step);
    expect(center(world)[0]).toBeGreaterThan(15);
    expect(Math.abs(world.state('a')!.x - center(world)[0] - before)).toBeLessThan(0.3);
    expect(world.state('a')!.y).toBeCloseTo(12, 1);
  });

  it('움직이는 발판 위에서도 뛸 수 있습니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    world.addBall('a', 10, 11.9, true);
    run(world, 60);
    world.setInput('a', press('up'));
    expect(run(world, 2).some((e) => e.type === 'jump')).toBe(true);
  });

  it('도중에 만든 세계는 발판을 지금 위치로 바로 옮기고 공을 날려 보내지 않습니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    world.addBall('a', 16, 11.9, true);
    world.step(3);
    expect(center(world)[0]).toBeCloseTo(16, 6);
    for (let i = 0; i < 30; i++) world.step(3);
    expect(world.state('a')!.x).toBeCloseTo(16, 0);
    expect(world.state('a')!.y).toBeCloseTo(12, 1);
  });

  it('AI가 읽는 지형은 0.1초마다 새 위치로 바뀝니다', () => {
    const world = new World(mapOf(FERRY), 'classic');
    run(world, 60);
    const first = world.footing();
    run(world, 3);
    expect(world.footing()).toBe(first);
    run(world, 6);
    expect(world.footing()).not.toBe(first);
    const box = world.footing().shapes[0];
    expect(box.kind === 'box' && Math.abs(box.x - center(world)[0])).toBeLessThan(0.3);
  });

  it('움직이는 발판이 없는 맵의 지형은 맵 그대로입니다', () => {
    const map = mapOf({ kind: 'box', x: 16, y: 13, w: 22, h: 1 });
    const world = new World(map, 'classic');
    run(world, 30);
    expect(world.footing()).toBe(map);
    expect(world.shapes()).toBe(map.shapes);
  });
});

describe('튕기는 발판', () => {
  /** 2m 위에서 떨어뜨린 공이 처음 튀어 오른 높이(m)입니다. */
  function rebound(bouncy: boolean): number {
    const world = new World(mapOf({ kind: 'box', x: 16, y: 13, w: 10, h: 1, bouncy }), 'classic');
    world.addBall('a', 16, 10, true);
    let fell = false;
    let top = Infinity;
    for (let i = 0; i < 240; i++) {
      world.step();
      const { y, vy } = world.state('a')!;
      if (vy < -1) fell = true;
      if (fell) top = Math.min(top, y);
      if (fell && vy > 1) break;
    }
    return 12 - top;
  }

  it('튕기는 발판에 닿은 충돌에는 표시가 붙습니다', () => {
    for (const bouncy of [false, true]) {
      const world = new World(mapOf({ kind: 'box', x: 16, y: 13, w: 10, h: 1, bouncy }), 'classic');
      world.addBall('a', 16, 10, true);
      const hits = run(world, 120).filter((e) => e.type === 'hit');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((e) => e.bouncy === bouncy)).toBe(true);
    }
  });

  it('보통 발판보다 공을 훨씬 높이 튕겨 냅니다', () => {
    const plain = rebound(false);
    const bouncy = rebound(true);
    expect(plain).toBeLessThan(1);
    expect(bouncy).toBeGreaterThan(2);
  });

  it('계속 튀어도 화면 위로 끝없이 솟지 않습니다', () => {
    const world = new World(mapOf({ kind: 'box', x: 16, y: 13, w: 10, h: 1, bouncy: true }), 'classic');
    world.addBall('a', 16, 10, true);
    let top = Infinity;
    for (let i = 0; i < 3600; i++) {
      world.step();
      top = Math.min(top, world.state('a')!.y);
    }
    // 튕겨 나가는 속력의 한도(12m/s)로 오르는 높이는 3.6m이므로, 공의 중심은 y 8.4 위로 가지 않습니다.
    expect(top).toBeGreaterThan(7);
  });
});

describe('움직이는 발판과 화살', () => {
  /** x 16에 선 공이 오른쪽으로 화살을 쏩니다. 벽은 x 24에서 위로 5m를 4초마다 오르내립니다. */
  function range(): World {
    const floor: Shape = { kind: 'box', x: 12, y: 13, w: 12, h: 1 };
    const wall: Shape = { kind: 'box', x: 24, y: 11.5, w: 1, h: 3, move: { dx: 0, dy: -5, period: 4 } };
    const world = new World(mapOf(floor, wall), 'arrows');
    world.addBall('a', 16, 11.9, true);
    return world;
  }

  function shoot(world: World): void {
    world.setAimPoint('a', [30, world.state('a')!.y]);
    world.setInput('a', press('special'));
    run(world, 60);
    world.setInput('a', NO_INPUT);
    run(world, 1);
  }

  it('발판이 지금 있는 곳에 꽂힙니다', () => {
    const world = range();
    // 4초(한 주기) 무렵에는 벽이 제자리로 돌아와 길을 막습니다.
    run(world, 180);
    shoot(world);
    const events = run(world, 30);
    expect(events.some((e) => e.type === 'stick')).toBe(true);
    expect(world.arrows()[0].x).toBeCloseTo(23.5, 1);
  });

  it('발판이 비켜나 있으면 처음 있던 자리를 그냥 지나갑니다', () => {
    const world = range();
    // 2초(반 주기) 무렵에는 벽이 5m 위에 있습니다.
    run(world, 60);
    shoot(world);
    const events = run(world, 30);
    expect(events.some((e) => e.type === 'stick')).toBe(false);
    expect(world.arrows()[0].x).toBeGreaterThan(25);
  });

  it('꽂힌 화살은 발판을 따라 움직이다가 3초 뒤 사라집니다', () => {
    const world = range();
    run(world, 180);
    shoot(world);
    run(world, 30);
    const [before] = world.arrows();
    expect(before.stuck).toBe(true);
    const wallBefore = center(world, 1)[1];
    run(world, 60);
    const [after] = world.arrows();
    const moved = center(world, 1)[1] - wallBefore;
    expect(Math.abs(moved)).toBeGreaterThan(1);
    expect(after.y - before.y).toBeCloseTo(moved, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    run(world, 150);
    expect(world.arrows()).toHaveLength(0);
  });

  it('받은 화살을 미리 진행할 때 발판이 그때 있던 위치로 판정합니다', () => {
    const world = range();
    run(world, 120);
    // 0.5초 전에 쏜 화살입니다. 그때에는 벽이 위에 있어서 지나갔습니다.
    world.syncShots('b', [{ id: 1, x: 16.7, y: 12, vx: 30, vy: -4, age: 0.5 }]);
    expect(world.arrows()[0].stuck).toBe(false);
    expect(world.arrows()[0].x).toBeGreaterThan(25);
  });
});

describe('움직이는 발판과 줄', () => {
  function hanging(mode: Mode = 'grapple', local = true): World {
    const top: Shape = { kind: 'box', x: 12, y: 6, w: 5, h: 0.6, move: { dx: 8, dy: 0, period: 8 } };
    const world = new World(mapOf(top, { kind: 'box', x: 16, y: 11, w: 30, h: 1 }), mode);
    world.addBall('a', 12, 9.9, local);
    return world;
  }

  it('발판이 지금 있는 곳에 걸리고 고정점이 발판을 따라 움직입니다', () => {
    const world = hanging();
    run(world, 120);
    world.setInput('a', press('special'));
    run(world, 1);
    const first = world.rope('a')!;
    const from = center(world)[0];
    expect(first[1]).toBeCloseTo(6.3, 1);
    expect(Math.abs(first[0] - from)).toBeLessThanOrEqual(2.5);
    run(world, 60);
    const moved = center(world)[0] - from;
    expect(moved).toBeGreaterThan(1);
    expect(world.rope('a')![0] - first[0]).toBeCloseTo(moved, 6);
    expect(world.balls()[0].rope).toEqual(world.rope('a'));
    // 줄에 매달린 공이 발판에 끌려갑니다.
    const anchor = world.rope('a')!;
    const p = world.state('a')!;
    expect(Math.hypot(anchor[0] - p.x, anchor[1] - p.y)).toBeLessThan(4);
  });

  it('원격 공의 줄은 고정점이 조금 어긋나게 와도 다시 걸지 않습니다', () => {
    const world = hanging('grapple', false);
    run(world, 120);
    const x = center(world)[0];
    world.setRope('a', [x, 6.3]);
    run(world, 6);
    const kept = world.rope('a')!;
    // 0.1초 전의 위치로 다시 받습니다.
    world.setRope('a', [x, 6.3]);
    expect(world.rope('a')).toEqual(kept);
    expect(kept[0]).not.toBeCloseTo(x, 3);
    // 멀리 떨어진 고정점은 새 줄입니다.
    world.setRope('a', [16, 10.5]);
    expect(world.rope('a')).toEqual([16, 10.5]);
  });
});
