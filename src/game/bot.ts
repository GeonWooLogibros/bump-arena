import type { GameMap } from './maps';
import type { Mode } from './modes';
import { NO_INPUT } from '../physics/world';
import type { Input } from '../physics/world';
import { nearestTop, surfaceBelow } from '../physics/geometry';

/** AI가 한 번 고른 입력을 유지하는 시간(초)입니다. */
const THINK_INTERVAL = 0.15;
/** 발판 끝을 알아보려고 진행 방향으로 내다보는 거리(m)입니다. */
const EDGE_LOOKAHEAD = 1;
/** 상대가 이만큼 이상 높이 있으면 점프합니다(m). */
const JUMP_IF_ABOVE = 1.5;
/** 클래식에서 이 거리보다 가까우면 무거워집니다(m). */
const CLASSIC_RANGE = 1.6;
/** 화살로 겨냥하는 최대 거리(m)입니다. */
const ARROW_RANGE = 12;
/** 화살에서 높이 차가 이만큼 이상이면 위아래도 겨냥합니다(m). */
const ARROW_AIM_VERTICAL = 2;
/** 화살 힘이 이 비율 이상 모이면 놓습니다. */
const ARROW_RELEASE_CHARGE = 0.5;

/** AI가 보는 상황입니다. */
export interface BotSense {
  map: GameMap;
  mode: Mode;
  me: { x: number; y: number; vx: number; vy: number };
  /** 생존한 다른 공. */
  others: readonly { x: number; y: number }[];
  roped: boolean;
  /** 지금 모은 시간 비율 0~1. */
  charge: number;
}

/** 목표 x 쪽으로 좌우 입력을 만듭니다. */
function toward(from: number, to: number): Input {
  return { ...NO_INPUT, left: to < from, right: to > from };
}

/** 지금 상황에서 고를 입력입니다(시간 제한 없이). */
export function decide(sense: BotSense, _held: Input): Input {
  const { map, mode, me, others } = sense;
  const below = surfaceBelow(map, me.x, me.y);
  const ahead = surfaceBelow(map, me.x + Math.sign(me.vx) * EDGE_LOOKAHEAD, me.y);
  if (below === null || ahead === null) {
    const top = nearestTop(map, me.x, me.y);
    const input = toward(me.x, top[0]);
    if (below === null && me.vy > 0) {
      input.up = true;
      if (mode === 'grapple') input.special = true;
    }
    return input;
  }

  let nearest: { x: number; y: number } | null = null;
  let nearestDist = Infinity;
  for (const o of others) {
    const d = Math.hypot(o.x - me.x, o.y - me.y);
    if (d < nearestDist) {
      nearest = o;
      nearestDist = d;
    }
  }
  if (nearest === null) return { ...NO_INPUT };

  const input = toward(me.x, nearest.x);
  if (me.y - nearest.y >= JUMP_IF_ABOVE) input.up = true;
  if (mode === 'classic' && nearestDist < CLASSIC_RANGE) input.special = true;
  if (mode === 'arrows' && nearestDist <= ARROW_RANGE) {
    const dy = nearest.y - me.y;
    input.special = sense.charge < ARROW_RELEASE_CHARGE;
    input.up = dy <= -ARROW_AIM_VERTICAL;
    input.down = dy >= ARROW_AIM_VERTICAL;
  }
  return input;
}

/** 0.15초마다 한 번만 입력을 바꾸는 AI입니다. */
export class Bot {
  private held: Input = { ...NO_INPUT };
  private elapsed = THINK_INTERVAL;

  /** dt초가 지난 뒤 낼 입력입니다. 생각할 때가 아니면 지난 입력을 그대로 돌려줍니다. */
  think(sense: BotSense, dt: number): Input {
    this.elapsed += dt;
    if (this.elapsed >= THINK_INTERVAL - 1e-9) {
      this.held = decide(sense, this.held);
      this.elapsed = 0;
    }
    return this.held;
  }
}
