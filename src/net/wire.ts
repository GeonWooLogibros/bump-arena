/** 방에 올리는 값(presence)의 형식. 보내기 전에 줄이고, 받을 때는 믿지 않고 하나씩 검사합니다. */
import { readDifficulty } from '../game/bot-skill';
import { cleanName, COLORS } from '../game/lobby';
import { MAPS, RANDOM_MAP } from '../game/maps';
import { DEFAULT_SETTINGS } from '../game/round';
import type { Match, Phase } from '../game/round';
import { TARGETS, TUNING, readMode } from '../game/modes';
import type { ArrowShot } from '../physics/arrows';
import type { BallState } from '../physics/world';

/** 공 하나가 한 번에 들고 다니는 화살의 최대 수입니다. */
export const MAX_SHOTS = 8;

const PHASES: readonly Phase[] = ['lobby', 'countdown', 'play', 'roundEnd', 'matchEnd'];
const ID_LIMIT = 64;
/** 객체의 키로 쓰면 안 되는 id입니다. */
const RESERVED_IDS = ['__proto__', 'constructor', 'prototype'];
const INPUT_MAX = 63;
const ROSTER_LIMIT = 12;
const BOT_LIMIT = 5;
const MAX_ROUND = 1_000_000;
const MAX_MS = 600_000;
const MAX_SCORE = 99;
const POS_LIMIT = 1000;
const SPEED_LIMIT = 200;

/** 공 하나가 다른 사람에게 보내는 값입니다. */
export interface BallWire {
  b: BallState;
  i: number;
  a: boolean;
  rp: readonly [number, number] | null;
  /** dx, dy, charge */
  am: readonly [number, number, number] | null;
  ar: ArrowShot[];
  /** 무거워지기의 남은 효과(0~1)입니다. */
  h: number;
  /** 갈고리 충전량(0~1)입니다. */
  g: number;
  /** 줄을 쓸 수 없는 남은 시간(초)입니다. 0이면 잠겨 있지 않습니다. */
  l: number;
}

/** 방장이 올리는 경기 상태입니다. bs는 AI들의 공이고, t는 방장의 움직이는 발판이 놓인 시간(밀리초)입니다. */
export interface HostWire extends Match {
  bs: Record<string, BallWire>;
  t: number;
}

/** 방에서 읽어 낸 한 사람의 상태입니다. */
export interface PeerState {
  peer: string;
  me: boolean;
  name: string;
  color: number;
  ready: boolean;
  since: number;
  /** 공 상태가 속한 라운드 열쇠(game×1000+round). 경기 중이 아니면 0. */
  key: number;
  /** 보낼 때마다 오르는 번호. */
  n: number;
  ball: BallWire | null;
  host: HostWire | null;
  /** 화면이 가려져 있어서 방장을 맡지 않는다고 알린 사람인지 여부. */
  away: boolean;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** 유한한 숫자가 아니면 null, 맞으면 한도 안으로 자른 값입니다. */
function limited(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, limit) : null;
}

/** 0 이상 max 이하의 정수로 만듭니다. 숫자가 아니면 fallback입니다. */
function whole(value: unknown, max: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
}

function ranged(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

/** 0 이상 max 이하의 숫자로 만듭니다. 유한한 숫자가 아니면 fallback입니다. */
function within(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= ID_LIMIT && !RESERVED_IDS.includes(id);
}

/** 라운드마다 달라지는 열쇠입니다. */
export function roundKey(game: number, round: number): number {
  return game * 1000 + round;
}

function numbers(value: unknown, length: number, limit: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out: number[] = [];
  for (const item of value) {
    const n = limited(item, limit);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function decodeArrow(value: unknown): ArrowShot | null {
  if (!Array.isArray(value) || value.length !== 6) return null;
  const [id, x, y, vx, vy, age] = value;
  const parts = [limited(id, MAX_ROUND), limited(x, POS_LIMIT), limited(y, POS_LIMIT), limited(vx, SPEED_LIMIT),
    limited(vy, SPEED_LIMIT), limited(age, MAX_MS)];
  if (parts.some((p) => p === null)) return null;
  const [pid, px, py, pvx, pvy, page] = parts as number[];
  return { id: pid, x: px, y: py, vx: pvx, vy: pvy, age: page };
}

/** 공을 보낼 모양으로 줄입니다. 숫자는 소수 둘째 자리로 반올림합니다. */
export function encodeBall(ball: BallWire): Record<string, unknown> {
  const { b } = ball;
  return {
    b: [b.x, b.y, b.vx, b.vy, b.av].map(round2),
    i: ball.i,
    a: ball.a,
    rp: ball.rp ? ball.rp.map(round2) : null,
    am: ball.am ? ball.am.map(round2) : null,
    ar: ball.ar.slice(0, MAX_SHOTS).map((s) => [s.id, s.x, s.y, s.vx, s.vy, s.age].map(round2)),
    h: round2(ball.h),
    g: round2(ball.g),
    l: round2(ball.l),
  };
}

/**
 * 받은 값에서 공을 읽습니다. 좌표나 속도가 유한한 숫자가 아니면 공 전체를 null로 봅니다.
 * 남은 효과와 충전량이 없거나 숫자가 아니면 가득 찬 것으로, 잠긴 시간이 없거나 숫자가 아니면 잠기지 않은 것으로 봅니다.
 */
export function decodeBall(value: unknown): BallWire | null {
  if (!isDict(value) || !Array.isArray(value.b) || value.b.length !== 5) return null;
  const [x, y, vx, vy, av] = value.b;
  const px = limited(x, POS_LIMIT);
  const py = limited(y, POS_LIMIT);
  const pvx = limited(vx, SPEED_LIMIT);
  const pvy = limited(vy, SPEED_LIMIT);
  const pav = limited(av, SPEED_LIMIT);
  if (px === null || py === null || pvx === null || pvy === null || pav === null) return null;
  const rp = numbers(value.rp, 2, POS_LIMIT);
  const am = numbers(value.am, 3, POS_LIMIT);
  const arrows = Array.isArray(value.ar) ? value.ar.slice(0, MAX_SHOTS) : [];
  return {
    b: { x: px, y: py, vx: pvx, vy: pvy, av: pav },
    i: whole(value.i, INPUT_MAX),
    a: value.a === true,
    rp: rp ? [rp[0], rp[1]] : null,
    am: am ? [am[0], am[1], am[2]] : null,
    ar: arrows.map(decodeArrow).filter((s): s is ArrowShot => s !== null),
    h: within(value.h, 1, 1),
    g: within(value.g, 1, 1),
    l: within(value.l, TUNING.ropeLockTime, 0),
  };
}

/** 방장 상태를 보낼 모양으로 줄입니다. */
export function encodeHost(host: HostWire): Record<string, unknown> {
  const { bs, ...match } = host;
  return {
    ...match,
    bs: Object.fromEntries(Object.entries(bs).map(([id, ball]) => [id, encodeBall(ball)])),
  };
}

/** 받은 값에서 방장 상태를 읽습니다. 단계가 모르는 값이거나 설정이 없으면 null입니다. */
export function decodeHost(value: unknown): HostWire | null {
  if (!isDict(value) || !isDict(value.settings)) return null;
  const phase = PHASES.find((p) => p === value.phase);
  if (!phase) return null;
  const s = value.settings;
  const target = TARGETS.find((t) => t === s.target) ?? DEFAULT_SETTINGS.target;
  const scores: Record<string, number> = {};
  if (isDict(value.scores)) {
    for (const [id, score] of Object.entries(value.scores).slice(0, ROSTER_LIMIT)) {
      if (validId(id)) scores[id] = whole(score, MAX_SCORE);
    }
  }
  const bs: Record<string, BallWire> = {};
  if (isDict(value.bs)) {
    for (const [id, raw] of Object.entries(value.bs).slice(0, BOT_LIMIT)) {
      const ball = validId(id) ? decodeBall(raw) : null;
      if (ball) bs[id] = ball;
    }
  }
  return {
    settings: {
      mode: readMode(s.mode),
      target,
      mapSetting: ranged(s.mapSetting, RANDOM_MAP, MAPS.length - 1, DEFAULT_SETTINGS.mapSetting),
      bots: ranged(s.bots, 0, 5, DEFAULT_SETTINGS.bots),
      difficulty: readDifficulty(s.difficulty),
    },
    game: whole(value.game, MAX_ROUND),
    phase,
    ms: whole(value.ms, MAX_MS),
    round: whole(value.round, MAX_ROUND),
    map: ranged(value.map, 0, MAPS.length - 1, 0),
    scores,
    roster: Array.isArray(value.roster) ? value.roster.filter(validId).slice(0, ROSTER_LIMIT) : [],
    winner: validId(value.winner) ? value.winner : null,
    bs,
    t: whole(value.t, MAX_MS),
  };
}

/** presence를 읽습니다. 잘못된 값은 기본값(이름 '플레이어', 색 0, 준비 안 함, since 0, key 0, ball null, host null, away 아님)으로 바꿉니다. */
export function readPeer(peer: string, me: boolean, presence: Readonly<Record<string, unknown>>): PeerState {
  const color = presence.color;
  return {
    peer,
    me,
    name: cleanName(presence.name),
    color: typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < COLORS.length ? color : 0,
    ready: presence.ready === true,
    since: whole(presence.since, Number.MAX_SAFE_INTEGER),
    key: whole(presence.key, Number.MAX_SAFE_INTEGER),
    n: whole(presence.n, Number.MAX_SAFE_INTEGER),
    ball: decodeBall(presence.ball),
    host: decodeHost(presence.host),
    away: presence.away === true,
  };
}
