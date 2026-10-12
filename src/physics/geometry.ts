import type { GameMap, Shape } from '../game/maps';

/** [x, y] 좌표(미터)입니다. */
export type Point = readonly [number, number];

/** 입력 y보다 이만큼 이상 위에 있는 표면만 후보로 봅니다. */
const ABOVE_MARGIN = 0.01;

/** 도형을 꼭짓점 목록으로 바꿉니다(원은 null). */
export function corners(shape: Shape): Point[] | null {
  if (shape.kind === 'circle') return null;
  if (shape.kind === 'poly') return shape.points.map((p) => [p[0], p[1]] as const);
  const cos = Math.cos(shape.angle ?? 0);
  const sin = Math.sin(shape.angle ?? 0);
  const hw = shape.w / 2;
  const hh = shape.h / 2;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([dx, dy]) => [shape.x + dx * cos - dy * sin, shape.y + dx * sin + dy * cos] as const);
}

/** 꼭짓점 목록의 변을 (시작, 끝) 쌍으로 돌려줍니다. */
function edges(points: Point[]): [Point, Point][] {
  return points.map((p, i) => [p, points[(i + 1) % points.length]]);
}

/** 선분 a→b 위에서 (x, y)와 가장 가까운 점입니다. */
export function nearestOnSegment(a: Point, b: Point, x: number, y: number): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** 선분 a→b 가운데 y가 limit 이하인 부분만 남깁니다. 남는 부분이 없으면 null입니다. */
function clipAbove(a: Point, b: Point, limit: number): [Point, Point] | null {
  if (a[1] > limit && b[1] > limit) return null;
  if (a[1] <= limit && b[1] <= limit) return [a, b];
  const t = (limit - a[1]) / (b[1] - a[1]);
  const cut: Point = [a[0] + t * (b[0] - a[0]), limit];
  return a[1] <= limit ? [a, cut] : [cut, b];
}

/** (x,y)보다 위(y가 더 작은 쪽)에 있는 발판 표면 가운데 가장 가까운 지점입니다. reach 안에 없으면 null입니다. */
export function closestAbove(map: GameMap, x: number, y: number, reach: number): Point | null {
  const limit = y - ABOVE_MARGIN;
  let best: Point | null = null;
  let bestDist = reach;
  const consider = (p: Point) => {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  };
  for (const shape of map.shapes) {
    const pts = corners(shape);
    if (pts) {
      for (const [a, b] of edges(pts)) {
        const part = clipAbove(a, b, limit);
        if (part) consider(nearestOnSegment(part[0], part[1], x, y));
      }
      continue;
    }
    if (shape.kind !== 'circle') continue;
    const dx = x - shape.x;
    const dy = y - shape.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      const p: Point = [shape.x + (dx / dist) * shape.r, shape.y + (dy / dist) * shape.r];
      if (p[1] <= limit) {
        consider(p);
        continue;
      }
    }
    const half2 = shape.r * shape.r - (limit - shape.y) ** 2;
    if (half2 >= 0) {
      const half = Math.sqrt(half2);
      consider([shape.x - half, limit]);
      consider([shape.x + half, limit]);
    }
  }
  return best;
}

/** 세로선 x가 도형 테두리와 만나는 y 값들입니다. */
function crossings(shape: Shape, x: number): number[] {
  const pts = corners(shape);
  if (!pts) {
    if (shape.kind !== 'circle') return [];
    const half2 = shape.r * shape.r - (x - shape.x) ** 2;
    if (half2 < 0) return [];
    const half = Math.sqrt(half2);
    return [shape.y - half, shape.y + half];
  }
  const ys: number[] = [];
  for (const [a, b] of edges(pts)) {
    if (a[0] === b[0] || x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0])) continue;
    ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return ys;
}

/** x 위치에서 y보다 아래에 있는 가장 가까운 발판 표면의 y입니다. 없으면 null입니다. */
export function surfaceBelow(map: GameMap, x: number, y: number): number | null {
  let best: number | null = null;
  for (const shape of map.shapes) {
    for (const sy of crossings(shape, x)) {
      if (sy >= y && (best === null || sy < best)) best = sy;
    }
  }
  return best;
}

/** 두 선분 a→b, c→d가 만나는 a→b 위의 비율 t입니다. 만나지 않으면 null입니다. */
function segmentT(a: Point, b: Point, c: Point, d: Point): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** 선분 a→b가 원에 처음 닿는 비율 t입니다. 닿지 않으면 null입니다. */
function circleT(a: Point, b: Point, cx: number, cy: number, r: number): number | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - cx;
  const fy = a[1] - cy;
  const qa = dx * dx + dy * dy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - r * r;
  const disc = qb * qb - 4 * qa * qc;
  if (qa === 0 || disc < 0) return null;
  const root = Math.sqrt(disc);
  for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
    if (t >= 0 && t <= 1) return t;
  }
  return null;
}

/** 선분 a→b가 발판에 처음 닿는 지점과 그 발판의 도형 번호입니다. 닿지 않으면 null입니다. */
export function segmentHitAt(map: GameMap, a: Point, b: Point): { point: Point; shape: number } | null {
  let best: number | null = null;
  let hit = -1;
  map.shapes.forEach((shape, i) => {
    const pts = corners(shape);
    const ts = pts
      ? edges(pts).map(([c, d]) => segmentT(a, b, c, d))
      : shape.kind === 'circle'
        ? [circleT(a, b, shape.x, shape.y, shape.r)]
        : [];
    for (const t of ts) {
      if (t !== null && (best === null || t < best)) {
        best = t;
        hit = i;
      }
    }
  });
  if (best === null) return null;
  return { point: [a[0] + best * (b[0] - a[0]), a[1] + best * (b[1] - a[1])], shape: hit };
}

/** 선분 a→b가 발판에 처음 닿는 지점입니다. 닿지 않으면 null입니다. */
export function segmentHit(map: GameMap, a: Point, b: Point): Point | null {
  return segmentHitAt(map, a, b)?.point ?? null;
}

/** 도형 윗면의 가운데 지점입니다. 도형의 가로 가운데에서 가장 위에 있는 표면을 씁니다. */
function topCenter(shape: Shape): Point {
  if (shape.kind === 'circle') return [shape.x, shape.y - shape.r];
  const pts = corners(shape) ?? [];
  const xs = pts.map((p) => p[0]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  return [cx, Math.min(...crossings(shape, cx))];
}

/** (x,y)에서 가장 가까운 발판의 윗면 가운데 지점입니다. */
export function nearestTop(map: GameMap, x: number, y: number): Point {
  let best: Point = [x, y];
  let bestDist = Infinity;
  for (const shape of map.shapes) {
    const p = topCenter(shape);
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}
