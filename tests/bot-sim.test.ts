import { beforeAll, describe, expect, it } from 'vitest';
import { Bot } from '../src/game/bot';
import type { BotSense } from '../src/game/bot';
import { MAPS } from '../src/game/maps';
import type { GameMap } from '../src/game/maps';
import { MODES, TUNING } from '../src/game/modes';
import type { Mode } from '../src/game/modes';
import { NO_INPUT, World } from '../src/physics/world';

/** 한 판의 제한 시간(초)입니다. 실제 라운드 제한과 같습니다. */
const LIMIT = TUNING.roundLimitMs / 1000;
/** 탈락 직전 이 시간(초) 안에 다른 공과 닿은 적이 없으면 자멸로 셉니다. */
const SELF_WINDOW = 2;
/** 두 공의 중심이 이 거리(m) 안이면 닿은 것으로 봅니다. */
const TOUCH = TUNING.radius * 2 + 0.15;
const SEEDS = [1, 2, 3, 4, 5];
const COUNTS = [2, 4];

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

/** 한 판의 결과입니다. outs는 탈락한 순서입니다. */
interface Game {
  mode: Mode;
  map: string;
  count: number;
  seconds: number;
  timeout: boolean;
  outs: { id: string; self: boolean }[];
  survivors: string[];
}

/** 시작 위치입니다. dummy가 있으면 그 공은 입력 없이 가만히 있습니다. */
interface Setup {
  bots: readonly (readonly [number, number])[];
  dummy?: readonly [number, number];
  limit: number;
}

/** 화면 없이 한 판을 돌립니다. Session이 하는 것과 같은 방법으로 AI에게 상황을 알려 줍니다. */
function play(mode: Mode, map: GameMap, setup: Setup, random: () => number): Game {
  const world = new World(map, mode);
  const bots = new Map<string, Bot>();
  setup.bots.forEach(([x, y], i) => {
    world.addBall(`bot${i + 1}`, x, y, true);
    bots.set(`bot${i + 1}`, new Bot(random));
  });
  if (setup.dummy) world.addBall('dummy', setup.dummy[0], setup.dummy[1], true);
  const touched = new Map<string, number>();
  const outs: Game['outs'] = [];
  let time = 0;
  let alive = bots.size + (setup.dummy ? 1 : 0);
  while (alive > 1 && time < setup.limit) {
    const views = world.balls().filter((b) => b.alive);
    for (let i = 0; i < views.length; i++) {
      for (let j = i + 1; j < views.length; j++) {
        if (Math.hypot(views[i].x - views[j].x, views[i].y - views[j].y) > TOUCH) continue;
        touched.set(views[i].id, time);
        touched.set(views[j].id, time);
      }
    }
    for (const [id, bot] of bots) {
      const me = world.state(id);
      if (!me) continue;
      const sense: BotSense = {
        map,
        mode,
        me,
        others: views.filter((b) => b.id !== id),
        roped: world.rope(id) !== null,
        charge: world.aim(id)?.charge ?? 0,
      };
      world.setInput(id, bot.think(sense, TUNING.step));
    }
    if (setup.dummy) world.setInput('dummy', NO_INPUT);
    for (const event of world.step()) {
      if (event.type !== 'out') continue;
      alive--;
      const self = event.cause === 'fall' && time - (touched.get(event.id) ?? -Infinity) > SELF_WINDOW;
      outs.push({ id: event.id, self });
    }
    time += TUNING.step;
  }
  const survivors = world
    .balls()
    .filter((b) => b.alive)
    .map((b) => b.id);
  return { mode, map: map.id, count: setup.bots.length, seconds: time, timeout: alive > 1, outs, survivors };
}

/** 시작 위치 6개를 섞어서 앞에서 count개를 고릅니다. */
function pickSpawns(map: GameMap, count: number, random: () => number): (readonly [number, number])[] {
  const slots = [...map.spawns];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots.slice(0, count);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function percent(part: number, whole: number): string {
  return `${(ratio(part, whole) * 100).toFixed(1)}%`;
}

/** 여러 판의 시간 초과 수, 길이 중앙값, 자멸 수를 한 줄로 적습니다. */
function line(label: string, games: Game[]): string {
  const outs = games.flatMap((g) => g.outs);
  const timeouts = games.filter((g) => g.timeout).length;
  const selfs = outs.filter((o) => o.self).length;
  return [
    label.padEnd(18),
    `시간 초과 ${String(timeouts).padStart(3)}/${String(games.length).padEnd(3)}`,
    `중앙값 ${median(games.map((g) => g.seconds))
      .toFixed(1)
      .padStart(5)}초`,
    `자멸 ${String(selfs).padStart(3)}/${String(outs.length).padEnd(3)} (${percent(selfs, outs.length)})`,
  ].join('  ');
}

/** 모드·맵별 측정값 표입니다. 기준에 못 미칠 때 읽습니다. */
function report(games: Game[]): string {
  const lines = [line('전체', games)];
  for (const { id: mode } of MODES) {
    const inMode = games.filter((g) => g.mode === mode);
    lines.push(line(mode, inMode));
    for (const map of MAPS) {
      lines.push(
        line(
          `  ${mode}/${map.id}`,
          inMode.filter((g) => g.map === map.id),
        ),
      );
    }
  }
  const arrows = games.filter((g) => g.mode === 'arrows');
  const quick = arrows.filter((g) => g.seconds <= 3).length;
  lines.push(`화살 모드에서 3초 안에 끝난 판 ${quick}/${arrows.length} (${percent(quick, arrows.length)})`);
  return `\n${lines.join('\n')}\n`;
}

describe('AI끼리 하는 모의 경기 180판', () => {
  let games: Game[] = [];
  let table = '';

  beforeAll(() => {
    games = [];
    MODES.forEach(({ id: mode }, m) => {
      MAPS.forEach((map, i) => {
        for (const count of COUNTS) {
          for (const seed of SEEDS) {
            const random = seeded(seed * 1000 + m * 100 + i * 10 + count);
            const bots = pickSpawns(map, count, random);
            games.push(play(mode, map, { bots, limit: LIMIT }, random));
          }
        }
      });
    });
    table = report(games);
    if (import.meta.env.VITE_BOT_SIM_REPORT) console.log(table);
  }, 20000);

  it('모드 3개 × 맵 6개 × AI 수 2개 × 시드 5개를 모두 돌린다', () => {
    expect(games).toHaveLength(180);
  });

  it('시간 초과로 끝나는 판이 전체의 15% 이하이다', () => {
    expect(ratio(games.filter((g) => g.timeout).length, games.length), table).toBeLessThanOrEqual(0.15);
  });

  it('어떤 모드·맵 조합도 10판 가운데 5판 넘게 시간 초과가 나지 않는다', () => {
    for (const { id: mode } of MODES) {
      for (const map of MAPS) {
        const timeouts = games.filter((g) => g.mode === mode && g.map === map.id && g.timeout).length;
        expect(timeouts, `${mode}/${map.id}${table}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('라운드 길이의 중앙값이 4초 이상 45초 이하이다', () => {
    const mid = median(games.map((g) => g.seconds));
    expect(mid, table).toBeGreaterThanOrEqual(4);
    expect(mid, table).toBeLessThanOrEqual(45);
  });

  it('화살 모드에서 3초 안에 끝나는 판이 20% 이하이다', () => {
    const arrows = games.filter((g) => g.mode === 'arrows');
    expect(ratio(arrows.filter((g) => g.seconds <= 3).length, arrows.length), table).toBeLessThanOrEqual(0.2);
  });

  it('아무와도 닿지 않고 혼자 떨어지는 탈락이 전체 탈락의 35% 이하이다', () => {
    const outs = games.flatMap((g) => g.outs);
    expect(outs.length, table).toBeGreaterThan(0);
    expect(ratio(outs.filter((o) => o.self).length, outs.length), table).toBeLessThanOrEqual(0.35);
  });
});

describe('가만히 있는 공과 AI 1명', () => {
  const flat = MAPS[0];
  /** 평지 맵 가운데입니다. */
  const center = [16, 11.9] as const;

  for (const [m, { id: mode, name }] of MODES.entries()) {
    it(`${name}: 60초 안에 AI가 이긴다(시드 5개 가운데 4개 이상)`, () => {
      const results = SEEDS.map((seed) => {
        const random = seeded(seed * 7919 + m);
        return play(mode, flat, { bots: pickSpawns(flat, 1, random), dummy: center, limit: 60 }, random);
      });
      const wins = results.filter((g) => !g.timeout && g.survivors[0] === 'bot1').length;
      const detail = results.map((g) => `${g.seconds.toFixed(1)}초 남은 공 ${g.survivors.join(',') || '없음'}`);
      expect(wins, `${mode}: ${detail.join(' / ')}`).toBeGreaterThanOrEqual(4);
    });
  }
});
