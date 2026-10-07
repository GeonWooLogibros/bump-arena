/** 대기실 규칙. 방 코드, 이름, 색, 자리 순서, 방장 정하기를 맡습니다. */
import type { Match } from './round';

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ROOM_CODE_LENGTH = 5;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** 한 방에 들어올 수 있는 최대 인원입니다. */
export const MAX_PLAYERS = 6;

/** 이름의 최대 글자 수입니다. */
export const NAME_LIMIT = 12;

/** 공 색 여섯 가지입니다. fill은 안쪽, edge는 테두리입니다. */
export const COLORS: readonly { name: string; fill: string; edge: string }[] = [
  { name: '파랑', fill: '#3b82f6', edge: '#1d4ed8' },
  { name: '주황', fill: '#f97316', edge: '#c2410c' },
  { name: '초록', fill: '#22c55e', edge: '#15803d' },
  { name: '보라', fill: '#8b5cf6', edge: '#6d28d9' },
  { name: '노랑', fill: '#eab308', edge: '#a16207' },
  { name: '청록', fill: '#06b6d4', edge: '#0e7490' },
];

/** 헷갈리는 글자(0, o, 1, l, i)를 뺀 다섯 글자 방 코드를 만듭니다. */
export function makeRoomCode(rand: () => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return code;
}

/** 입력한 글자나 초대 링크에서 방 코드를 꺼냅니다. 올바른 코드가 없으면 null입니다. */
export function parseRoomCode(text: string): string | null {
  const tail = text.trim().toLowerCase().split('#').pop() ?? '';
  return CODE_PATTERN.test(tail) ? tail : null;
}

/** 방 코드로 만든 방 이름입니다. */
export function roomName(code: string): string {
  return `ba-${code}`;
}

/** 다른 사람이 보낸 이름을 화면에 쓸 수 있게 다듬습니다. 제어 문자와 보이지 않는 글자를 지우고 길이를 줄입니다. */
export function cleanName(value: unknown, fallback = '플레이어'): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').trim();
  return text ? Array.from(text).slice(0, NAME_LIMIT).join('') : fallback;
}

/** 방에 들어온 사람 한 명입니다. color는 COLORS의 번호, hosting은 방장 정보를 올리고 있는지입니다. */
export interface Seat {
  peer: string;
  since: number;
  color: number;
  hosting: boolean;
  /** 올리고 있는 경기가 진행된 정도(matchProgress). hosting인 사람에게만 뜻이 있고, 없으면 0으로 봅니다. */
  progress?: number;
}

/**
 * 경기가 진행된 정도를 숫자 하나로 만듭니다. 경기 번호, 라운드, 점수 합의 순서로 비교됩니다.
 * 대기실은 그 경기를 마치고 돌아온 상태이므로, 같은 경기 번호의 어떤 경기 중 상태보다 앞선 것으로 봅니다.
 */
export function matchProgress(match: Pick<Match, 'game' | 'phase' | 'round' | 'scores'>): number {
  if (match.phase === 'lobby') return match.game * 100000 + 99999;
  const total = Object.values(match.scores).reduce((sum, score) => sum + score, 0);
  return match.game * 100000 + Math.min(999, match.round) * 100 + Math.min(99, total);
}

/** 방에 들어온 순서(since, 같으면 peer 사전순)로 늘어놓습니다. */
export function seatOrder<T extends { peer: string; since: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.since - b.since || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
}

/**
 * 방장을 정합니다. 방장 정보를 올리고 있는 사람 가운데 경기가 가장 많이 진행된 사람(같으면 순서가 앞인 사람),
 * 아무도 없으면 전체에서 순서가 가장 앞인 사람입니다.
 */
export function pickHost(seats: readonly Seat[]): string | null {
  const ordered = seatOrder(seats);
  let host: Seat | undefined;
  for (const seat of ordered) {
    if (seat.hosting && (!host || (seat.progress ?? 0) > (host.progress ?? 0))) host = seat;
  }
  return (host ?? ordered[0])?.peer ?? null;
}

/** 순서가 앞선 사람과 색이 겹치면 아무도 쓰지 않는 가장 앞 번호의 색을 돌려줍니다. 겹치지 않으면 원래 색입니다. */
export function resolveColor(seats: readonly Seat[], me: string): number {
  const ordered = seatOrder(seats);
  const index = ordered.findIndex((s) => s.peer === me);
  if (index < 0) return 0;
  const color = ordered[index].color;
  if (!ordered.slice(0, index).some((s) => s.color === color)) return color;
  const used = new Set(ordered.map((s) => s.color));
  const free = COLORS.findIndex((_, i) => !used.has(i));
  return free < 0 ? color : free;
}

/** AI가 쓸 색입니다. 사람이 쓰지 않는 색을 앞 번호부터 count개 돌려줍니다. */
export function botColors(humanColors: readonly number[], count: number): number[] {
  const free = COLORS.map((_, i) => i).filter((i) => !humanColors.includes(i));
  return free.slice(0, count);
}
