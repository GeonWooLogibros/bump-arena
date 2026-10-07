import { Box, Circle, Polygon, Vec2, World as PlanckWorld } from 'planck';
import type { Body, Fixture } from 'planck';
import type { GameMap, Shape } from '../game/maps';
import { TUNING } from '../game/modes';
import type { Mode } from '../game/modes';
import { corners } from './geometry';

/** 한 순간의 조작입니다. */
export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  special: boolean;
}

/** 아무것도 누르지 않은 조작입니다. */
export const NO_INPUT: Input = { left: false, right: false, up: false, down: false, special: false };

/** 조작을 비트 1, 2, 4, 8, 16(왼쪽, 오른쪽, 위, 아래, 특수)으로 묶습니다. */
export function packInput(input: Input): number {
  return (
    (input.left ? 1 : 0) | (input.right ? 2 : 0) | (input.up ? 4 : 0) | (input.down ? 8 : 0) | (input.special ? 16 : 0)
  );
}

/** 묶인 조작을 풉니다. 숫자가 아니면 아무것도 누르지 않은 조작으로 봅니다. */
export function unpackInput(bits: unknown): Input {
  if (typeof bits !== 'number' || !Number.isFinite(bits)) return NO_INPUT;
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

/** 공 하나의 물리 상태와 조작을 담습니다. */
interface Entry {
  body: Body | null;
  fixture: Fixture | null;
  local: boolean;
  alive: boolean;
  heavy: boolean;
  input: Input;
  prevInput: Input;
  lastJump: number;
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

/** 이 범위를 벗어난 local 공은 탈락합니다. */
const BOUNDS = { left: -2, right: 34, bottom: 20 };

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
  private hitImpulse = 0;
  private time = 0;

  constructor(
    map: GameMap,
    private readonly mode: Mode,
  ) {
    const ground = this.world.createBody();
    for (const shape of map.shapes) addShape(ground, shape);
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
      x,
      y,
      angle: 0,
    });
  }

  removeBall(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.destroy(entry);
    this.entries.delete(id);
  }

  setLocal(id: string, local: boolean): void {
    const entry = this.entries.get(id);
    if (entry) entry.local = local;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  setInput(id: string, input: Input): void {
    const entry = this.entries.get(id);
    if (entry) entry.input = input;
  }

  /** 1/60초를 진행하고 그동안 일어난 일을 돌려준다. */
  step(): WorldEvent[] {
    const events: WorldEvent[] = [];
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
    if (this.hitImpulse >= HIT_MIN) events.push({ type: 'hit', strength: Math.min(1, this.hitImpulse / HIT_MAX) });
    return events;
  }

  balls(): BallView[] {
    return [...this.entries].map(([id, e]) => ({
      id,
      x: e.x,
      y: e.y,
      angle: e.angle,
      alive: e.alive,
      heavy: e.heavy,
      rope: null,
      aim: null,
    }));
  }

  state(id: string): BallState | null {
    const entry = this.entries.get(id);
    if (!entry?.alive || !entry.body) return null;
    const p = entry.body.getPosition();
    const v = entry.body.getLinearVelocity();
    return { x: p.x, y: p.y, vx: v.x, vy: v.y, av: entry.body.getAngularVelocity() };
  }

  alive(id: string): boolean {
    return this.entries.get(id)?.alive ?? false;
  }

  /** 받은 소식에 따라 원격 공을 탈락시킨다. 이미 탈락했으면 아무 일도 없다. */
  kill(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.alive) this.destroy(entry);
  }

  /** 입력에 따라 무게, 힘, 뛰기를 적용합니다. */
  private drive(id: string, entry: Entry, events: WorldEvent[]): void {
    const { body, fixture, input } = entry;
    if (!body || !fixture) return;
    const heavy = this.mode === 'classic' && input.special;
    if (heavy !== entry.heavy) {
      entry.heavy = heavy;
      fixture.setDensity(heavy ? TUNING.heavyMass : 1);
      body.resetMassData();
    }
    if (this.mode === 'arrows' && input.special) return;
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

  /** 물체가 무언가에 닿아 있는지 봅니다. */
  private touching(body: Body): boolean {
    for (let edge = body.getContactList(); edge; edge = edge.next) {
      if (edge.contact.isTouching()) return true;
    }
    return false;
  }

  /** 물체를 세계에서 없애고 탈락 처리합니다. 마지막 위치는 entry에 남습니다. */
  private destroy(entry: Entry): void {
    if (entry.body) this.world.destroyBody(entry.body);
    entry.body = null;
    entry.fixture = null;
    entry.alive = false;
  }
}
