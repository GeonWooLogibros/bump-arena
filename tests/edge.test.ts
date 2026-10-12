import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/game/modes';
import { EDGE_INSET, edgeMark } from '../src/render/edge';
import type { EdgeMark } from '../src/render/edge';

function mark(x: number, y: number): EdgeMark | null {
  const out: EdgeMark = { x: 0, y: 0, angle: 0, danger: 0 };
  return edgeMark(x, y, out) ? out : null;
}

describe('화면 밖 공의 표시', () => {
  it('화면 안의 공에는 표시하지 않는다', () => {
    expect(mark(16, 9)).toBeNull();
    expect(mark(0, 0)).toBeNull();
    expect(mark(TUNING.viewW, TUNING.viewH)).toBeNull();
  });

  it('왼쪽으로 나간 공은 왼쪽 가장자리에서 왼쪽을 가리킨다', () => {
    const m = mark(-1, 9)!;
    expect(m.x).toBe(EDGE_INSET);
    expect(m.y).toBe(9);
    expect(Math.cos(m.angle)).toBeCloseTo(-1);
    expect(m.danger).toBeCloseTo(0.5);
  });

  it('오른쪽 아래로 나간 공은 모서리에서 그쪽을 가리킨다', () => {
    const m = mark(TUNING.viewW + 1, TUNING.viewH + 1)!;
    expect(m.x).toBe(TUNING.viewW - EDGE_INSET);
    expect(m.y).toBe(TUNING.viewH - EDGE_INSET);
    expect(Math.cos(m.angle)).toBeGreaterThan(0);
    expect(Math.sin(m.angle)).toBeGreaterThan(0);
  });

  it('탈락 경계에 다가갈수록 위험도가 커지고 1을 넘지 않는다', () => {
    const near = mark(16, TUNING.viewH + 0.5)!.danger;
    const far = mark(16, TUNING.viewH + 1.5)!.danger;
    expect(far).toBeGreaterThan(near);
    expect(mark(16, TUNING.viewH + TUNING.boundsMargin)!.danger).toBe(1);
    expect(mark(-50, 9)!.danger).toBe(1);
  });

  it('위로 나간 공은 탈락하지 않으므로 위험도가 0이다', () => {
    const m = mark(16, -3)!;
    expect(m.y).toBe(EDGE_INSET);
    expect(Math.sin(m.angle)).toBeCloseTo(-1);
    expect(m.danger).toBe(0);
  });
});
