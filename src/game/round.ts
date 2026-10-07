import { RANDOM_MAP, nextMap } from './maps';
import { DEFAULT_TARGET, TUNING } from './modes';
import type { Mode } from './modes';

/** 경기 단계입니다. */
export type Phase = 'lobby' | 'countdown' | 'play' | 'roundEnd' | 'matchEnd';

/** 방장이 정하는 경기 설정입니다. */
export interface Settings {
  mode: Mode;
  target: number;
  mapSetting: number;
  bots: number;
}

/** 기본 설정입니다. 클래식, 5점, 무작위 맵, AI 1명입니다. */
export const DEFAULT_SETTINGS: Settings = { mode: 'classic', target: DEFAULT_TARGET, mapSetting: RANDOM_MAP, bots: 1 };

/** 방장이 관리하는 경기 상태입니다. */
export interface Match {
  settings: Settings;
  /** 경기를 시작할 때마다 1씩 오른다. */
  game: number;
  phase: Phase;
  /** 이 단계가 시작된 뒤 지난 시간(밀리초). */
  ms: number;
  round: number;
  map: number;
  scores: Record<string, number>;
  /** 이번 라운드에 참가한 사람과 AI의 id. 순서가 시작 위치를 정한다. */
  roster: string[];
  /** roundEnd에서는 라운드 승자(무승부면 null), matchEnd에서는 우승자. */
  winner: string | null;
}

/** 대기실 상태의 경기를 만듭니다. */
export function lobbyMatch(settings: Settings, game = 0): Match {
  return { settings, game, phase: 'lobby', ms: 0, round: 0, map: 0, scores: {}, roster: [], winner: null };
}

/** 대기실에서 경기를 시작합니다. ids는 참가할 사람과 AI입니다. 2명 미만이면 그대로 돌려줍니다. */
export function startMatch(match: Match, ids: readonly string[], random: () => number): Match {
  if (ids.length < 2) return match;
  return {
    ...match,
    game: match.game + 1,
    phase: 'countdown',
    ms: 0,
    round: 1,
    map: nextMap(match.settings.mapSetting, -1, random),
    scores: Object.fromEntries(ids.map((id) => [id, 0])),
    roster: [...ids],
    winner: null,
  };
}

/** dtMs만큼 진행합니다. alive는 지금 생존한 id, present는 다음 라운드에 참가할 id입니다. */
export function advance(
  match: Match,
  dtMs: number,
  alive: readonly string[],
  present: readonly string[],
  random: () => number,
): Match {
  const ms = match.ms + dtMs;
  switch (match.phase) {
    case 'countdown':
      return ms >= TUNING.countdownMs ? { ...match, phase: 'play', ms: 0 } : { ...match, ms };
    case 'play': {
      const survivors = alive.filter((id) => match.roster.includes(id));
      if (survivors.length <= 1 || ms >= TUNING.roundLimitMs) {
        const winner = survivors.length === 1 ? survivors[0] : null;
        const scores = winner === null ? match.scores : { ...match.scores, [winner]: (match.scores[winner] ?? 0) + 1 };
        return { ...match, phase: 'roundEnd', ms: 0, scores, winner };
      }
      return { ...match, ms };
    }
    case 'roundEnd': {
      if (ms < TUNING.roundEndMs) return { ...match, ms };
      const champion = Object.keys(match.scores).find((id) => match.scores[id] >= match.settings.target);
      if (champion !== undefined) return { ...match, phase: 'matchEnd', ms: 0, winner: champion };
      const scores = { ...match.scores };
      for (const id of present) scores[id] ??= 0;
      return {
        ...match,
        phase: 'countdown',
        ms: 0,
        round: match.round + 1,
        map: nextMap(match.settings.mapSetting, match.map, random),
        scores,
        roster: [...present],
        winner: null,
      };
    }
    default:
      return { ...match, ms };
  }
}

/** 방장이 최종 결과에서 대기실로 돌아갑니다. 설정과 경기 번호는 그대로입니다. */
export function toLobby(match: Match): Match {
  return lobbyMatch(match.settings, match.game);
}

/** AI id 목록입니다. count가 2이면 ['bot1', 'bot2']입니다. */
export function botIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `bot${i + 1}`);
}

/** id가 AI의 것인지 알려 줍니다. */
export function isBot(id: string): boolean {
  return /^bot\d+$/.test(id);
}
