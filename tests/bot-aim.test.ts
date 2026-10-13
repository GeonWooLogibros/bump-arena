import { describe, expect, it } from 'vitest';
import { aimShot, closest } from '../src/game/bot-aim';
import { arrowSpeed } from '../src/physics/arrows';
import { MAPS } from '../src/game/maps';
import type { GameMap } from '../src/game/maps';
import { TUNING } from '../src/game/modes';

const flat = MAPS.find((m) => m.id === 'flat')!;
const at = (x: number, y = 11.9) => ({ x, y });

describe('arrowSpeed', () => {
  it('0.2초 모으면 12m/s, 1초 모으면 30m/s이고 그 밖은 양 끝 값입니다', () => {
    expect(arrowSpeed(0.2)).toBeCloseTo(12);
    expect(arrowSpeed(0.6)).toBeCloseTo(21);
    expect(arrowSpeed(1)).toBeCloseTo(30);
    expect(arrowSpeed(0)).toBeCloseTo(12);
    expect(arrowSpeed(2)).toBeCloseTo(30);
  });
});

describe('closest', () => {
  it('수평으로 쏜 화살은 멀리 갈수록 아래로 떨어져서 같은 높이의 상대를 벗어납니다', () => {
    const near = closest(4, 0, 1, 0, 27);
    const far = closest(12, 0, 1, 0, 27);
    expect(near.miss).toBeLessThan(0.3);
    expect(far.miss).toBeGreaterThan(1);
    expect(far.time).toBeGreaterThan(near.time);
  });
});

describe('aimShot', () => {
  it('가까운 같은 높이의 상대는 수평으로 겨눕니다', () => {
    expect(aimShot(flat, at(16), at(20), 0.6, 0.4)?.dir).toEqual([1, 0]);
    expect(aimShot(flat, at(16), at(12), 0.6, 0.4)?.dir).toEqual([-1, 0]);
  });

  it('먼 같은 높이의 상대는 위쪽 대각선으로 겨눕니다', () => {
    const dir = aimShot(flat, at(6), at(26), 0.6, 0.4)!.dir;
    expect(dir[0]).toBeCloseTo(Math.SQRT1_2);
    expect(dir[1]).toBeCloseTo(-Math.SQRT1_2);
  });

  it('바로 위나 아래의 상대는 위나 아래로 겨눕니다', () => {
    expect(aimShot(flat, at(16), at(16, 7), 0.6, 0.4)?.dir).toEqual([0, -1]);
    expect(aimShot(flat, at(16, 5), at(16, 9), 0.6, 0.4)?.dir).toEqual([0, 1]);
  });

  it('모을 시간은 0.4~0.9초 안에서 prefer에 가장 가까운 것을 고릅니다', () => {
    // 4m 앞의 상대는 어느 세기로 쏴도 맞으므로 prefer 그대로입니다.
    expect(aimShot(flat, at(16), at(20), 0.55, 0.4)?.release).toBeCloseTo(0.55);
    // 5.5m 앞의 상대는 세게 쏴야 떨어지기 전에 닿습니다.
    const strong = aimShot(flat, at(16), at(21.5), 0.4, 0.4)!;
    expect(strong.release).toBeGreaterThan(0.6);
    expect(strong.release).toBeLessThanOrEqual(0.9 + 1e-9);
  });

  it('이미 from보다 오래 모았으면 그보다 짧은 시간은 고르지 않습니다', () => {
    expect(aimShot(flat, at(16), at(20), 0.4, 0.7)?.release).toBeGreaterThanOrEqual(0.7);
  });

  it('지금 겨누는 방향에서 돌리는 시간보다 일찍 놓아야 하는 세기는 고르지 않습니다', () => {
    // 위를 겨누고 있다가 오른쪽의 상대를 겨누려면 4분의 1바퀴를 돌려야 합니다.
    const quarter = Math.PI / 2 / TUNING.arrowTurnSpeed;
    const plan = aimShot(flat, at(16), at(20), 0.4, 0.4, 0.5, { aim: [0, -1], charge: 0 });
    expect(plan?.dir).toEqual([1, 0]);
    expect(plan!.release).toBeGreaterThanOrEqual(quarter);
    expect(plan!.release).toBeLessThan(quarter + 0.05);
    // 이미 0.3초를 모았으면 그만큼 더 늦게 놓습니다.
    const late = aimShot(flat, at(16), at(20), 0.4, 0.4, 0.5, { aim: [0, -1], charge: 0.3 });
    expect(late!.release).toBeGreaterThanOrEqual(0.3 + quarter);
    // 반 바퀴는 0.9초 안에 돌리고 놓을 수 없습니다.
    expect(aimShot(flat, at(16), at(20), 0.4, 0.4, 0.5, { aim: [-1, 0], charge: 0.3 })).toBeNull();
    // 이미 그쪽을 겨누고 있으면 바로 놓을 수 있습니다.
    expect(aimShot(flat, at(16), at(20), 0.4, 0.4, 0.5, { aim: [1, 0], charge: 0 })?.release).toBeCloseTo(0.4);
  });

  it('수평으로는 못 미치고 대각선으로는 넘어가는 거리에서는 null입니다', () => {
    expect(aimShot(flat, at(8), at(18), 0.6, 0.4)).toBeNull();
  });

  it('사이에 벽이 있으면 null입니다', () => {
    const walled: GameMap = { ...flat, shapes: [...flat.shapes, { kind: 'box', x: 18, y: 11, w: 0.5, h: 4 }] };
    expect(aimShot(flat, at(16), at(20), 0.6, 0.4)).not.toBeNull();
    expect(aimShot(walled, at(16), at(20), 0.6, 0.4)).toBeNull();
  });
});
