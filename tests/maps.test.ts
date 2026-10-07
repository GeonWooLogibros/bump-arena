import { describe, expect, it } from 'vitest';
import { MAPS, RANDOM_MAP, nextMap, spawnSlot } from '../src/game/maps';
import { surfaceBelow } from '../src/physics/geometry';

describe('맵', () => {
  it('6개이고 id가 서로 다릅니다', () => {
    expect(MAPS).toHaveLength(6);
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(6);
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
  it('무작위일 때 직전 맵이 아닌 0~5번을 고릅니다', () => {
    for (let i = 0; i < 100; i++) {
      const picked = nextMap(RANDOM_MAP, 2, () => i / 100);
      expect(picked).not.toBe(2);
      expect(picked).toBeGreaterThanOrEqual(0);
      expect(picked).toBeLessThanOrEqual(5);
    }
    expect(nextMap(RANDOM_MAP, 2, () => 0.999999)).toBe(5);
  });

  it('고른 맵이 있으면 그대로 씁니다', () => {
    expect(nextMap(3, 3, () => 0.5)).toBe(3);
  });
});
