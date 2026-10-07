import { describe, expect, it } from 'vitest';
import { Bot, decide } from '../src/game/bot';
import type { BotSense } from '../src/game/bot';
import { MAPS } from '../src/game/maps';
import { NO_INPUT } from '../src/physics/world';

const flat = MAPS.find((m) => m.id === 'flat')!;
const sense = (over: Partial<BotSense> = {}): BotSense => ({
  map: flat,
  mode: 'classic',
  me: { x: 16, y: 11.9, vx: 0, vy: 0 },
  others: [],
  roped: false,
  charge: 0,
  ...over,
});

describe('decide', () => {
  it('발판 왼쪽 바깥에서는 발판 쪽(오른쪽)으로 갑니다', () => {
    expect(decide(sense({ me: { x: 3, y: 11, vx: 0, vy: 0 } }), NO_INPUT).right).toBe(true);
  });

  it('발판 위에서 상대가 오른쪽에 있으면 오른쪽으로 갑니다', () => {
    const input = decide(sense({ others: [{ x: 22, y: 11.9 }] }), NO_INPUT);
    expect(input.right).toBe(true);
    expect(input.left).toBe(false);
  });

  it('상대가 없으면 가만히 있습니다', () => {
    expect(decide(sense(), NO_INPUT)).toEqual(NO_INPUT);
  });

  it('클래식에서 상대가 1m 옆이면 무거워집니다', () => {
    expect(decide(sense({ others: [{ x: 17, y: 11.9 }] }), NO_INPUT).special).toBe(true);
    expect(decide(sense({ others: [{ x: 20, y: 11.9 }] }), NO_INPUT).special).toBe(false);
  });

  it('갈고리에서 발판 밖 허공에 떨어지는 중이면 줄을 겁니다', () => {
    const input = decide(sense({ mode: 'grapple', me: { x: 3, y: 11, vx: 0, vy: 5 } }), NO_INPUT);
    expect(input.special).toBe(true);
    expect(input.up).toBe(true);
  });

  it('화살에서 상대가 8m 옆이면 모으고, 0.6 모였으면 놓습니다', () => {
    const others = [{ x: 24, y: 11.9 }];
    expect(decide(sense({ mode: 'arrows', others, charge: 0 }), NO_INPUT).special).toBe(true);
    expect(decide(sense({ mode: 'arrows', others, charge: 0.6 }), NO_INPUT).special).toBe(false);
  });
});

describe('Bot', () => {
  it('0.15초마다 한 번만 입력을 바꿉니다', () => {
    const bot = new Bot();
    const right = sense({ others: [{ x: 22, y: 11.9 }] });
    const left = sense({ others: [{ x: 10, y: 11.9 }] });
    const first = bot.think(right, 0.05);
    expect(first.right).toBe(true);
    expect(bot.think(left, 0.05)).toEqual(first);
    expect(bot.think(left, 0.05)).toEqual(first);
    expect(bot.think(left, 0.05).left).toBe(true);
  });
});
