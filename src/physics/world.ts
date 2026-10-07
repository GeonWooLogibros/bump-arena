import { Box, Circle, Polygon, RopeJoint, Vec2, World as PlanckWorld } from 'planck';
import type { Body, Fixture } from 'planck';
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

/** step 동안 일어난 일입니다. hit의 strength는 0~1입니다. */
export type WorldEvent =
  | { type: 'hit'; strength: number }
  | { type: 'out'; id: string; x: number; y: number; cause: 'fall' | 'arrow' }
  | { type: 'jump'; id: string }
  | { type: 'rope'; id: string }
  | { type: 'shoot'; id: string }
  | { type: 'stick' };

/** 겨누는 모습입니다. dx, dy는 방향이고 charge는 0~1입니다. */
type Aim = { dx: number; dy: number; charge: number };

/** 공에 걸린 줄입니다. */
interface Rope {
  joint: RopeJoint;
  anchor: Point;
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

/** 발판 도형을 정적 물체의 fixture로 붙입니다. */
function addShape(ground: Body, shape: Shape): void {
  const opt = { friction: TUNING.friction };
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
  private readonly arrowList: Arrows;
  private pending: WorldEvent[] = [];
  private hitImpulse = 0;
  private time = 0;

  constructor(
    private readonly map: GameMap,
    private readonly mode: Mode,
  ) {
    this.arrowList = new Arrows(map);
    for (const shape of map.shapes) addShape(this.ground, shape);
    this.world.on('post-solve', (contact, impulse) => {
      if (!contact.getFixtureA().getUserData() && !contact.getFixtureB().getUserData()) return;
      this.hitImpulse = Math.max(this.hitImpulse, impulse.normalImpulses[0] ?? 0);
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

  /** 1/60초를 진행하고 그동안 일어난 일을 돌려준다. */
  step(): WorldEvent[] {
    const events: WorldEvent[] = this.pending;
    this.pending = [];
    this.hitImpulse = 0;
    for (const [id, entry] of this.entries) {
      if (entry.alive) this.drive(id, entry, events);
    }
    this.world.step(TUNING.step);
    this.time += TUNING.step;
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
    if (this.hitImpulse >= HIT_MIN) events.push({ type: 'hit', strength: Math.min(1, this.hitImpulse / HIT_MAX) });
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
      rope: e.rope?.anchor ?? null,
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

  /** 원격 공을 받은 상태에 맞춥니다. 차이가 1m 미만이면 속도를 '받은 속도 + 차이×6'으로, 아니면 바로 옮깁니다. */
  correct(id: string, state: BallState): void {
    const entry = this.entries.get(id);
    if (!entry || entry.local || !entry.alive || !entry.body) return;
    const p = entry.body.getPosition();
    const dx = state.x - p.x;
    const dy = state.y - p.y;
    if (Math.hypot(dx, dy) < 1) {
      entry.body.setLinearVelocity(Vec2(state.vx + dx * 6, state.vy + dy * 6));
    } else {
      entry.body.setTransform(Vec2(state.x, state.y), entry.body.getAngle());
      entry.body.setLinearVelocity(Vec2(state.vx, state.vy));
      entry.x = state.x;
      entry.y = state.y;
    }
    entry.body.setAngularVelocity(state.av);
    entry.body.setAwake(true);
  }

  /** 공에 걸린 줄의 고정점입니다. 줄이 없으면 null입니다. */
  rope(id: string): readonly [number, number] | null {
    return this.entries.get(id)?.rope?.anchor ?? null;
  }

  /** 원격 공의 줄을 받은 고정점에 겁니다. null이면 풉니다. 같은 고정점이면 다시 만들지 않습니다. */
  setRope(id: string, anchor: readonly [number, number] | null): void {
    const entry = this.entries.get(id);
    if (!entry?.alive) return;
    if (entry.rope && anchor && entry.rope.anchor[0] === anchor[0] && entry.rope.anchor[1] === anchor[1]) return;
    this.release(entry);
    if (anchor) this.attach(entry, anchor);
  }

  /** 공이 겨누는 방향과 모은 정도(0~1)입니다. 겨누지 않으면 null입니다. */
  aim(id: string): { dx: number; dy: number; charge: number } | null {
    return this.entries.get(id)?.aim ?? null;
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
    for (const id of this.arrowList.sync(owner, shots, this.targets())) this.arrowHit(id, this.pending);
  }

  /** 날아가거나 꽂혀 있는 화살들의 모습입니다. */
  arrows(): ArrowView[] {
    return this.arrowList.views();
  }

  /** 화살에 맞을 수 있는 공(살아 있는 local 공)의 목록입니다. */
  private targets(): { id: string; x: number; y: number }[] {
    const list: { id: string; x: number; y: number }[] = [];
    for (const [id, e] of this.entries) if (e.local && e.alive) list.push({ id, x: e.x, y: e.y });
    return list;
  }

  /** 화살을 한 step 진행하고 맞은 공을 탈락시킵니다. */
  private stepArrows(events: WorldEvent[]): void {
    const result = this.arrowList.step(this.targets());
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
      const anchor = closestAbove(this.map, p.x, p.y, TUNING.ropeReach);
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
    );
    if (stuck) events.push({ type: 'stick' });
    entry.cooldown = TUNING.arrowCooldown;
    events.push({ type: 'shoot', id });
  }

  /** 누르고 있는 방향키로 만든 8방향 단위 벡터입니다. 아무것도 없으면 마지막 좌우 방향입니다. */
  private aimDirection(entry: Entry): Point {
    const { input } = entry;
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return [entry.facing, 0];
    const len = Math.hypot(dx, dy);
    return [dx / len, dy / len];
  }

  /** 발판의 고정점과 공 사이에 줄을 겁니다. 길이는 지금의 거리입니다. */
  private attach(entry: Entry, anchor: Point): void {
    if (!entry.body) return;
    this.release(entry);
    const p = entry.body.getPosition();
    const joint = this.world.createJoint(
      new RopeJoint({
        bodyA: this.ground,
        bodyB: entry.body,
        localAnchorA: Vec2(anchor[0], anchor[1]),
        localAnchorB: Vec2(0, 0),
        maxLength: Math.hypot(anchor[0] - p.x, anchor[1] - p.y),
        collideConnected: true,
      }),
    );
    if (joint) entry.rope = { joint, anchor };
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
