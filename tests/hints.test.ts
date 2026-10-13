import { describe, expect, it } from 'vitest';
import { HINT_DIM, HINT_FADE_MS, HINT_HOLD_MS, hintOpacity, hintRows } from '../src/render/hints';

describe('hintRows', () => {
  it('모든 모드에서 이동, 뛰기, 무거워지기를 먼저 보여 준다', () => {
    for (const mode of ['classic', 'grapple', 'arrows'] as const) {
      const rows = hintRows(mode);
      expect(rows[0]).toEqual({ keys: ['←', '→'], label: '이동' });
      expect(rows[1]).toEqual({ keys: ['↑', '스페이스'], label: '뛰기' });
      expect(rows[2]).toEqual({ keys: ['X'], mouse: 'right', label: '무거워지기' });
    }
  });

  it('클래식에는 특수 동작이 없다', () => {
    expect(hintRows('classic')).toHaveLength(3);
  });

  it('갈고리 모드에서는 Z와 마우스 왼쪽 버튼으로 줄을 건다고 알려 준다', () => {
    expect(hintRows('grapple').slice(3)).toEqual([{ keys: ['Z'], mouse: 'left', label: '누르는 동안 줄 걸기' }]);
  });

  it('화살 모드에서는 모아서 쏘는 것과 좌우 키나 마우스로 겨누는 것을 알려 준다', () => {
    expect(hintRows('arrows').slice(3)).toEqual([
      { keys: ['Z'], mouse: 'left', label: '모았다가 떼어 쏘기' },
      { keys: ['←', '→'], mouse: 'move', label: '모으는 동안 겨누기' },
    ]);
  });

  it('안내는 다섯 줄을 넘지 않는다', () => {
    for (const mode of ['classic', 'grapple', 'arrows'] as const) expect(hintRows(mode).length).toBeLessThanOrEqual(5);
  });

  it('문구에 "주세요"를 쓰지 않는다', () => {
    for (const mode of ['classic', 'grapple', 'arrows'] as const) {
      for (const row of hintRows(mode)) expect(row.label).not.toMatch(/주세요|해요/);
    }
  });
});

describe('hintOpacity', () => {
  it('카운트다운 동안에는 또렷하다', () => {
    expect(hintOpacity('countdown', 0)).toBe(1);
    expect(hintOpacity('countdown', 2999)).toBe(1);
  });

  it('경기가 시작되고 몇 초 뒤에 흐려져서 낮은 값에 머문다', () => {
    expect(hintOpacity('play', 0)).toBe(1);
    expect(hintOpacity('play', HINT_HOLD_MS)).toBe(1);
    expect(hintOpacity('play', HINT_HOLD_MS + HINT_FADE_MS / 2)).toBeCloseTo((1 + HINT_DIM) / 2);
    expect(hintOpacity('play', HINT_HOLD_MS + HINT_FADE_MS)).toBeCloseTo(HINT_DIM);
    expect(hintOpacity('play', 90000)).toBeCloseTo(HINT_DIM);
    expect(HINT_DIM).toBeGreaterThan(0);
    expect(HINT_DIM).toBeLessThan(0.5);
  });

  it('그 밖의 단계에서는 보이지 않는다', () => {
    for (const phase of ['lobby', 'roundEnd', 'matchEnd'] as const) expect(hintOpacity(phase, 0)).toBe(0);
  });
});
