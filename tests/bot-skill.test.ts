import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, SKILLS, THINK_FLOOR, readDifficulty } from '../src/game/bot-skill';

describe('AI 수준', () => {
  it('쉬움, 보통, 어려움 세 가지이고 기본은 보통입니다', () => {
    expect(DIFFICULTIES.map((d) => d.id)).toEqual(['easy', 'normal', 'hard']);
    expect(DIFFICULTIES.map((d) => d.name)).toEqual(['쉬움', '보통', '어려움']);
    expect(DEFAULT_DIFFICULTY).toBe('normal');
  });

  it('모르는 값은 보통으로 읽습니다', () => {
    expect(readDifficulty('easy')).toBe('easy');
    expect(readDifficulty('hard')).toBe('hard');
    for (const value of [undefined, null, '', 'expert', 2, {}, ['hard']]) expect(readDifficulty(value)).toBe('normal');
  });
});

describe('수준별 조절값', () => {
  it('보통은 수준을 나누기 전의 값 그대로입니다', () => {
    expect(SKILLS.normal).toEqual({
      think: 0.15,
      notice: 0,
      edgeMargin: 0.45,
      chargeSpeed: 13,
      ramRange: 5,
      heavyChance: 0.7,
      stunRate: [0.08, 0.15],
      rescueDelay: [0.3, 0.6],
      firstShot: [2.5, 4],
      arrowRest: [0.2, 1],
      aimTolerance: 0.5,
    });
  });

  it('어느 수준도 사람이 낼 수 없는 간격으로 생각하지 않습니다', () => {
    expect(THINK_FLOOR).toBeGreaterThanOrEqual(0.1);
    for (const { id } of DIFFICULTIES) expect(SKILLS[id].think, id).toBeGreaterThanOrEqual(THINK_FLOOR);
  });

  it('수준이 높을수록 빨리 알아차리고, 정확히 겨누고, 세게 달려듭니다', () => {
    const { easy, normal, hard } = SKILLS;
    const rising = (pick: (s: typeof easy) => number) => [pick(easy), pick(normal), pick(hard)];
    const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
    for (const pick of [
      (s: typeof easy) => -(s.think + s.notice),
      (s: typeof easy) => -s.aimTolerance,
      (s: typeof easy) => s.chargeSpeed,
      (s: typeof easy) => s.ramRange,
      (s: typeof easy) => s.heavyChance,
      (s: typeof easy) => -s.stunRate[1],
      (s: typeof easy) => -s.firstShot[0],
      (s: typeof easy) => -s.arrowRest[1],
    ]) {
      expect(rising(pick)).toEqual(sorted(rising(pick)));
      expect(pick(hard)).toBeGreaterThan(pick(easy));
    }
  });

  it('쉬움은 보통보다 자리 끝을 더 조심합니다', () => {
    expect(SKILLS.easy.edgeMargin).toBeGreaterThan(SKILLS.normal.edgeMargin);
  });

  it('범위는 모두 최소가 최대보다 크지 않습니다', () => {
    for (const { id } of DIFFICULTIES) {
      for (const [min, max] of [SKILLS[id].stunRate, SKILLS[id].rescueDelay, SKILLS[id].firstShot, SKILLS[id].arrowRest]) {
        expect(min, id).toBeGreaterThanOrEqual(0);
        expect(max, id).toBeGreaterThanOrEqual(min);
      }
    }
  });
});
