import { mapAt } from './maps';
import type { GameMap } from './maps';
import { TUNING } from './modes';
import { surfaceBelow } from '../physics/geometry';

/** 발판 윗면을 재는 가로 간격(m)입니다. */
export const GRID = 0.25;
/** 이웃한 두 지점의 높이 차가 이보다 크면 걸어서 이어지지 않는 곳으로 봅니다(m). */
const MAX_STEP = 0.15;
/** 이보다 좁은 윗면은 설 자리로 보지 않습니다(m). */
const MIN_LEDGE = 1;
/** 공 중심이 자리 끝에서 이만큼 벗어나도 아직 그 자리 위에 있다고 봅니다(m). */
const OVERHANG = 0.3;
/** 공 밑과 윗면 사이가 이보다 가까우면 서 있는 것으로 봅니다(m). */
export const GROUND_GAP = 0.2;

/** 뛰어서 올라갈 수 있다고 보는 높이(m)입니다. 한 번 뛰어 오르는 높이(약 2m)보다 작아야 합니다. */
const MAX_CLIMB = 1.5;
/** 공중에서 낼 수 있다고 어림하는 가속(m/s²)입니다. */
const AIR_ACCEL = TUNING.accel * 0.85;
/** 건너편 자리 끝에서 이만큼 안쪽을 내릴 곳으로 잡습니다(m). */
export const LAND_INSET = 1;
/** 틈을 건너는 데 필요한 속력이 이보다 크면 건널 수 없는 틈으로 봅니다(m/s). */
const LEAP_SPEED_MAX = 3;

/** 걸어서 이어지는 윗면 한 구간입니다. ys는 x0부터 GRID 간격으로 잰 높이입니다. */
export interface Ledge {
  x0: number;
  x1: number;
  ys: number[];
}

/** 움직이는 발판이 있는 맵에서 길을 찾을 때, 이 간격(초)으로 발판을 옮겨 가며 건널 수 있는지 봅니다. */
const ROUTE_STEP = 0.25;

/** 한 자리에서 다른 자리로 뛰어 건너는 방법입니다. */
export interface Crossing {
  dir: 1 | -1;
  /** 뛰는 쪽 자리 끝의 x. */
  edge: number;
  /** 내릴 곳의 x. */
  land: number;
  /** 뛰는 쪽 자리 끝에서 내릴 곳까지의 수평 거리(m). */
  span: number;
  /** 뛰어서 건너편 높이에 닿을 때까지 공중에 있는 시간(초). */
  air: number;
}

/** 자리 끝에서 ahead만큼 못 미친 곳에서 뛸 때 건너편에 닿으려면 필요한 속력(m/s)입니다. */
export function leapSpeed(way: Crossing, ahead: number): number {
  return (way.span + ahead - 0.5 * AIR_ACCEL * way.air * way.air) / way.air;
}

/** 맵에서 설 수 있는 자리들과, 자리에서 자리로 갈 때 먼저 건너갈 자리(없으면 -1)입니다. */
export interface Terrain {
  ledges: Ledge[];
  next: number[][];
}

const terrains = new WeakMap<GameMap, Terrain>();

/** 자리 위 x 지점의 윗면 높이입니다. 자리 밖이면 가까운 끝의 높이입니다. */
export function heightAt(ledge: Ledge, x: number): number {
  const at = Math.max(0, Math.min(ledge.ys.length - 1, (x - ledge.x0) / GRID));
  const i = Math.min(ledge.ys.length - 2, Math.floor(at));
  if (i < 0) return ledge.ys[0];
  return ledge.ys[i] + (ledge.ys[i + 1] - ledge.ys[i]) * (at - i);
}

/** a에서 b로 뛰어 건너는 방법을 수평 거리와 높이 차로 어림합니다. 건널 수 없으면 null입니다. */
export function crossing(a: Ledge, b: Ledge): Crossing | null {
  let dir: 1 | -1;
  if (b.x0 >= a.x1) dir = 1;
  else if (b.x1 <= a.x0) dir = -1;
  else return null;
  const edge = dir > 0 ? a.x1 : a.x0;
  const near = dir > 0 ? b.x0 : b.x1;
  const drop = heightAt(b, near) - heightAt(a, edge);
  if (drop < -MAX_CLIMB) return null;
  const inset = Math.min(LAND_INSET, (b.x1 - b.x0) / 2);
  const air = (TUNING.jumpSpeed + Math.sqrt(TUNING.jumpSpeed ** 2 + 2 * TUNING.gravity * drop)) / TUNING.gravity;
  const way = { dir, edge, land: near + dir * inset, span: Math.abs(near - edge) + inset, air };
  return leapSpeed(way, 0) > LEAP_SPEED_MAX ? null : way;
}

/** 맵의 도형에서 설 수 있는 자리를 찾습니다. */
function ledgesOf(map: GameMap): Ledge[] {
  const count = Math.round(TUNING.viewW / GRID) + 1;
  // 도형마다 세로선과 만나는 윗면·아랫면을 잽니다.
  const spans = map.shapes.map((shape) => {
    const single = { ...map, shapes: [shape] };
    return Array.from({ length: count }, (_, i) => {
      const top = surfaceBelow(single, i * GRID, -Infinity);
      return top === null ? null : ([top, surfaceBelow(single, i * GRID, top + 1e-6) ?? top] as const);
    });
  });
  const open: { last: number; ledge: Ledge }[] = [];
  const found: { shape: number; ledge: Ledge }[] = [];
  for (let i = 0; i < count; i++) {
    spans.forEach((span, shape) => {
      const top = span[i]?.[0];
      // 다른 도형 속에 묻힌 윗면은 설 수 없습니다.
      if (top === undefined || spans.some((o) => o[i] && o[i]![0] < top - 1e-6 && top < o[i]![1] - 1e-6)) return;
      const chain = open.find((c) => c.last === i - 1 && Math.abs(c.ledge.ys[c.ledge.ys.length - 1] - top) <= MAX_STEP);
      if (chain) {
        chain.last = i;
        chain.ledge.x1 = i * GRID;
        chain.ledge.ys.push(top);
      } else {
        const ledge = { x0: i * GRID, x1: i * GRID, ys: [top] };
        open.push({ last: i, ledge });
        found.push({ shape, ledge });
      }
    });
  }
  // 발판이 움직여도 자리의 번호가 바뀌지 않도록, 움직이는 발판이 있는 맵은 도형 순서대로 늘어놓습니다.
  if (map.base) found.sort((a, b) => a.shape - b.shape);
  return found.map((f) => f.ledge).filter((l) => l.x1 - l.x0 >= MIN_LEDGE);
}

/** can[a][b]가 참이면 a에서 b로 바로 건널 수 있을 때, 자리에서 자리로 갈 때 먼저 건너갈 자리(없으면 -1)를 찾습니다. */
function route(can: boolean[][]): number[][] {
  return can.map((_, from) => {
    const first = can.map(() => -1);
    first[from] = from;
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      can.forEach((_, to) => {
        if (first[to] >= 0 || !can[at][to]) return;
        first[to] = at === from ? to : first[at];
        queue.push(to);
      });
    }
    return first;
  });
}

function crossable(ledges: Ledge[]): boolean[][] {
  return ledges.map((a) => ledges.map((b) => crossing(a, b) !== null));
}

const routes = new WeakMap<GameMap, number[][]>();

/**
 * 움직이는 발판이 있는 맵의 길입니다. 발판이 오가는 동안 한 번이라도 건널 수 있으면 길로 봅니다.
 * 지금은 건널 수 없어도 길이 있으면 AI가 그쪽 끝에서 기다리다가 건널 수 있을 때 건넙니다.
 */
function routesOf(base: GameMap): number[][] {
  let next = routes.get(base);
  if (next) return next;
  const first = ledgesOf(mapAt(base, 0));
  const can = crossable(first);
  const periods = base.shapes.map((s) => (s.kind === 'box' && s.move ? s.move.period : 0));
  for (let t = ROUTE_STEP; t < Math.max(...periods) * 2; t += ROUTE_STEP) {
    const ledges = ledgesOf(mapAt(base, t));
    if (ledges.length !== first.length) continue;
    crossable(ledges).forEach((row, a) => row.forEach((ok, b) => (can[a][b] ||= ok)));
  }
  next = route(can);
  routes.set(base, next);
  return next;
}

/** 맵의 도형에서 설 수 있는 자리와 자리 사이의 길을 찾습니다. */
function survey(map: GameMap): Terrain {
  const ledges = ledgesOf(map);
  const planned = map.base ? routesOf(map.base) : null;
  return { ledges, next: planned?.length === ledges.length ? planned : route(crossable(ledges)) };
}

export function terrainOf(map: GameMap): Terrain {
  let terrain = terrains.get(map);
  if (!terrain) {
    terrain = survey(map);
    terrains.set(map, terrain);
  }
  return terrain;
}

/** (x, y)에 있는 공의 바로 아래에 있는 자리의 번호입니다. 없으면 -1입니다. */
export function ledgeUnder(terrain: Terrain, x: number, y: number): number {
  let best = -1;
  let bestY = Infinity;
  terrain.ledges.forEach((ledge, i) => {
    if (x < ledge.x0 - OVERHANG || x > ledge.x1 + OVERHANG) return;
    const top = heightAt(ledge, x);
    if (top < y - GROUND_GAP || top >= bestY) return;
    best = i;
    bestY = top;
  });
  return best;
}
