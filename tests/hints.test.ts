import { describe, expect, it } from 'vitest';
import { HINT_DIM, HINT_FADE_MS, HINT_HOLD_MS, hintOpacity, hintRows } from '../src/render/hints';

describe('hintRows', () => {
  it('모든 모드에서 이동과 뛰기를 먼저 보여 준다', () => {
    for (const mode of ['classic', 'grapple', 'arrows'] as const) {
      const rows = hintRows(mode);
      expect(rows[0]).toEqual({ keys: ['←', '→'], label: '이동' });
      expect(rows[1]).toEqual({ keys: ['스페이스'], label: '뛰기' });
    }
  });

  it('X 뒤에 그 모드의 동작 이름을 쓴다', () => {
    expect(hintRows('classic')[2]).toEqual({ keys: ['X'], mouse: 'left', label: '무거워지기' });
    expect(hintRows('grapple')[2]).toEqual({ keys: ['X'], mouse: 'left', label: '줄 걸기' });
    expect(hintRows('classic')).toHaveLength(3);
    expect(hintRows('grapple')).toHaveLength(3);
  });

  it('화살 모드에서는 겨누기, 모으기, 쏘기를 키와 마우스로 알려 준다', () => {
    expect(hintRows('arrows').slice(2)).toEqual([
      { keys: [], mouse: 'move', label: '마우스로 겨누기' },
      { keys: ['X'], mouse: 'left', label: '누르는 동안 힘 모으기' },
      { keys: ['방향키'], label: 'X로 모으는 동안 겨누기' },
      { keys: ['X'], mouse: 'left', label: '떼면 화살 쏘기' },
    ]);
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
