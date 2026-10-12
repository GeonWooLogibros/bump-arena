import { describe, expect, it } from 'vitest';
import { Effects, SHAKE_TIME, SPARK_COUNT, SPARK_LIFE, SPARK_MAX, SPARK_MIN, sparkCount } from '../src/render/effects';

describe('충돌 불꽃', () => {
  it('약한 충돌에는 튀지 않고 셀수록 많이 튄다', () => {
    expect(sparkCount(SPARK_MIN)).toBe(0);
    expect(sparkCount(0.5)).toBeGreaterThan(0);
    expect(sparkCount(1)).toBeGreaterThan(sparkCount(0.5));
    expect(sparkCount(1)).toBe(SPARK_COUNT);
    expect(sparkCount(9)).toBe(SPARK_COUNT);
  });

  it('충돌 지점에서 생긴다', () => {
    const effects = new Effects();
    effects.spark(4, 7, 0, 1, 1, '#fff');
    expect(effects.sparks).toHaveLength(SPARK_COUNT);
    for (const s of effects.sparks) {
      expect(s.x).toBe(4);
      expect(s.y).toBe(7);
      expect(s.color).toBe('#fff');
    }
  });

  it('부딪친 방향의 양옆으로 퍼진다', () => {
    const effects = new Effects();
    effects.spark(0, 0, 0, 1, 1, '#fff');
    expect(effects.sparks.some((s) => s.vx > 0)).toBe(true);
    expect(effects.sparks.some((s) => s.vx < 0)).toBe(true);
    // 옆으로 가는 빠르기가 부딪친 방향의 빠르기보다 큽니다.
    for (const s of effects.sparks) expect(Math.abs(s.vx)).toBeGreaterThan(Math.abs(s.vy));
  });

  it('상한을 넘겨 만들지 않는다', () => {
    const effects = new Effects();
    for (let i = 0; i < 30; i++) effects.spark(0, 0, 1, 0, 1, '#fff');
    expect(effects.sparks).toHaveLength(SPARK_MAX);
  });

  it('수명이 다하면 사라진다', () => {
    const effects = new Effects();
    effects.spark(0, 0, 1, 0, 1, '#fff');
    effects.update(SPARK_LIFE / 2);
    expect(effects.sparks).toHaveLength(SPARK_COUNT);
    expect(effects.sparks.every((s) => s.x !== 0 || s.y !== 0)).toBe(true);
    effects.update(SPARK_LIFE / 2 + 0.001);
    expect(effects.sparks).toHaveLength(0);
  });

  it('clear는 불꽃도 지운다', () => {
    const effects = new Effects();
    effects.spark(0, 0, 1, 0, 1, '#fff');
    effects.clear();
    expect(effects.sparks).toHaveLength(0);
  });
});

describe('화면 흔들림', () => {
  it('센 충돌에 흔들리고 시간이 지나면 멎는다', () => {
    const effects = new Effects();
    effects.hit(0.3);
    expect(effects.shake).toBe(0);
    effects.hit(1);
    expect(effects.shake).toBe(1);
    effects.update(SHAKE_TIME);
    expect(effects.shake).toBe(0);
  });

  it('움직임 줄이기가 켜져 있으면 흔들지 않는다', () => {
    const effects = new Effects();
    effects.hit(1);
    effects.reduced = true;
    expect(effects.shake).toBe(0);
    effects.update(SHAKE_TIME);
    effects.hit(1);
    effects.reduced = false;
    expect(effects.shake).toBe(0);
  });
});
