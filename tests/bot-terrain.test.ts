import { describe, expect, it } from 'vitest';
import { crossing, heightAt, leapSpeed, ledgeUnder, terrainOf } from '../src/game/bot-terrain';
import { MAPS, mapAt } from '../src/game/maps';

const map = (id: string) => MAPS.find((m) => m.id === id)!;

describe('terrainOf', () => {
  it('평지는 x 5~27, 높이 12.5인 자리 하나입니다', () => {
    const { ledges } = terrainOf(map('flat'));
    expect(ledges).toHaveLength(1);
    expect(ledges[0]).toMatchObject({ x0: 5, x1: 27 });
    expect(heightAt(ledges[0], 16)).toBeCloseTo(12.5);
  });

  it('같은 맵은 한 번만 계산합니다', () => {
    expect(terrainOf(map('flat'))).toBe(terrainOf(map('flat')));
  });

  it('두 섬은 자리 둘이고 서로 뛰어 건널 수 있습니다', () => {
    const { ledges, next } = terrainOf(map('islands'));
    expect(ledges.map((l) => [l.x0, l.x1])).toEqual([
      [3.5, 12.5],
      [19.5, 28.5],
    ]);
    expect(next[0][1]).toBe(1);
    expect(next[1][0]).toBe(0);
  });

  it('계단은 위에서 아래로만 건널 수 있습니다', () => {
    const { ledges, next } = terrainOf(map('steps'));
    expect(ledges).toHaveLength(3);
    // 왼쪽부터 아래 단, 가운데 단, 위 단입니다.
    expect(next[0][1]).toBe(-1);
    expect(next[1][2]).toBe(-1);
    expect(next[1][0]).toBe(0);
    expect(next[2][1]).toBe(1);
    expect(next[2][0]).toBeGreaterThanOrEqual(0);
  });

  it('그릇은 바닥과 양쪽 비탈이 걸어서 이어진 자리 하나입니다', () => {
    const { ledges } = terrainOf(map('bowl'));
    expect(ledges).toHaveLength(1);
    expect(ledges[0].x0).toBeLessThan(6);
    expect(ledges[0].x1).toBeGreaterThan(26);
    // 가장자리가 바닥보다 높습니다(y는 아래쪽이 양수).
    expect(heightAt(ledges[0], ledges[0].x0)).toBeLessThan(heightAt(ledges[0], 16) - 1);
  });

  it('기둥에서는 한 칸 건너 있는 기둥으로 갈 때 사이의 기둥을 먼저 거칩니다', () => {
    const terrain = terrainOf(map('pillars'));
    const at = (x: number) => ledgeUnder(terrain, x, 9.5);
    expect(terrain.next[at(5)][at(16)]).toBe(at(10.4));
    // 위에 떠 있는 발판에서는 내려올 수 있지만 기둥에서 올라갈 수는 없습니다.
    const top = ledgeUnder(terrain, 16, 5.1);
    expect(top).not.toBe(at(16));
    expect(terrain.next[top][at(10.4)]).toBe(at(10.4));
    expect(terrain.next[at(10.4)][top]).toBe(-1);
  });

  it('언덕은 가파르지 않은 꼭대기 부분만 자리로 봅니다', () => {
    const terrain = terrainOf(map('hill'));
    const dome = terrain.ledges[ledgeUnder(terrain, 16, 9)];
    expect(dome.x0).toBeGreaterThan(10);
    expect(dome.x1).toBeLessThan(22);
    expect(ledgeUnder(terrain, 8.5, 12)).toBe(-1);
  });
});

describe('ledgeUnder', () => {
  const terrain = terrainOf(map('flat'));

  it('발판 위에 있으면 그 자리를, 발판 밖이나 밑에 있으면 -1을 돌려줍니다', () => {
    expect(ledgeUnder(terrain, 16, 11.9)).toBe(0);
    expect(ledgeUnder(terrain, 16, 5)).toBe(0);
    expect(ledgeUnder(terrain, 3, 11.9)).toBe(-1);
    expect(ledgeUnder(terrain, 16, 15)).toBe(-1);
  });
});

describe('crossing', () => {
  it('두 섬 사이는 오른쪽으로 뛰고 건너편 끝에서 1m 안쪽에 내립니다', () => {
    const [left, right] = terrainOf(map('islands')).ledges;
    const way = crossing(left, right)!;
    expect(way).toMatchObject({ dir: 1, edge: 12.5, land: 20.5, span: 8 });
    expect(way.air).toBeCloseTo(0.9);
    // 자리 끝에서 멀리서 뛸수록 더 빨라야 합니다.
    expect(leapSpeed(way, 2)).toBeGreaterThan(leapSpeed(way, 0));
    expect(leapSpeed(way, 0)).toBeGreaterThan(0);
  });

  it('위아래로 겹치는 자리와 너무 높은 자리로는 건널 수 없습니다', () => {
    const steps = terrainOf(map('steps')).ledges;
    expect(crossing(steps[0], steps[1])).toBeNull();
    expect(crossing(steps[1], steps[0])).not.toBeNull();
    const flat = terrainOf(map('flat')).ledges[0];
    expect(crossing(flat, flat)).toBeNull();
  });
});

describe('움직이는 발판이 있는 맵', () => {
  // 승강기의 자리는 도형 순서대로 아래층(0), 위층(1), 승강기(2)입니다.
  const lift = map('lift');

  it('발판이 움직여도 자리의 번호가 바뀌지 않습니다', () => {
    for (const id of ['ferry', 'lift', 'seesaw']) {
      const first = terrainOf(mapAt(map(id), 0)).ledges;
      for (let t = 0; t < 16; t += 0.5) {
        const { ledges } = terrainOf(mapAt(map(id), t));
        expect(ledges, `${id} ${t}초`).toHaveLength(first.length);
        ledges.forEach((ledge, i) => {
          // 움직이지 않는 자리는 그대로이고, 움직이는 자리는 너비가 그대로입니다.
          expect(ledge.x1 - ledge.x0, `${id} ${t}초 ${i}`).toBeCloseTo(first[i].x1 - first[i].x0, 0);
        });
      }
    }
  });

  it('자리의 높이는 발판이 지금 있는 곳을 따릅니다', () => {
    expect(heightAt(terrainOf(mapAt(lift, 0)).ledges[2], 16)).toBeCloseTo(14);
    expect(heightAt(terrainOf(mapAt(lift, 4)).ledges[2], 16)).toBeCloseTo(9);
  });

  it('지금은 건널 수 없어도 발판이 오가는 동안 건널 수 있으면 길로 봅니다', () => {
    // 승강기가 아래에 있을 때에는 위층으로 바로 건널 수 없습니다.
    const { ledges, next } = terrainOf(mapAt(lift, 0));
    expect(crossing(ledges[2], ledges[1])).toBeNull();
    expect(next[0][1]).toBe(2);
    expect(next[2][1]).toBe(1);
    // 승강기가 위에 있을 때에도 길은 같습니다.
    expect(terrainOf(mapAt(lift, 4)).next).toEqual(next);
    expect(crossing(terrainOf(mapAt(lift, 4)).ledges[2], ledges[1])).not.toBeNull();
  });

  it('나룻배 맵에서는 배를 거쳐야 건너편으로 갈 수 있습니다', () => {
    const { ledges, next } = terrainOf(mapAt(map('ferry'), 0));
    expect(crossing(ledges[0], ledges[1])).toBeNull();
    expect(next[0][1]).toBe(2);
    expect(next[1][0]).toBe(2);
  });
});

describe('새 맵의 길', () => {
  it('어느 맵에서나 모든 시작 위치가 자리 위에 있습니다', () => {
    for (const m of MAPS) {
      const terrain = terrainOf(mapAt(m, 0));
      for (const [x, y] of m.spawns) expect(ledgeUnder(terrain, x, y), `${m.id} (${x}, ${y})`).toBeGreaterThanOrEqual(0);
    }
  });

  it('선반을 뺀 새 맵에서는 어느 자리에서나 다른 모든 자리로 갈 수 있습니다', () => {
    for (const m of MAPS.slice(6)) {
      // 선반의 위쪽 두 단은 내려올 수만 있습니다.
      if (m.id === 'shelves') continue;
      const { next } = terrainOf(mapAt(m, 0));
      next.forEach((row, from) => row.forEach((hop, to) => expect(hop, `${m.id} ${from}→${to}`).toBeGreaterThanOrEqual(0)));
    }
  });
});
