import { describe, expect, it } from 'vitest';
import { Bot } from '../src/game/bot';
import type { BotSense } from '../src/game/bot';
import { MAPS } from '../src/game/maps';
import { NO_INPUT } from '../src/physics/world';
import type { Input } from '../src/physics/world';

/** AI가 상황을 다시 보는 간격(초)입니다. */
const TICK = 0.15;

const map = (id: string) => MAPS.find((m) => m.id === id)!;
const flat = map('flat');

const sense = (over: Partial<BotSense> = {}): BotSense => ({
  map: flat,
  mode: 'classic',
  me: { x: 16, y: 11.9, vx: 0, vy: 0 },
  others: [],
  roped: false,
  charge: 0,
  ...over,
});

const at = (x: number, y = 11.9, vx = 0, vy = 0) => ({ x, y, vx, vy });
const foe = (x: number, y = 11.9, id = 'a') => ({ id, x, y });

/** 같은 상황을 seconds초 동안 보여 주고 생각할 때마다 고른 입력을 모읍니다. */
function watch(bot: Bot, situation: BotSense, seconds: number): Input[] {
  const inputs: Input[] = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) inputs.push({ ...bot.think(situation, TICK) });
  return inputs;
}

/** 시드가 고정된 난수(mulberry32)입니다. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('움직임', () => {
  it('발판 왼쪽 바깥 허공에서는 발판 쪽(오른쪽)으로 갑니다', () => {
    expect(new Bot(() => 0.5).think(sense({ me: at(3, 11) }), TICK).right).toBe(true);
  });

  it('발판 위에서 상대가 오른쪽에 있으면 오른쪽으로 갑니다', () => {
    const input = new Bot(() => 0.5).think(sense({ others: [foe(22)] }), TICK);
    expect(input.right).toBe(true);
    expect(input.left).toBe(false);
  });

  it('상대가 없으면 가만히 있습니다', () => {
    expect(new Bot(() => 0.5).think(sense(), TICK)).toEqual(NO_INPUT);
  });

  it('상대가 발판 밖에 있어도 발판 끝을 넘어가지 않습니다', () => {
    // 평지는 x가 5에서 27까지입니다. 상대는 오른쪽 끝 너머 허공에 있습니다.
    const others = [foe(29)];
    expect(new Bot(() => 0.5).think(sense({ me: at(20), others }), TICK).right).toBe(true);
    const near = new Bot(() => 0.5).think(sense({ me: at(26.4, 11.9, 3), others }), TICK);
    expect(near.right).toBe(false);
    expect(near.left).toBe(true);
  });

  it('0.15초마다 한 번만 입력을 바꿉니다', () => {
    const bot = new Bot(() => 0.5);
    const right = sense({ others: [foe(22)] });
    const left = sense({ others: [foe(10)] });
    const first = bot.think(right, 0.05);
    expect(first.right).toBe(true);
    expect(bot.think(left, 0.05)).toEqual(first);
    expect(bot.think(left, 0.05)).toEqual(first);
    expect(bot.think(left, 0.05).left).toBe(true);
  });

  it('세게 튕겨 나가면 잠깐 손을 놓았다가 다시 움직입니다', () => {
    const bot = new Bot(() => 0.5);
    bot.think(sense({ others: [foe(17)] }), TICK);
    // 오른쪽에 있던 상대에게 부딪쳐 왼쪽으로 8m/s로 튕겨 나갑니다.
    const thrown = sense({ me: at(15.5, 11.9, -8), others: [foe(17)] });
    for (const input of watch(bot, thrown, 0.3)) expect(input).toEqual(NO_INPUT);
    // 1.2초 뒤에는 정신을 차리고 4m 떨어진 상대에게 다시 달려듭니다.
    watch(bot, thrown, 0.9);
    const awake = bot.think(sense({ me: at(13), others: [foe(17)] }), TICK);
    expect(awake.left || awake.right).toBe(true);
  });
});

describe('목표 고르기', () => {
  it('가까운 상대를 더 자주 노리지만 먼 상대도 노립니다', () => {
    // 왼쪽 3m에 가까운 상대, 오른쪽 9m에 먼 상대가 있습니다.
    const others = [foe(13, 11.9, 'near'), foe(25, 11.9, 'far')];
    let near = 0;
    for (let seed = 1; seed <= 200; seed++) {
      if (new Bot(seeded(seed)).think(sense({ others }), TICK).left) near++;
    }
    expect(near).toBeGreaterThan(110);
    expect(near).toBeLessThan(190);
  });
});

describe('클래식', () => {
  it('상대가 1m 옆이면 무거워지고 4m 옆이면 무거워지지 않습니다', () => {
    expect(new Bot(() => 0.5).think(sense({ others: [foe(17)] }), TICK).special).toBe(true);
    expect(new Bot(() => 0.5).think(sense({ others: [foe(20)] }), TICK).special).toBe(false);
  });

  it('무거워지기는 0.5초 넘게 이어 쓰지 않고, 쓰는 시간보다 쉬는 시간이 깁니다', () => {
    const inputs = watch(new Bot(seeded(7)), sense({ others: [foe(17)] }), 12);
    let run = 0;
    let longest = 0;
    for (const input of inputs) {
      run = input.special ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const heavy = inputs.filter((input) => input.special).length;
    expect(heavy).toBeGreaterThan(0);
    expect(longest * TICK).toBeLessThanOrEqual(0.5 + TICK);
    expect(heavy).toBeLessThan(inputs.length / 2);
  });

  it('맞붙은 채 움직이지 못하면 1초 안에 물러나거나 뛰어넘습니다', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const inputs = watch(new Bot(seeded(seed)), sense({ others: [foe(17)] }), 1.2);
      expect(inputs.some((input) => input.left || input.up)).toBe(true);
    }
  });
});

describe('틈 건너기', () => {
  // 두 섬은 x가 3.5에서 12.5까지, 19.5에서 28.5까지이고 윗면의 y는 11.5입니다.
  const islands = map('islands');
  const across = [foe(24, 11)];

  it('상대가 건너편 섬에 있으면 섬 끝으로 달려가 뛰어서 건넙니다', () => {
    const walking = new Bot(() => 0).think(sense({ map: islands, me: at(8, 11), others: across }), TICK);
    expect(walking.right).toBe(true);
    expect(walking.up).toBe(false);
    const leaping = new Bot(() => 0).think(sense({ map: islands, me: at(11.5, 11, 6), others: across }), TICK);
    expect(leaping.right).toBe(true);
    expect(leaping.up).toBe(true);
  });

  it('속력이 모자라면 뛰지 않고 물러나 도움닫기합니다', () => {
    const input = new Bot(() => 0).think(sense({ map: islands, me: at(12, 11), others: across }), TICK);
    expect(input.up).toBe(false);
    expect(input.left).toBe(true);
  });

  it('닿을 수 없는 높은 발판으로는 뛰지 않고 발판 끝에서 멈춥니다', () => {
    // 계단의 아래 단은 x가 3.5에서 10.5까지이고, 상대는 3m 높은 가운데 단에 있습니다.
    const steps = map('steps');
    const above = [foe(16, 10)];
    const bot = new Bot(() => 0);
    expect(bot.think(sense({ map: steps, me: at(8, 13), others: above }), TICK).right).toBe(true);
    for (const input of watch(bot, sense({ map: steps, me: at(10.2, 13), others: above }), 3)) {
      expect(input.up).toBe(false);
      expect(input.right).toBe(false);
    }
  });
});

describe('갈고리', () => {
  it('발판 모서리 가까이에서 떨어지는 중이면 줄을 걸고, 멀리 떨어졌으면 걸지 않습니다', () => {
    // 평지의 왼쪽 위 모서리는 (5, 12.5)입니다.
    const near = new Bot(() => 0.5).think(sense({ mode: 'grapple', me: at(4.3, 13, 0, 5) }), TICK);
    expect(near.special).toBe(true);
    expect(near.up).toBe(true);
    expect(near.right).toBe(true);
    const far = new Bot(() => 0.5).think(sense({ mode: 'grapple', me: at(1, 14, 0, 5) }), TICK);
    expect(far.special).toBe(false);
  });

  it('발판 위에 서 있을 때는 줄을 걸지 않습니다', () => {
    const inputs = watch(new Bot(seeded(3)), sense({ mode: 'grapple', others: [foe(17)] }), 6);
    expect(inputs.some((input) => input.special)).toBe(false);
  });
});

describe('화살', () => {
  const arrows = (over: Partial<BotSense>) => sense({ mode: 'arrows', ...over });

  /** 모으는 만큼 charge를 올려 주면서 처음 쏠 때까지 돌립니다. 모으기 시작한 때와 놓은 때의 모은 시간을 돌려줍니다. */
  function shoot(bot: Bot, situation: BotSense): { startedAt: number; charge: number } {
    const step = 1 / 60;
    let charge = 0;
    let startedAt = -1;
    for (let time = 0; time < 10; time += step) {
      const input = bot.think({ ...situation, charge }, step);
      if (input.special) {
        if (startedAt < 0) startedAt = time;
        charge += step;
      } else if (startedAt >= 0) {
        return { startedAt, charge };
      }
    }
    throw new Error('10초 안에 쏘지 않았습니다.');
  }

  it('라운드가 시작되고 1.5~3초가 지나야 처음 모으기 시작하고, AI마다 그 시간이 다릅니다', () => {
    const near = arrows({ others: [foe(20)] });
    // 난수가 가장 작을 때 1.5초, 가장 클 때 3초입니다.
    const earliest = shoot(new Bot(() => 0), near).startedAt;
    const latest = shoot(new Bot(() => 0.999), near).startedAt;
    expect(earliest).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(earliest).toBeLessThanOrEqual(1.5 + TICK);
    expect(latest).toBeGreaterThanOrEqual(2.9);
    expect(latest).toBeLessThanOrEqual(3 + TICK);
  });

  it('0.4~0.9초 모아서 쏘고, 모으는 시간이 매번 다릅니다', () => {
    const near = arrows({ others: [foe(20)] });
    const charges = [1, 2, 3, 4, 5, 6].map((seed) => shoot(new Bot(seeded(seed)), near).charge);
    for (const charge of charges) {
      expect(charge).toBeGreaterThanOrEqual(0.4 - 1e-6);
      expect(charge).toBeLessThanOrEqual(0.9 + 1 / 60);
    }
    expect(new Set(charges.map((charge) => charge.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('맞힐 방향이 없으면 모으지 않고 움직입니다', () => {
    // 같은 높이에서 10m 떨어진 상대입니다. 수평으로는 가장 세게 쏴도 화살이 떨어져서 못 미치고,
    // 위쪽 대각선으로는 가장 약하게 쏴도 머리 위로 넘어갑니다.
    const inputs = watch(new Bot(() => 0.5), arrows({ me: at(8), others: [foe(18)] }), 4);
    expect(inputs.some((input) => input.special)).toBe(false);
    expect(inputs.some((input) => input.left || input.right)).toBe(true);
  });
});
