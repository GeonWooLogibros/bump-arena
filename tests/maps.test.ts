import { describe, expect, it } from 'vitest';
import { MAPS, RANDOM_MAP, mapAt, nextMap, spawnSlot } from '../src/game/maps';
import type { GameMap, Shape } from '../src/game/maps';
import { TUNING } from '../src/game/modes';
import { corners, nearestOnSegment, surfaceBelow } from '../src/physics/geometry';

function moving(shape: Shape): boolean {
  return shape.kind === 'box' && shape.move !== undefined;
}

/** (x, y)에서 가장 가까운 발판 표면까지의 거리입니다. 발판 안이면 0입니다. */
function closestSurface(map: GameMap, x: number, y: number): number {
  let best = Infinity;
  for (const shape of map.shapes) {
    if (shape.kind === 'circle') {
      best = Math.min(best, Math.max(0, Math.hypot(x - shape.x, y - shape.y) - shape.r));
      continue;
    }
    const pts = corners(shape) ?? [];
    let inside = true;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const near = nearestOnSegment(a, b, x, y);
      best = Math.min(best, Math.hypot(near[0] - x, near[1] - y));
      const side = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      const first = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]);
      if (side * first < 0) inside = false;
    });
    if (inside) return 0;
  }
  return best;
}

/** 기울지 않은 두 상자 사이의 빈 거리입니다. 상자가 아니거나 기울었으면 넉넉한 값으로 봅니다. */
function boxGap(a: Shape, b: Shape): number {
  if (a.kind !== 'box' || b.kind !== 'box' || a.angle || b.angle) return Infinity;
  const dx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
  const dy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) || Math.max(dx, dy);
}

describe('맵', () => {
  it('16개이고 id와 이름이 서로 다릅니다', () => {
    expect(MAPS).toHaveLength(16);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(16);
    expect(new Set(MAPS.map((m) => m.name)).size).toBe(16);
  });

  it('처음 6개는 예전 순서 그대로입니다', () => {
    expect(MAPS.slice(0, 6).map((m) => m.id)).toEqual(['flat', 'islands', 'steps', 'bowl', 'pillars', 'hill']);
  });

  it('새 맵 가운데 움직이는 발판이 있는 맵이 3개 이상, 튕기는 발판이 있는 맵이 2개 이상입니다', () => {
    const added = MAPS.slice(6);
    expect(added.filter((m) => m.shapes.some(moving)).length).toBeGreaterThanOrEqual(3);
    expect(added.filter((m) => m.shapes.some((s) => s.bouncy)).length).toBeGreaterThanOrEqual(2);
  });

  it('시작 위치가 6개씩 있습니다', () => {
    for (const m of MAPS) expect(m.spawns).toHaveLength(6);
  });

  it('시작 위치 아래 0.5~0.8m에 발판 표면이 있습니다', () => {
    for (const m of MAPS) {
      for (const [x, y] of m.spawns) {
        const surface = surfaceBelow(m, x, y);
        expect(surface, `${m.id} (${x}, ${y})`).not.toBeNull();
        const gap = surface! - y;
        expect(gap, `${m.id} (${x}, ${y})`).toBeGreaterThanOrEqual(0.5);
        expect(gap, `${m.id} (${x}, ${y})`).toBeLessThanOrEqual(0.8);
      }
    }
  });

  it('시작 위치는 움직이는 발판 위에 있지 않습니다', () => {
    for (const m of MAPS) {
      const still: GameMap = { ...m, shapes: m.shapes.filter((s) => !moving(s)) };
      for (const [x, y] of m.spawns) {
        expect(surfaceBelow(still, x, y), `${m.id} (${x}, ${y})`).toBe(surfaceBelow(m, x, y));
      }
    }
  });

  it('시작 위치는 튕기는 발판 위에 있지 않습니다', () => {
    for (const m of MAPS) {
      const plain: GameMap = { ...m, shapes: m.shapes.filter((s) => !s.bouncy) };
      for (const [x, y] of m.spawns) {
        expect(surfaceBelow(plain, x, y), `${m.id} (${x}, ${y})`).toBe(surfaceBelow(m, x, y));
      }
    }
  });

  it('시작 위치의 공이 발판이나 다른 공과 겹치지 않습니다', () => {
    for (const m of MAPS) {
      m.spawns.forEach(([x, y], i) => {
        expect(closestSurface(m, x, y), `${m.id} (${x}, ${y})`).toBeGreaterThan(TUNING.radius);
        m.spawns.slice(i + 1).forEach(([ox, oy]) => {
          expect(Math.hypot(ox - x, oy - y), `${m.id} (${x}, ${y})`).toBeGreaterThan(TUNING.radius * 2 + 0.2);
        });
      });
    }
  });

  it('움직이는 발판은 어느 때에도 다른 발판과 공 하나가 지나갈 만큼 떨어져 있습니다', () => {
    for (const m of MAPS) {
      if (!m.shapes.some(moving)) continue;
      for (let t = 0; t < 30; t += 0.05) {
        const { shapes } = mapAt(m, t);
        shapes.forEach((a, i) => {
          if (!moving(a)) return;
          shapes.forEach((b, j) => {
            if (i !== j) expect(boxGap(a, b), `${m.id} ${t.toFixed(2)}초 ${i}-${j}`).toBeGreaterThanOrEqual(1.2 - 1e-9);
          });
        });
      }
    }
  });

  it('움직이는 발판은 화면 안에서만 다니고 공이 따라갈 수 있을 만큼 천천히 움직입니다', () => {
    for (const m of MAPS) {
      for (const s of m.shapes) {
        if (s.kind !== 'box' || !s.move) continue;
        for (const [x, y] of [
          [s.x, s.y],
          [s.x + s.move.dx, s.y + s.move.dy],
        ]) {
          expect(x - s.w / 2, m.id).toBeGreaterThanOrEqual(0);
          expect(x + s.w / 2, m.id).toBeLessThanOrEqual(TUNING.viewW);
          expect(y - s.h / 2, m.id).toBeGreaterThanOrEqual(0);
          expect(y + s.h / 2, m.id).toBeLessThanOrEqual(TUNING.viewH);
        }
        // 가장 빠를 때의 속력(m/s)과 가장 크게 바뀔 때의 가속(m/s²)입니다.
        const reach = Math.hypot(s.move.dx, s.move.dy);
        expect((Math.PI * reach) / s.move.period, m.id).toBeLessThanOrEqual(2.5);
        expect((reach / 2) * ((2 * Math.PI) / s.move.period) ** 2, m.id).toBeLessThanOrEqual(3);
      }
    }
  });

  it('시작 위치가 화면 안에 있습니다', () => {
    for (const m of MAPS) {
      for (const [x, y] of m.spawns) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(32);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(18);
      }
    }
  });
});

describe('spawnSlot', () => {
  it('라운드가 바뀌면 같은 사람의 위치가 바뀝니다', () => {
    expect(spawnSlot(0, 1)).not.toBe(spawnSlot(0, 2));
  });

  it('같은 라운드에서 6명이 서로 다른 번호를 받습니다', () => {
    for (let round = 0; round < 8; round++) {
      const slots = [0, 1, 2, 3, 4, 5].map((i) => spawnSlot(i, round));
      expect(new Set(slots).size).toBe(6);
    }
  });
});

describe('nextMap', () => {
  it('무작위일 때 직전 맵이 아닌 0~15번을 고릅니다', () => {
    for (let i = 0; i < 100; i++) {
      const picked = nextMap(RANDOM_MAP, 2, () => i / 100);
      expect(picked).not.toBe(2);
      expect(picked).toBeGreaterThanOrEqual(0);
      expect(picked).toBeLessThanOrEqual(15);
    }
    expect(nextMap(RANDOM_MAP, 2, () => 0.999999)).toBe(15);
  });

  it('직전 맵이 없으면(-1) 0번을 포함한 모든 맵이 나옵니다', () => {
    expect(nextMap(RANDOM_MAP, -1, () => 0)).toBe(0);
    const seen = new Set<number>();
    for (let i = 0; i < 160; i++) seen.add(nextMap(RANDOM_MAP, -1, () => i / 160));
    expect(seen.size).toBe(16);
  });

  it('직전 맵이 2번이면 2번이 나오지 않습니다', () => {
    for (let i = 0; i < 60; i++) expect(nextMap(RANDOM_MAP, 2, () => i / 60)).not.toBe(2);
  });

  it('고른 맵이 있으면 그대로 씁니다', () => {
    expect(nextMap(3, 3, () => 0.5)).toBe(3);
  });
});
