import { Box, Circle, Polygon, RopeJoint, Vec2, World as PlanckWorld } from 'planck';
import type { Body, Contact, Fixture } from 'planck';
import { mapAt, moveOffset } from '../game/maps';
import type { GameMap, Shape } from '../game/maps';
import { TUNING } from '../game/modes';
import type { Mode } from '../game/modes';
import { ARROW_MUZZLE, Arrows, arrowSpeed } from './arrows';
import type { ArrowShot, ArrowView } from './arrows';
import { closestAbove, corners } from './geometry';
import type { Point } from './geometry';

export type { ArrowShot, ArrowView };

/** 한 순간의 조작입니다. */
export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  special: boolean;
}

/** 아무것도 누르지 않은 조작입니다. */
export const NO_INPUT: Readonly<Input> = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
  special: false,
});

/** 조작을 비트 1, 2, 4, 8, 16(왼쪽, 오른쪽, 위, 아래, 특수)으로 묶습니다. */
export function packInput(input: Input): number {
  return (
    (input.left ? 1 : 0) | (input.right ? 2 : 0) | (input.up ? 4 : 0) | (input.down ? 8 : 0) | (input.special ? 16 : 0)
  );
}

/** 묶인 조작을 풉니다. 숫자가 아니면 아무것도 누르지 않은 조작으로 봅니다. */
export function unpackInput(bits: unknown): Input {
  if (typeof bits !== 'number' || !Number.isFinite(bits)) return { ...NO_INPUT };
  return {
    left: (bits & 1) !== 0,
    right: (bits & 2) !== 0,
    up: (bits & 4) !== 0,
    down: (bits & 8) !== 0,
    special: (bits & 16) !== 0,
  };
}

/** 공의 위치와 속도입니다. */
export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  av: number;
}

/** 화면에 그릴 공 하나의 모습입니다. charge는 0~1입니다. */
export interface BallView {
  id: string;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  heavy: boolean;
  rope: readonly [number, number] | null;
  aim: { dx: number; dy: number; charge: number } | null;
}

/** 센 충돌 하나입니다. 소리와 효과에만 쓰며 통신으로 보내지 않습니다. */
export interface HitEvent {
  type: 'hit';
  /** 충돌 세기(0~1)입니다. */
  strength: number;
  /** 닿은 지점입니다. */
  x: number;
  y: number;
  /** a에서 b를 향하는 단위 벡터입니다. */
  nx: number;
  ny: number;
  /** 부딪친 두 물체입니다. 공이면 그 번호이고 발판이면 null입니다. */
  a: string | null;
  b: string | null;
  /** 튕기는 발판에 닿았는지 여부. */
  bouncy: boolean;
}

/** step 동안 일어난 일입니다. hit은 센 것부터 놓입니다. */
export type WorldEvent =
  | HitEvent
  | { type: 'out'; id: string; x: number; y: number; cause: 'fall' | 'arrow' }
  | { type: 'jump'; id: string }
  | { type: 'rope'; id: string }
  | { type: 'shoot'; id: string }
  | { type: 'stick' };

/** 겨누는 모습입니다. dx, dy는 방향이고 charge는 0~1입니다. */
type Aim = { dx: number; dy: number; charge: number };

/** 공에 걸린 줄입니다. 움직이는 발판에 걸렸으면 mover가 그 발판이고 anchor는 발판 안에서의 위치입니다. */
interface Rope {
  joint: RopeJoint;
  anchor: Point;
  mover: Body | null;
}

/** 움직이는 발판 하나입니다. shape는 제자리에 있을 때의 모양이고, reach는 한 step에 속도로 따라잡는 가장 먼 거리(m)입니다. */
interface Mover {
  shape: Extract<Shape, { kind: 'box' }>;
  body: Body;
  reach: number;
}

/** 공 하나의 물리 상태와 조작을 담습니다. */
interface Entry {
  body: Body | null;
  fixture: Fixture | null;
  local: boolean;
  alive: boolean;
  heavy: boolean;
  input: Readonly<Input>;
  prevInput: Readonly<Input>;
  lastJump: number;
  rope: Rope | null;
  aim: Aim | null;
  charge: number;
  cooldown: number;
  facing: 1 | -1;
  aimDir: Point;
  /** 마우스로 겨누는 위치입니다. 없으면 방향키로 겨눕니다. */
  aimPoint: Point | null;
  /** 지금 딛고 있는 움직이는 발판과, 지난 step에 그 발판이 움직이던 속도입니다. */
  ride: Body | null;
  rideVx: number;
  rideVy: number;
  x: number;
  y: number;
  angle: number;
}

/** 공의 기본 질량(밀도 1)입니다. 무거워져도 힘과 충격량은 이 값을 기준으로 합니다. */
const BASE_MASS = Math.PI * TUNING.radius * TUNING.radius;

/** 이 충격량 이상일 때만 충돌 소리를 냅니다. */
const HIT_MIN = BASE_MASS * 3;

/** 이 충격량에서 충돌 세기가 1이 됩니다. */
const HIT_MAX = BASE_MASS * 20;

/** 이 범위를 벗어난 local 공은 탈락합니다. 화면에서 boundsMargin만큼 더 나간 곳입니다. */
const BOUNDS = {
  left: -TUNING.boundsMargin,
  right: TUNING.viewW + TUNING.boundsMargin,
  bottom: TUNING.viewH + TUNING.boundsMargin,
};

/**
 * 움직이는 발판이 가야 할 곳까지의 거리가 '가장 빠를 때 한 step에 가는 거리'의 이 배수를 넘으면, 속도로 따라잡지 않고 딛고 있는 공과 함께 바로 옮깁니다.
 * 시간이 한꺼번에 흐르거나 뒤로 갔을 때 발판이 한 step 동안 빠르게 움직여 위에 탄 공을 쏘아 올리지 않게 합니다.
 */
const MOVER_CHASE = 1.5;

/** 움직이는 발판에 건 줄의 고정점이 받은 위치와 이만큼 어긋나도 같은 줄로 봅니다(m). 발판이 통신 지연 동안 움직이는 거리보다 넉넉합니다. */
const MOVER_SLACK = 0.4;

/** 닿은 면이 이보다 위를 향하면 그 발판을 딛고 있는 것으로 봅니다. */
const RIDE_NORMAL = 0.7;

/** 움직이는 발판 위에서 좌우를 누르지 않을 때, 발판과의 속도 차가 1초에 이 비율로 줄어듭니다. */
const RIDE_GRIP = 3;

/** 겨누는 위치가 공의 중심에서 이보다 가까우면(m) 방향을 정할 수 없는 것으로 봅니다. */
const AIM_MIN = 0.05;

/** AI가 읽는 지형은 이 간격(초)으로만 새 위치로 바꿉니다. */
const FOOTING_STEP = 0.1;

/** 발판 fixture의 성질입니다. 튕기는 발판은 반발 계수가 높습니다. */
function surface(shape: Shape): { friction: number; restitution: number } {
  return { friction: TUNING.friction, restitution: shape.bouncy ? TUNING.bouncyRestitution : 0 };
}

/** 발판 도형을 정적 물체의 fixture로 붙입니다. */
function addShape(ground: Body, shape: Shape): void {
  const opt = surface(shape);
  if (shape.kind === 'circle') {
    ground.createFixture(new Circle(Vec2(shape.x, shape.y), shape.r), opt);
  } else if (shape.kind === 'box') {
    ground.createFixture(new Box(shape.w / 2, shape.h / 2, Vec2(shape.x, shape.y), shape.angle ?? 0), opt);
  } else {
    const points = (corners(shape) ?? []).map(([x, y]) => Vec2(x, y));
    ground.createFixture(new Polygon(points), opt);
  }
}

/** 공과 발판이 있는 물리 세계입니다. 1/60초씩 step으로 진행합니다. */
export class World {
  private readonly world = new PlanckWorld({ gravity: { x: 0, y: TUNING.gravity } });
  private readonly entries = new Map<string, Entry>();
  private readonly ground = this.world.createBody();
  private readonly movers: Mover[] = [];
  private readonly arrowList: Arrows;
  private pending: WorldEvent[] = [];
  /** 이번 step에 소리가 날 만큼 세게 부딪친 접촉들입니다. */
  private readonly hits = new Map<Contact, HitEvent>();
  private time = 0;
  /** play 단계가 시작된 뒤 지난 시간(초)입니다. 움직이는 발판의 위치는 이 값만으로 정해집니다. */
  private clock = 0;
  /** 발판이 지금 위치에 놓인 맵입니다. */
  private now: GameMap;
  private foot: GameMap;
  private footTick = 0;

  constructor(
    private readonly map: GameMap,
    private readonly mode: Mode,
  ) {
    this.arrowList = new Arrows(map);
    this.now = mapAt(map, 0);
    this.foot = this.now;
    for (const shape of map.shapes) {
      if (shape.kind !== 'box' || !shape.move) {
        addShape(this.ground, shape);
        continue;
      }
      const body = this.world.createKinematicBody({ position: Vec2(shape.x, shape.y), angle: shape.angle ?? 0 });
      body.createFixture(new Box(shape.w / 2, shape.h / 2), surface(shape));
      const top = (Math.PI * Math.hypot(shape.move.dx, shape.move.dy)) / shape.move.period;
      this.movers.push({ shape, body, reach: MOVER_CHASE * top * TUNING.step });
    }
    this.world.on('pre-solve', (contact) => {
      const a = contact.getFixtureA();
      const b = contact.getFixtureB();
      if (Math.max(a.getRestitution(), b.getRestitution()) < TUNING.bouncyRestitution) return;
      const normal = contact.getWorldManifold(null)?.normal;
      if (!normal) return;
      const va = a.getBody().getLinearVelocity();
      const vb = b.getBody().getLinearVelocity();
      const closing = Math.abs((vb.x - va.x) * normal.x + (vb.y - va.y) * normal.y);
      // 튕길 때마다 빨라져서 끝없이 솟지 않도록, 튕겨 나가는 속력에 한도를 둡니다.
      const most = Math.max(TUNING.restitution, TUNING.bounceSpeedMax / Math.max(closing, 1e-6));
      contact.setRestitution(Math.min(TUNING.bouncyRestitution, most));
    });
    this.world.on('post-solve', (contact, impulse) => {
      const force = impulse.normalImpulses[0] ?? 0;
      if (force >= HIT_MIN) this.noteHit(contact, force);
    });
  }

  /** local이 true인 공은 이 브라우저가 탈락·줄·화살을 정한다. false인 공은 받은 상태를 따른다. */
  addBall(id: string, x: number, y: number, local: boolean): void {
    this.removeBall(id);
    const body = this.world.createDynamicBody({ position: Vec2(x, y), linearDamping: TUNING.damping });
    const fixture = body.createFixture(new Circle(TUNING.radius), {
      density: 1,
      restitution: TUNING.restitution,
      friction: TUNING.friction,
      userData: id,
    });
    this.entries.set(id, {
      body,
      fixture,
      local,
      alive: true,
      heavy: false,
      input: NO_INPUT,
      prevInput: NO_INPUT,
      lastJump: -Infinity,
      rope: null,
      aim: null,
      charge: 0,
      cooldown: 0,
      facing: 1,
      aimDir: [1, 0],
      aimPoint: null,
      ride: null,
      rideVx: 0,
      rideVy: 0,
      x,
      y,
      angle: 0,
    });
  }

  /** 공을 세계에서 없앱니다. 그 공의 줄도 사라지고 화살은 남습니다. */
  removeBall(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.destroy(entry);
    this.entries.delete(id);
  }

  /** 공을 이 브라우저가 정하는 공(true)이나 받은 상태를 따르는 공(false)으로 바꿉니다. */
  setLocal(id: string, local: boolean): void {
    const entry = this.entries.get(id);
    if (entry) entry.local = local;
  }

  /** 그 번호의 공이 있는지 봅니다. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** 공의 조작을 정합니다. 받은 객체는 복사해 두므로 호출한 쪽이 다시 써도 됩니다. */
  setInput(id: string, input: Input): void {
    const entry = this.entries.get(id);
    if (entry) entry.input = { ...input };
  }

  /**
   * 1/60초를 진행하고 그동안 일어난 일을 돌려준다.
   * clock은 이 step이 끝났을 때 play 단계가 시작된 뒤 지난 시간(초)이고, 움직이는 발판은 그 시간의 위치로 간다.
   * 주지 않으면 지난 step보다 1/60초 뒤로 본다.
   */
  step(clock: number = this.clock + TUNING.step): WorldEvent[] {
    const events: WorldEvent[] = this.pending;
    this.pending = [];
    this.hits.clear();
    this.clock = Math.max(0, clock);
    this.moveTo(this.clock);
    for (const [id, entry] of this.entries) {
      if (entry.alive) this.drive(id, entry, events);
    }
    this.world.step(TUNING.step);
    this.time += TUNING.step;
    this.now = mapAt(this.map, this.clock);
    const tick = Math.floor(this.clock / FOOTING_STEP + 1e-9);
    if (tick !== this.footTick) {
      this.footTick = tick;
      this.foot = this.now;
    }
    for (const [id, entry] of this.entries) {
      if (!entry.alive || !entry.body) continue;
      const p = entry.body.getPosition();
      entry.x = p.x;
      entry.y = p.y;
      entry.angle = entry.body.getAngle();
      entry.prevInput = entry.input;
      if (entry.local && (p.x < BOUNDS.left || p.x > BOUNDS.right || p.y > BOUNDS.bottom)) {
        this.destroy(entry);
        events.push({ type: 'out', id, x: entry.x, y: entry.y, cause: 'fall' });
      }
    }
    this.stepArrows(events);
    if (this.hits.size > 0) events.push(...[...this.hits.values()].sort((p, q) => q.strength - p.strength));
    return events;
  }

  /** 화면에 그릴 공들의 모습입니다. */
  balls(): BallView[] {
    return [...this.entries].map(([id, e]) => ({
      id,
      x: e.x,
      y: e.y,
      angle: e.angle,
      alive: e.alive,
      heavy: e.heavy,
      rope: e.rope ? this.anchorOf(e.rope) : null,
      aim: e.aim,
    }));
  }

  /** 살아 있는 공의 위치와 속도입니다. 없거나 탈락했으면 null입니다. */
  state(id: string): BallState | null {
    const entry = this.entries.get(id);
    if (!entry?.alive || !entry.body) return null;
    const p = entry.body.getPosition();
    const v = entry.body.getLinearVelocity();
    return { x: p.x, y: p.y, vx: v.x, vy: v.y, av: entry.body.getAngularVelocity() };
  }

  /** 공이 살아 있는지 봅니다. */
  alive(id: string): boolean {
    return this.entries.get(id)?.alive ?? false;
  }

  /** 받은 소식에 따라 원격 공을 탈락시킨다. 이미 탈락했으면 아무 일도 없다. */
  kill(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.alive) this.destroy(entry);
  }

  /**
   * 원격 공을 받은 상태에 맞춥니다. 차이가 1m 미만이면 속도를 '받은 속도 + 차이×6'으로, 아니면 바로 옮깁니다.
   * 바로 옮겼으면 true를 돌려줍니다.
   */
  correct(id: string, state: BallState): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.local || !entry.alive || !entry.body) return false;
    const p = entry.body.getPosition();
    const dx = state.x - p.x;
    const dy = state.y - p.y;
    const near = Math.hypot(dx, dy) < 1;
    if (near) {
      entry.body.setLinearVelocity(Vec2(state.vx + dx * 6, state.vy + dy * 6));
    } else {
      entry.body.setTransform(Vec2(state.x, state.y), entry.body.getAngle());
      entry.body.setLinearVelocity(Vec2(state.vx, state.vy));
      entry.x = state.x;
      entry.y = state.y;
    }
    entry.body.setAngularVelocity(state.av);
    entry.body.setAwake(true);
    return !near;
  }

  /** 공에 걸린 줄의 고정점이 지금 있는 곳입니다. 줄이 없으면 null입니다. */
  rope(id: string): readonly [number, number] | null {
    const rope = this.entries.get(id)?.rope;
    return rope ? this.anchorOf(rope) : null;
  }

  /**
   * 원격 공의 줄을 받은 고정점에 겁니다. null이면 풉니다. 같은 고정점이면 다시 만들지 않습니다.
   * 움직이는 발판에 건 줄은 고정점이 발판과 함께 움직이므로, 받은 위치와 조금 어긋나도 같은 줄로 봅니다.
   */
  setRope(id: string, anchor: readonly [number, number] | null): void {
    const entry = this.entries.get(id);
    if (!entry?.alive) return;
    if (entry.rope && anchor) {
      const [x, y] = this.anchorOf(entry.rope);
      const slack = entry.rope.mover ? MOVER_SLACK : 0;
      if (Math.hypot(x - anchor[0], y - anchor[1]) <= slack) return;
    }
    this.release(entry);
    if (anchor) this.attach(entry, anchor);
  }

  /** 공이 겨누는 방향과 모은 정도(0~1)입니다. 겨누지 않으면 null입니다. */
  aim(id: string): { dx: number; dy: number; charge: number } | null {
    return this.entries.get(id)?.aim ?? null;
  }

  /** 공이 화살을 겨눌 위치를 정합니다. 그 뒤로는 방향키 대신 공에서 이 위치를 향하는 방향으로 겨눕니다. null이면 다시 방향키로 겨눕니다. */
  setAimPoint(id: string, point: readonly [number, number] | null): void {
    const entry = this.entries.get(id);
    if (entry) entry.aimPoint = point && [point[0], point[1]];
  }

  /** 원격 공이 겨누는 모습입니다(그리기 전용). */
  setAim(id: string, aim: { dx: number; dy: number; charge: number } | null): void {
    const entry = this.entries.get(id);
    if (entry) entry.aim = aim && { ...aim };
  }

  /** 모으던 힘을 버립니다. 그 뒤에 special을 떼도 화살이 나가지 않습니다. */
  cancelCharge(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.charge = 0;
    entry.aim = null;
  }

  /** owner가 쏜 화살 가운데 아직 남아 있는 것의 발사 정보입니다. */
  shots(owner: string): ArrowShot[] {
    return this.arrowList.shots(owner);
  }

  /** 원격 주인의 화살을 받은 목록에 맞춥니다. 모르는 번호는 만들고(age만큼 미리 진행), 목록에 없는 것은 없앱니다. */
  syncShots(owner: string, shots: readonly ArrowShot[]): void {
    for (const id of this.arrowList.sync(owner, shots, this.targets(), this.clock)) this.arrowHit(id, this.pending);
  }

  /** 발판들이 지금 있는 위치의 도형입니다. 움직이는 발판이 없으면 맵의 도형 그대로입니다. */
  shapes(): readonly Shape[] {
    return this.now.shapes;
  }

  /** AI가 지형을 읽을 때 쓰는 맵입니다. 움직이는 발판은 0.1초마다 새 위치로 바뀝니다. */
  footing(): GameMap {
    return this.foot;
  }

  /** 날아가거나 꽂혀 있는 화살들의 모습입니다. */
  arrows(): ArrowView[] {
    return this.arrowList.views();
  }

  /** 센 충돌이 일어난 접촉을 기억합니다. 한 step에 같은 접촉이 여러 번 풀리면 가장 센 것만 남깁니다. */
  private noteHit(contact: Contact, force: number): void {
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();
    const ua = fa.getUserData();
    const ub = fb.getUserData();
    const a = typeof ua === 'string' ? ua : null;
    const b = typeof ub === 'string' ? ub : null;
    if (a === null && b === null) return;
    const strength = Math.min(1, force / HIT_MAX);
    const seen = this.hits.get(contact);
    if (seen && seen.strength >= strength) return;
    // normal은 A에서 B를 향합니다. 닿은 지점은 공의 중심에서 반지름만큼 나간 곳으로 봅니다.
    const normal = contact.getWorldManifold(null)?.normal;
    const nx = normal?.x ?? 0;
    const ny = normal?.y ?? (a !== null ? 1 : -1);
    const center = (a !== null ? fa : fb).getBody().getPosition();
    const reach = a !== null ? TUNING.radius : -TUNING.radius;
    this.hits.set(contact, {
      type: 'hit',
      strength,
      x: center.x + nx * reach,
      y: center.y + ny * reach,
      nx,
      ny,
      a,
      b,
      bouncy: Math.max(fa.getRestitution(), fb.getRestitution()) >= TUNING.bouncyRestitution,
    });
  }

  /** 화살에 맞을 수 있는 공(살아 있는 local 공)의 목록입니다. */
  private targets(): { id: string; x: number; y: number }[] {
    const list: { id: string; x: number; y: number }[] = [];
    for (const [id, e] of this.entries) if (e.local && e.alive) list.push({ id, x: e.x, y: e.y });
    return list;
  }

  /** 화살을 한 step 진행하고 맞은 공을 탈락시킵니다. */
  private stepArrows(events: WorldEvent[]): void {
    const result = this.arrowList.step(this.targets(), this.clock);
    for (let i = 0; i < result.stuck; i++) events.push({ type: 'stick' });
    for (const id of result.hits) this.arrowHit(id, events);
  }

  /** 화살에 맞은 공을 탈락시킵니다. */
  private arrowHit(id: string, events: WorldEvent[]): void {
    const entry = this.entries.get(id);
    if (!entry?.alive) return;
    this.destroy(entry);
    events.push({ type: 'out', id, x: entry.x, y: entry.y, cause: 'arrow' });
  }

  /**
   * 움직이는 발판을 clock초의 위치로 보냅니다. 위치는 매번 시간에서 새로 구하므로 오차가 쌓이지 않습니다.
   * 가까우면 이번 step의 속도로 보내고, 멀면 한 step 전의 위치로 바로 옮긴 뒤 평소 속도로 보냅니다.
   * 바로 옮길 때에는 그 발판을 딛고 있는 공도 같은 만큼 옮깁니다. 발판의 속도가 바뀐 만큼은 carry가 공에 더합니다.
   */
  private moveTo(clock: number): void {
    for (const { shape, body, reach } of this.movers) {
      if (!shape.move) continue;
      const [ox, oy] = moveOffset(shape.move, clock);
      const p = body.getPosition();
      let dx = shape.x + ox - p.x;
      let dy = shape.y + oy - p.y;
      if (Math.hypot(dx, dy) > reach) {
        const [bx, by] = moveOffset(shape.move, clock - TUNING.step);
        const sx = shape.x + bx - p.x;
        const sy = shape.y + by - p.y;
        dx = ox - bx;
        dy = oy - by;
        for (const entry of this.entries.values()) {
          const ball = entry.body;
          if (!entry.alive || !ball || this.riding(ball) !== body) continue;
          const at = ball.getPosition();
          ball.setTransform(Vec2(at.x + sx, at.y + sy), ball.getAngle());
        }
        body.setTransform(Vec2(shape.x + bx, shape.y + by), body.getAngle());
      }
      body.setLinearVelocity(Vec2(dx / TUNING.step, dy / TUNING.step));
    }
  }

  /** 공이 딛고 있는 움직이는 발판입니다. 없으면 null입니다. */
  private riding(body: Body): Body | null {
    if (this.movers.length === 0) return null;
    for (let edge = body.getContactList(); edge; edge = edge.next) {
      const { contact, other } = edge;
      if (!other?.isKinematic() || !contact.isTouching()) continue;
      const normal = contact.getWorldManifold(null)?.normal;
      if (!normal) continue;
      // normal은 A에서 B를 향하므로, 공에서 발판을 향하는 방향으로 맞춥니다.
      const down = contact.getFixtureA().getBody() === body ? normal.y : -normal.y;
      if (down > RIDE_NORMAL) return other;
    }
    return null;
  }

  /**
   * 움직이는 발판을 딛고 있는 공을 발판과 함께 움직입니다. 공은 구르기 때문에 마찰만으로는 발판을 따라가지 못합니다.
   * 발판의 속도가 바뀐 만큼을 공에 그대로 더하고, 좌우를 누르지 않는 동안에는 발판과의 속도 차를 줄입니다.
   * 세로 속도도 같이 더하므로, 발판이 갑자기 서거나 방향을 바꿔도 공이 발판에서 튀어 오르지 않습니다.
   */
  private carry(entry: Entry, body: Body): void {
    const ride = this.riding(body);
    if (ride) {
      const v = body.getLinearVelocity();
      const { x: rideVx, y: rideVy } = ride.getLinearVelocity();
      let vx = v.x;
      let vy = v.y;
      if (ride === entry.ride) {
        vx += rideVx - entry.rideVx;
        vy += rideVy - entry.rideVy;
      }
      // 공기 저항은 발판에 대한 속도에만 걸리도록, 발판의 속도에 걸릴 몫을 미리 돌려줍니다.
      vx += rideVx * TUNING.damping * TUNING.step;
      if (entry.input.left === entry.input.right) vx -= (vx - rideVx) * RIDE_GRIP * TUNING.step;
      if (vx !== v.x || vy !== v.y) body.setLinearVelocity(Vec2(vx, vy));
      entry.rideVx = rideVx;
      entry.rideVy = rideVy;
    }
    entry.ride = ride;
  }

  /** 입력에 따라 무게, 힘, 뛰기, 줄, 화살을 적용합니다. */
  private drive(id: string, entry: Entry, events: WorldEvent[]): void {
    const { body, fixture, input } = entry;
    if (!body || !fixture) return;
    const heavy = this.mode === 'classic' && input.special;
    if (heavy !== entry.heavy) {
      entry.heavy = heavy;
      fixture.setDensity(heavy ? TUNING.heavyMass : 1);
      body.resetMassData();
    }
    this.carry(entry, body);
    if (entry.local) {
      if (input.left !== input.right) entry.facing = input.right ? 1 : -1;
      if (this.mode === 'grapple') this.driveRope(id, entry, events);
      if (this.mode === 'arrows') this.driveArrow(id, entry, events);
    }
    // 화살을 모으는 동안에는 방향키가 겨누는 데 쓰이므로 움직이지 않습니다. 쏜 직후처럼 모을 수 없을 때는 움직입니다.
    if (this.mode === 'arrows' && entry.aim) return;
    const push = BASE_MASS * TUNING.accel;
    const fx = (input.right ? push : 0) - (input.left ? push : 0);
    const fy = input.down ? push : 0;
    if (fx !== 0 || fy !== 0) body.applyForceToCenter(Vec2(fx, fy), true);
    if (input.up && this.time - entry.lastJump >= TUNING.jumpCooldown && this.touching(body)) {
      entry.lastJump = this.time;
      body.applyLinearImpulse(Vec2(0, -BASE_MASS * TUNING.jumpSpeed), body.getWorldCenter(), true);
      events.push({ type: 'jump', id });
    }
  }

  /** special을 누르는 순간 줄을 걸고 떼면 풉니다. */
  private driveRope(id: string, entry: Entry, events: WorldEvent[]): void {
    if (!entry.input.special) {
      this.release(entry);
    } else if (!entry.prevInput.special && entry.body) {
      const p = entry.body.getPosition();
      const anchor = closestAbove(this.now, p.x, p.y, TUNING.ropeReach);
      if (anchor) {
        this.attach(entry, anchor);
        events.push({ type: 'rope', id });
      }
    }
  }

  /** special을 누르는 동안 힘을 모으고, 떼는 순간 충분히 모았으면 화살을 쏩니다. */
  private driveArrow(id: string, entry: Entry, events: WorldEvent[]): void {
    const { input, body } = entry;
    if (!body) return;
    entry.cooldown = Math.max(0, entry.cooldown - TUNING.step);
    if (input.special && entry.cooldown === 0) {
      const dir = this.aimDirection(entry);
      entry.aimDir = dir;
      entry.charge += TUNING.step;
      entry.aim = { dx: dir[0], dy: dir[1], charge: Math.min(1, entry.charge / TUNING.arrowMaxCharge) };
      return;
    }
    const release = !input.special && entry.prevInput.special;
    const charge = entry.charge;
    const dir = entry.aimDir;
    entry.charge = 0;
    entry.aim = null;
    if (!release || charge < TUNING.arrowMinCharge - 1e-9) return;
    const speed = arrowSpeed(charge);
    const p = body.getPosition();
    const gap = ARROW_MUZZLE;
    const stuck = this.arrowList.launch(
      id,
      [p.x, p.y],
      p.x + dir[0] * gap,
      p.y + dir[1] * gap,
      dir[0] * speed,
      dir[1] * speed,
      this.clock,
    );
    if (stuck) events.push({ type: 'stick' });
    entry.cooldown = TUNING.arrowCooldown;
    events.push({ type: 'shoot', id });
  }

  /**
   * 겨누는 방향의 단위 벡터입니다. 겨누는 위치가 있으면 공에서 그 위치를 향하고, 없으면 누르고 있는 방향키로 만든 8방향입니다.
   * 어느 쪽으로도 정할 수 없으면 마지막 좌우 방향입니다.
   */
  private aimDirection(entry: Entry): Point {
    const { input, aimPoint } = entry;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (aimPoint) {
      const p = entry.body?.getPosition();
      dx = p ? aimPoint[0] - p.x : 0;
      dy = p ? aimPoint[1] - p.y : 0;
      if (Math.hypot(dx, dy) < AIM_MIN) return [entry.facing, 0];
    }
    if (dx === 0 && dy === 0) return [entry.facing, 0];
    const len = Math.hypot(dx, dy);
    return [dx / len, dy / len];
  }

  /** 줄의 고정점이 지금 있는 곳입니다. */
  private anchorOf(rope: Rope): Point {
    if (!rope.mover) return rope.anchor;
    const p = rope.mover.getWorldPoint(Vec2(rope.anchor[0], rope.anchor[1]));
    return [p.x, p.y];
  }

  /** (x, y)가 표면에 놓인 움직이는 발판입니다. 없으면 null입니다. */
  private moverAt(x: number, y: number): Body | null {
    for (const { shape, body } of this.movers) {
      const local = body.getLocalPoint(Vec2(x, y));
      if (Math.abs(local.x) <= shape.w / 2 + MOVER_SLACK && Math.abs(local.y) <= shape.h / 2 + MOVER_SLACK) return body;
    }
    return null;
  }

  /** 발판의 고정점과 공 사이에 줄을 겁니다. 길이는 지금의 거리입니다. 움직이는 발판에 걸면 고정점이 발판을 따라 움직입니다. */
  private attach(entry: Entry, anchor: Point): void {
    if (!entry.body) return;
    this.release(entry);
    const p = entry.body.getPosition();
    const mover = this.moverAt(anchor[0], anchor[1]);
    const local = mover ? mover.getLocalPoint(Vec2(anchor[0], anchor[1])) : Vec2(anchor[0], anchor[1]);
    const joint = this.world.createJoint(
      new RopeJoint({
        bodyA: mover ?? this.ground,
        bodyB: entry.body,
        localAnchorA: local,
        localAnchorB: Vec2(0, 0),
        maxLength: Math.hypot(anchor[0] - p.x, anchor[1] - p.y),
        collideConnected: true,
      }),
    );
    if (joint) entry.rope = { joint, anchor: mover ? [local.x, local.y] : anchor, mover };
  }

  /** 줄이 있으면 풉니다. */
  private release(entry: Entry): void {
    if (!entry.rope) return;
    this.world.destroyJoint(entry.rope.joint);
    entry.rope = null;
  }

  /** 물체가 무언가에 닿아 있는지 봅니다. */
  private touching(body: Body): boolean {
    for (let edge = body.getContactList(); edge; edge = edge.next) {
      if (edge.contact.isTouching()) return true;
    }
    return false;
  }

  /** 물체를 세계에서 없애고 탈락 처리합니다. 마지막 위치는 entry에 남습니다. */
  private destroy(entry: Entry): void {
    this.release(entry);
    if (entry.body) this.world.destroyBody(entry.body);
    entry.body = null;
    entry.aim = null;
    entry.fixture = null;
    entry.alive = false;
  }
}
