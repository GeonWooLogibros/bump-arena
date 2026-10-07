import { describe, expect, it } from 'vitest';
import { decodeBall, decodeHost, encodeBall, encodeHost, readPeer, roundKey, MAX_SHOTS } from '../src/net/wire';
import type { BallWire, HostWire } from '../src/net/wire';
import { DEFAULT_SETTINGS } from '../src/game/round';

const json = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const ball = (): BallWire => ({
  b: { x: 1.234, y: -2.567, vx: 3.456, vy: 0.001, av: 9.999 },
  i: 3,
  a: true,
  rp: [4.444, 5.555],
  am: [0.1234, -0.5678, 0.9],
  ar: [{ id: 1, x: 1.111, y: 2.222, vx: 3.333, vy: 4.444, age: 0.555 }],
});

const host = (): HostWire => ({
  settings: { mode: 'arrows', target: 7, mapSetting: -1, bots: 2 },
  game: 3,
  phase: 'play',
  ms: 1234,
  round: 2,
  map: 4,
  scores: { a: 1, bot1: 2 },
  roster: ['a', 'bot1'],
  winner: null,
  bs: { bot1: ball() },
});

describe('roundKey', () => {
  it('경기 번호와 라운드를 합칩니다', () => {
    expect(roundKey(3, 2)).toBe(3002);
  });
});

describe('공 왕복', () => {
  it('소수 둘째 자리로 반올림해 같은 값을 돌려받습니다', () => {
    expect(decodeBall(json(encodeBall(ball())))).toEqual({
      b: { x: 1.23, y: -2.57, vx: 3.46, vy: 0, av: 10 },
      i: 3,
      a: true,
      rp: [4.44, 5.56],
      am: [0.12, -0.57, 0.9],
      ar: [{ id: 1, x: 1.11, y: 2.22, vx: 3.33, vy: 4.44, age: 0.56 }],
    });
  });

  it('x가 문자열, null, NaN, Infinity이면 공 전체가 null입니다', () => {
    for (const bad of ['1', null, NaN, Infinity, -Infinity]) {
      for (const index of [0, 1, 2, 3, 4]) {
        const wire = json(encodeBall(ball())) as { b: unknown[] };
        wire.b[index] = bad;
        expect(decodeBall(wire)).toBeNull();
      }
    }
  });

  it('i는 0~31의 정수로 맞춥니다', () => {
    const read = (i: unknown) => decodeBall({ ...(json(encodeBall(ball())) as object), i })?.i;
    expect([read(99), read(-4), read(5.9), read('x'), read(NaN), read(17)]).toEqual([31, 0, 5, 0, 0, 17]);
  });

  it('화살 5000개가 와도 8개만 남습니다', () => {
    const wire = json(encodeBall(ball())) as { ar: unknown[] };
    wire.ar = Array.from({ length: 5000 }, (_, i) => [i, 0, 0, 0, 0, 0]);
    expect(decodeBall(wire)?.ar).toHaveLength(MAX_SHOTS);
  });

  it('잘못된 화살 항목만 버립니다', () => {
    const wire = json(encodeBall(ball())) as { ar: unknown[] };
    wire.ar = [5, [1, 2, 3], [1, 'x', 0, 0, 0, 0], [7, 0, 0, 0, 0, 0]];
    expect(decodeBall(wire)?.ar.map((s) => s.id)).toEqual([7]);
  });

  it('좌표와 속도를 한도로 자릅니다', () => {
    const wire = json(encodeBall(ball())) as { b: number[] };
    wire.b = [5000, -5000, 999, -999, 0];
    expect(decodeBall(wire)?.b).toEqual({ x: 1000, y: -1000, vx: 200, vy: -200, av: 0 });
  });

  it('객체가 아니면 null입니다', () => {
    expect(decodeBall(null)).toBeNull();
    expect(decodeBall('x')).toBeNull();
    expect(decodeBall({})).toBeNull();
  });
});

describe('방장 상태 왕복', () => {
  it('같은 값을 돌려받습니다', () => {
    const decoded = decodeHost(json(encodeHost(host())));
    expect(decoded).toEqual({ ...host(), bs: { bot1: decodeBall(json(encodeBall(ball()))) } });
  });

  it('phase가 모르는 값이거나 settings가 없으면 null입니다', () => {
    expect(decodeHost({ ...(json(encodeHost(host())) as object), phase: 'x' })).toBeNull();
    expect(decodeHost({ ...(json(encodeHost(host())) as object), settings: undefined })).toBeNull();
  });

  it('점수가 음수이거나 문자열이면 0입니다', () => {
    const wire = { ...(json(encodeHost(host())) as object), scores: { a: -1, b: '3', c: 500, d: 2.7 } };
    expect(decodeHost(wire)?.scores).toEqual({ a: 0, b: 0, c: 99, d: 2 });
  });

  it('roster가 100개면 12개만 남기고 긴 id는 버립니다', () => {
    const roster = [...Array.from({ length: 100 }, (_, i) => `p${i}`), 'x'.repeat(65)];
    expect(decodeHost({ ...(json(encodeHost(host())) as object), roster })?.roster).toHaveLength(12);
    expect(decodeHost({ ...(json(encodeHost(host())) as object), roster: ['x'.repeat(65), 'ok'] })?.roster).toEqual(['ok']);
  });

  it('설정과 숫자를 범위 안으로 고정합니다', () => {
    const wire = {
      ...(json(encodeHost(host())) as object),
      settings: { mode: '?', target: 4, mapSetting: 99, bots: -3 },
      game: -5, round: 1e9, ms: 1e9, map: 77, winner: 5,
    };
    const decoded = decodeHost(wire);
    expect(decoded?.settings).toEqual({ mode: 'classic', target: 5, mapSetting: 5, bots: 0 });
    expect(decoded).toMatchObject({ game: 0, round: 1_000_000, ms: 600_000, map: 5, winner: null });
  });

  it('AI 공은 5개까지 남기고 잘못된 공은 버립니다', () => {
    const encoded = json(encodeHost(host())) as { bs: Record<string, unknown> };
    encoded.bs = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`bot${i}`, i === 0 ? 'bad' : encodeBall(ball())]));
    expect(Object.keys(decodeHost(json(encoded))?.bs ?? {})).toEqual(['bot1', 'bot2', 'bot3', 'bot4']);
  });
});

describe('위험한 id', () => {
  it('__proto__ 같은 키는 bs, scores, roster에 들어오지 못합니다', () => {
    const text = JSON.stringify(json(encodeHost(host())))
      .replace('"bs":{', '"bs":{"__proto__":' + JSON.stringify(encodeBall(ball())) + ',"constructor":' + JSON.stringify(encodeBall(ball())) + ',')
      .replace('"scores":{', '"scores":{"__proto__":{"x":1},"prototype":9,')
      .replace('"roster":[', '"roster":["__proto__",');
    const decoded = decodeHost(JSON.parse(text));
    expect(decoded).not.toBeNull();
    expect(Object.keys(decoded!.bs)).toEqual(['bot1']);
    expect(Object.keys(decoded!.scores)).toEqual(['a', 'bot1']);
    expect(decoded!.roster).toEqual(['a', 'bot1']);
    expect(Object.getPrototypeOf(decoded!.bs)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decoded!.scores)).toBe(Object.prototype);
    expect((decoded!.scores as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('readPeer', () => {
  it('빈 presence는 기본값입니다', () => {
    expect(readPeer('p', false, {})).toEqual({
      peer: 'p', me: false, name: '플레이어', color: 0, ready: false, since: 0, key: 0, n: 0, ball: null, host: null,
      away: false,
    });
  });

  it('잘못된 값도 기본값으로 바꿉니다', () => {
    for (const color of [99, 'x', 1.5, -1]) expect(readPeer('p', false, { color }).color).toBe(0);
    expect(readPeer('p', false, { name: 5 }).name).toBe('플레이어');
    for (const since of [NaN, Infinity, -Infinity]) expect(readPeer('p', false, { since }).since).toBe(0);
    expect(readPeer('p', false, { ready: 'yes' }).ready).toBe(false);
    expect(readPeer('p', false, { away: 1 }).away).toBe(false);
    expect(readPeer('p', false, { away: true }).away).toBe(true);
  });

  it('올바른 값은 그대로 읽습니다', () => {
    const presence = json({
      name: '건우', color: 3, ready: true, since: 10, key: 3002, n: 8,
      ball: encodeBall(ball()), host: encodeHost(host()),
    }) as Record<string, unknown>;
    const peer = readPeer('p', true, presence);
    expect(peer).toMatchObject({ me: true, name: '건우', color: 3, ready: true, since: 10, key: 3002, n: 8 });
    expect(peer.ball?.b.x).toBe(1.23);
    expect(peer.host?.settings.mode).toBe('arrows');
    expect(DEFAULT_SETTINGS.bots).toBe(1);
  });
});
