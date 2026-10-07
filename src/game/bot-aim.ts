import type { GameMap } from './maps';
import { TUNING } from './modes';
import { segmentHit } from '../physics/geometry';

/** 화살을 모으는 시간(초)의 범위입니다. */
export const ARROW_CHARGE_MIN = 0.4;
export const ARROW_CHARGE_MAX = 0.9;
/** 모으는 시간을 살펴보는 간격(초)입니다. */
const ARROW_CHARGE_STEP = 0.025;
/** 화살이 상대 중심에서 이 거리(m) 안을 지나야 맞을 가능성이 있다고 봅니다. */
const AIM_TOLERANCE = 0.5;
/** 화살이 날아가는 것을 내다보는 시간(초)입니다. */
const ARROW_FLIGHT = 1.5;
/** 화살 길이 발판에 막히는지 살피는 간격(초)입니다. */
const ARROW_PATH_STEP = 0.1;

/** 공 중심의 위치(m)입니다. */
interface Spot {
  x: number;
  y: number;
}

/** 모은 시간(초)에 따른 화살 속력입니다. */
export function arrowSpeed(charge: number): number {
  const span = TUNING.arrowMaxCharge - TUNING.arrowMinCharge;
  const ratio = Math.max(0, Math.min(1, (charge - TUNING.arrowMinCharge) / span));
  return TUNING.arrowMinSpeed + (TUNING.arrowMaxSpeed - TUNING.arrowMinSpeed) * ratio;
}

/** (ux, uy) 방향으로 speed로 쏜 화살이 상대 위치 (rx, ry)(나 기준)를 가장 가까이 지날 때의 거리와 그때까지 걸린 시간입니다. */
export function closest(rx: number, ry: number, ux: number, uy: number, speed: number): { miss: number; time: number } {
  const gap = TUNING.radius + 0.2;
  let x = ux * gap;
  let y = uy * gap;
  const vx = ux * speed;
  let vy = uy * speed;
  let miss = Math.hypot(x - rx, y - ry);
  let time = 0;
  for (let t = TUNING.step; t <= ARROW_FLIGHT; t += TUNING.step) {
    vy += TUNING.gravity * TUNING.step;
    x += vx * TUNING.step;
    y += vy * TUNING.step;
    const d = Math.hypot(x - rx, y - ry);
    if (d < miss) {
      miss = d;
      time = t;
    } else if (d > miss + 3) break;
  }
  return { miss, time };
}

/** 화살이 time초 동안 날아가는 길에 발판이 없는지 봅니다. */
function clearPath(map: GameMap, me: Spot, ux: number, uy: number, speed: number, time: number): boolean {
  const gap = TUNING.radius + 0.2;
  const at = (t: number) =>
    [me.x + ux * gap + ux * speed * t, me.y + uy * gap + uy * speed * t + 0.5 * TUNING.gravity * t * t] as const;
  if (segmentHit(map, [me.x, me.y], at(0))) return false;
  for (let t = 0; t < time; t += ARROW_PATH_STEP) {
    if (segmentHit(map, at(t), at(Math.min(time, t + ARROW_PATH_STEP)))) return false;
  }
  return true;
}

/**
 * 상대를 맞힐 가능성이 있는 방향(8방향 가운데)과 모을 시간을 고릅니다. 없으면 null입니다.
 * prefer에 가까운 시간을 먼저 살피고, 발판에 막히는 길은 버립니다.
 */
export function aimShot(
  map: GameMap,
  me: Spot,
  target: Spot,
  prefer: number,
  from: number,
): { keys: readonly [number, number]; release: number } | null {
  const rx = target.x - me.x;
  const ry = target.y - me.y;
  const side = rx >= 0 ? 1 : -1;
  const dirs = [
    [side, 0],
    [side, -1],
    [side, 1],
    [0, -1],
    [0, 1],
  ] as const;
  const charges = [prefer];
  for (let c = ARROW_CHARGE_MIN; c <= ARROW_CHARGE_MAX + 1e-9; c += ARROW_CHARGE_STEP) charges.push(c);
  charges.sort((a, b) => Math.abs(a - prefer) - Math.abs(b - prefer));
  for (const release of charges) {
    if (release < from) continue;
    const speed = arrowSpeed(release);
    for (const keys of dirs) {
      const len = Math.hypot(keys[0], keys[1]);
      const ux = keys[0] / len;
      const uy = keys[1] / len;
      const { miss, time } = closest(rx, ry, ux, uy, speed);
      if (miss <= AIM_TOLERANCE && clearPath(map, me, ux, uy, speed, time)) return { keys, release };
    }
  }
  return null;
}
