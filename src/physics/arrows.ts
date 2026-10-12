import { mapAt, moveOffset } from '../game/maps';
import type { GameMap } from '../game/maps';
import { TUNING } from '../game/modes';
import { nearestOnSegment, segmentHitAt } from './geometry';
import type { Point } from './geometry';

/** 화살의 발사 정보입니다. age는 쏜 뒤 지난 시간(초)입니다. */
export interface ArrowShot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/** 화면에 그릴 화살 하나의 모습입니다. */
export interface ArrowView {
  owner: string;
  x: number;
  y: number;
  angle: number;
  stuck: boolean;
}

/** 화살에 맞을 수 있는 공(중심 위치)입니다. */
export interface Target {
  id: string;
  x: number;
  y: number;
}

/** 한 step 동안 화살들에게 일어난 일입니다. */
export interface ArrowStepResult {
  stuck: number;
  hits: string[];
}

/** 화살 하나의 발사 정보와 지금 상태입니다. */
interface Arrow {
  owner: string;
  shot: ArrowShot;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  stuck: boolean;
  stuckAge: number;
  /** 꽂힌 발판의 도형 번호입니다. 꽂히지 않았으면 -1입니다. */
  on: number;
  /** 꽂힌 순간 그 발판이 제자리에서 벗어나 있던 거리입니다. */
  onAt: Point;
  angle: number;
}

/** 화살이 공 중심에서 이만큼(m) 떨어진 곳에서 출발합니다. */
export const ARROW_MUZZLE = TUNING.radius + 0.2;

/** charge초 동안 모았을 때의 화살 속력(m/s)입니다. 모을 수 있는 범위를 벗어나면 양 끝 값입니다. */
export function arrowSpeed(charge: number): number {
  const span = TUNING.arrowMaxCharge - TUNING.arrowMinCharge;
  const ratio = Math.max(0, Math.min(1, (charge - TUNING.arrowMinCharge) / span));
  return TUNING.arrowMinSpeed + (TUNING.arrowMaxSpeed - TUNING.arrowMinSpeed) * ratio;
}

/** 발판에 바로 꽂힌 화살의 발사 정보를 표면에서 이만큼(m) 앞에 둡니다. 보낼 때의 반올림(0.01m)보다 넉넉해야 합니다. */
const STUCK_GAP = 0.05;

/** 부동소수점 누적 오차 때문에 시간 비교가 한 step 어긋나는 일을 막습니다. */
const EPS = 1e-9;

/**
 * 날아가는 화살들입니다. 화살은 물리 물체가 아니라 발사 정보에서 직접 적분합니다.
 * time은 play 단계가 시작된 뒤 지난 시간(초)이고, 움직이는 발판은 그 시간의 위치로 판정합니다.
 * 움직이는 발판에 꽂힌 화살은 사라질 때까지 그 발판을 따라 움직입니다.
 */
export class Arrows {
  private readonly list: Arrow[] = [];
  private readonly nextId = new Map<string, number>();
  private readonly lost = new Set<string>();
  private time = 0;

  constructor(private readonly map: GameMap) {}

  /**
   * owner의 화살을 (x, y)에서 쏩니다. 번호는 주인별로 1부터 늘어납니다.
   * 공 중심 origin에서 (x, y)까지 사이에 발판이 있으면 그 표면에 이미 꽂힌 채로 시작하고 true를 돌려줍니다.
   */
  launch(owner: string, origin: Point, x: number, y: number, vx: number, vy: number, time: number): boolean {
    this.time = time;
    const id = (this.nextId.get(owner) ?? 0) + 1;
    this.nextId.set(owner, id);
    const hit = segmentHitAt(mapAt(this.map, time), origin, [x, y]);
    if (!hit) {
      this.list.push(this.create(owner, { id, x, y, vx, vy, age: 0 }));
      return false;
    }
    // 받는 쪽이 같은 발판에 꽂히도록 발사 정보는 표면 바로 앞에 둡니다.
    const wall = hit.point;
    const speed = Math.hypot(vx, vy);
    const arrow = this.create(owner, {
      id,
      x: wall[0] - (vx / speed) * STUCK_GAP,
      y: wall[1] - (vy / speed) * STUCK_GAP,
      vx,
      vy,
      age: 0,
    });
    arrow.x = wall[0];
    arrow.y = wall[1];
    this.stick(arrow, hit.shape, time);
    this.list.push(arrow);
    return true;
  }

  /** 화살 하나씩 time까지 한 step 진행합니다. 꽂히거나 맞히거나 수명이 다한 화살은 처리하고 결과를 돌려줍니다. */
  step(targets: readonly Target[], time: number): ArrowStepResult {
    this.time = time;
    const result: ArrowStepResult = { stuck: 0, hits: [] };
    for (let i = this.list.length - 1; i >= 0; i--) {
      const outcome = this.advance(this.list[i], targets, time);
      if (outcome === 'stick') result.stuck++;
      if (outcome === 'gone') this.list.splice(i, 1);
      else if (outcome !== 'fly' && outcome !== 'stick') {
        result.hits.push(outcome.hit);
        this.lost.add(`${this.list[i].owner}:${this.list[i].shot.id}`);
        this.list.splice(i, 1);
      }
    }
    return result;
  }

  /** owner가 쏜 화살 가운데 아직 남아 있는 것의 발사 정보입니다. */
  shots(owner: string): ArrowShot[] {
    return this.list.filter((a) => a.owner === owner).map((a) => ({ ...a.shot, age: a.age }));
  }

  /**
   * owner의 화살을 받은 목록에 맞춥니다. 모르는 번호는 만들고(age만큼 미리 진행), 목록에 없는 것은 없앱니다.
   * 미리 진행하는 동안 움직이는 발판은 그때 있던 위치로 판정합니다. 미리 진행하다 맞힌 공의 번호를 돌려줍니다.
   */
  sync(owner: string, shots: readonly ArrowShot[], targets: readonly Target[], time: number): string[] {
    this.time = time;
    const keep = new Set(shots.map((s) => s.id));
    // 이 주인의 공을 나중에 여기서 맡아 쏘더라도 받은 번호와 겹치지 않게 합니다.
    this.nextId.set(owner, Math.max(this.nextId.get(owner) ?? 0, ...keep));
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      if (a.owner === owner && !keep.has(a.shot.id)) this.list.splice(i, 1);
    }
    for (const key of this.lost) {
      if (key.startsWith(`${owner}:`) && !keep.has(Number(key.slice(owner.length + 1)))) this.lost.delete(key);
    }
    const hits: string[] = [];
    for (const shot of shots) {
      const key = `${owner}:${shot.id}`;
      if (this.lost.has(key) || this.list.some((a) => a.owner === owner && a.shot.id === shot.id)) continue;
      const arrow = this.create(owner, shot);
      const steps = Math.min(Math.round(shot.age / TUNING.step), Math.round(TUNING.arrowLife / TUNING.step));
      let outcome: ReturnType<Arrows['advance']> = 'fly';
      for (let i = 0; i < steps && (outcome === 'fly' || outcome === 'stick'); i++) {
        outcome = this.advance(arrow, targets, time - (steps - 1 - i) * TUNING.step);
      }
      if (outcome === 'fly' || outcome === 'stick') {
        this.list.push(arrow);
        continue;
      }
      this.lost.add(key);
      if (outcome !== 'gone') hits.push(outcome.hit);
    }
    return hits;
  }

  /** 지금 남아 있는 화살들의 모습입니다. */
  views(): ArrowView[] {
    return this.list.map((a) => {
      const [dx, dy] = this.carried(a);
      return { owner: a.owner, x: a.x + dx, y: a.y + dy, angle: a.angle, stuck: a.stuck };
    });
  }

  /** 화살을 shape번 발판에 꽂힌 것으로 합니다. */
  private stick(a: Arrow, shape: number, time: number): void {
    const on = this.map.shapes[shape];
    a.stuck = true;
    a.on = shape;
    a.onAt = on.kind === 'box' && on.move ? moveOffset(on.move, time) : [0, 0];
  }

  /** 꽂힌 뒤로 발판이 움직인 거리입니다. 움직이지 않는 발판이나 날아가는 화살은 0입니다. */
  private carried(a: Arrow): Point {
    const on = this.map.shapes[a.on];
    if (!on || on.kind !== 'box' || !on.move) return [0, 0];
    const [dx, dy] = moveOffset(on.move, this.time);
    return [dx - a.onAt[0], dy - a.onAt[1]];
  }

  private create(owner: string, shot: ArrowShot): Arrow {
    const { x, y, vx, vy } = shot;
    return {
      owner,
      shot: { ...shot, age: 0 },
      x,
      y,
      vx,
      vy,
      age: 0,
      stuck: false,
      stuckAge: 0,
      on: -1,
      onAt: [0, 0],
      angle: Math.atan2(vy, vx),
    };
  }

  /** 화살 하나를 time까지 한 step 진행합니다. */
  private advance(a: Arrow, targets: readonly Target[], time: number): 'fly' | 'stick' | 'gone' | { hit: string } {
    a.age += TUNING.step;
    if (a.age >= TUNING.arrowLife - EPS) return 'gone';
    if (a.stuck) {
      a.stuckAge += TUNING.step;
      return a.stuckAge >= TUNING.arrowStuckLife - EPS ? 'gone' : 'fly';
    }
    a.vy += TUNING.gravity * TUNING.step;
    const from: Point = [a.x, a.y];
    const to: Point = [a.x + a.vx * TUNING.step, a.y + a.vy * TUNING.step];
    const wall = segmentHitAt(mapAt(this.map, time), from, to);
    const end = wall?.point ?? to;
    for (const t of targets) {
      if (t.id === a.owner) continue;
      const near = nearestOnSegment(from, end, t.x, t.y);
      if (Math.hypot(near[0] - t.x, near[1] - t.y) <= TUNING.radius + TUNING.arrowRadius) return { hit: t.id };
    }
    a.x = end[0];
    a.y = end[1];
    if (wall) {
      this.stick(a, wall.shape, time);
      return 'stick';
    }
    a.angle = Math.atan2(a.vy, a.vx);
    return 'fly';
  }
}
