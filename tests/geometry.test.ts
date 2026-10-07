import { describe, expect, it } from 'vitest';
import { MAPS, type GameMap } from '../src/game/maps';
import { closestAbove, corners, nearestTop, segmentHit, surfaceBelow } from '../src/physics/geometry';

const byId = (id: string): GameMap => MAPS.find((m) => m.id === id)!;
const flat = byId('flat');

describe('corners', () => {
  it('상자는 꼭짓점 4개, 원은 null입니다', () => {
    expect(corners({ kind: 'box', x: 0, y: 0, w: 2, h: 2 })).toHaveLength(4);
    expect(corners({ kind: 'circle', x: 0, y: 0, r: 1 })).toBeNull();
  });
});

describe('closestAbove', () => {
  it('발판 아래에서는 아랫면의 가장 가까운 지점을 돌려줍니다', () => {
    const p = closestAbove(flat, 16, 15, 8)!;
    expect(p[0]).toBeCloseTo(16);
    expect(p[1]).toBeCloseTo(13.5);
  });

  it('위에 발판이 없으면 null입니다', () => {
    expect(closestAbove(flat, 16, 11, 8)).toBeNull();
  });

  it('reach 밖이면 null입니다', () => {
    expect(closestAbove(flat, 16, 25, 8)).toBeNull();
  });

  it('회전한 상자와 원에서도 입력보다 위의 지점을 돌려줍니다', () => {
    const cases: [string, number, number][] = [
      ['bowl', 16, 18],
      ['bowl', 3, 17],
      ['hill', 16, 12],
      ['hill', 8, 16],
    ];
    for (const [id, x, y] of cases) {
      const p = closestAbove(byId(id), x, y, 12);
      expect(p, `${id} (${x}, ${y})`).not.toBeNull();
      expect(p![1]).toBeLessThan(y);
    }
  });
});

describe('surfaceBelow', () => {
  it('아래의 발판 표면 y를 돌려줍니다', () => {
    expect(surfaceBelow(flat, 16, 5)).toBe(12.5);
  });

  it('아래에 발판이 없으면 null입니다', () => {
    expect(surfaceBelow(flat, 1, 5)).toBeNull();
  });
});

describe('segmentHit', () => {
  it('선분이 발판에 처음 닿는 지점을 돌려줍니다', () => {
    const p = segmentHit(flat, [16, 10], [16, 14])!;
    expect(p[1]).toBeCloseTo(12.5, 2);
  });

  it('발판을 지나지 않으면 null입니다', () => {
    expect(segmentHit(flat, [1, 5], [1, 14])).toBeNull();
  });

  it('원에도 닿습니다', () => {
    const p = segmentHit(byId('hill'), [16, 5], [16, 12])!;
    expect(p[1]).toBeCloseTo(10, 2);
  });
});

describe('nearestTop', () => {
  it('가장 가까운 발판의 윗면 가운데를 돌려줍니다', () => {
    const p = nearestTop(byId('islands'), 3, 5);
    expect(p[0]).toBeCloseTo(8);
    expect(p[1]).toBeCloseTo(11.5);
  });
});
