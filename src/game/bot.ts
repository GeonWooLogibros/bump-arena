import type { GameMap } from './maps';
import { TUNING } from './modes';
import type { Mode } from './modes';
import { NO_INPUT } from '../physics/world';
import type { Input } from '../physics/world';
import { ARROW_CHARGE_MAX, ARROW_CHARGE_MIN, aimShot, turnTo } from './bot-aim';
import { SKILLS, THINK_FLOOR } from './bot-skill';
import type { BotSkill } from './bot-skill';
import { GRID, GROUND_GAP, LAND_INSET, crossing, heightAt, leapSpeed, ledgeUnder, terrainOf } from './bot-terrain';
import type { Ledge, Terrain } from './bot-terrain';

/** 멈출 때 낼 수 있다고 어림하는 감속(m/s²)입니다. 반응이 늦는 만큼 실제 가속보다 작게 잡습니다. */
const BRAKE = TUNING.accel * 0.8;
/** 평소에 달리는 최고 속력(m/s)입니다. */
const RUN_SPEED = 7;
/** 목표 지점에 이만큼 가까우면 도착한 것으로 봅니다(m). */
const ARRIVE_SLACK = 0.15;
/** 원하는 속력과 이만큼 차이 나야 힘을 줍니다(m/s). */
const SPEED_SLACK = 0.4;

/** 자리 끝까지 이 거리(m) 안에 들어와야 뜁니다. */
const LEAP_FROM = 2;
/** 건너뛰기를 이 시간(초) 안에 끝내지 못하면 그만둡니다. */
const LEAP_TIME = 2.5;
/** 건너뛴 뒤 이 시간(초)이 지나야 내려앉았는지 봅니다. */
const LEAP_SETTLE = 0.3;
/** 다른 자리로 건너가기 전에 뜸을 들이는 시간(초)의 상한입니다. */
const CROSS_WAIT_MAX = 1.5;
/** 속력이 모자랄 때 뒤로 물러나 도움닫기하는 시간(초)입니다. */
const RUN_UP_TIME = 0.5;

/** 바로 위에 있어서 올라갈 수 없는 자리를 돌아갈 곳으로 고르지 않게 더하는 값(m)입니다. */
const UNDER_COST = 100;
/** 자리 윗면보다 이만큼(m) 넘게 떨어지면 올라오기를 포기합니다. */
const RESCUE_DEPTH = 2.5;
/** 떨어지다가 자리 모서리가 이 거리(m) 안에 있을 때만 줄을 겁니다. */
const HOOK_REACH = 1.6;
/** 줄에 매달린 채 속력이 이보다 느려지면 줄을 놓습니다(m/s). */
const ROPE_SLOW = 1.5;
/** 갈고리 충전량이 이보다 적으면 줄을 걸지 않고 벽을 찹니다. 걸자마자 풀려서 잠기기만 합니다. */
const HOOK_FUEL = 0.15;

/** 목표를 다시 고르는 간격(초)의 범위입니다. */
const RETARGET_MIN = 3;
const RETARGET_MAX = 6;
/** 갈 수 없는 자리에 있는 상대를 고를 가중치입니다(갈 수 있는 상대는 1). */
const UNREACHABLE_WEIGHT = 0.1;

/** 맞붙었다고 보는 거리(m)입니다. */
const CLINCH_RANGE = 1.6;
/** 교착이 이어질 때 다른 행동으로 바꾸기까지 참는 시간(초)의 범위입니다. */
const STUCK_TIME_MIN = 0.3;
const STUCK_TIME_MAX = 1;
/** 높은 곳으로 물러났으면 상대가 이 거리(m) 안으로 올 때까지 거기서 버팁니다. */
const HOLD_RANGE = 2;
/** 높은 곳에서 버티는 시간(초)의 범위입니다. 이 시간이 지나면 상대가 오지 않아도 달려 내려갑니다. */
const HOLD_TIME_MIN = 2;
const HOLD_TIME_MAX = 8;
/** 상대가 이 속력(m/s)보다 빠르게 달아나고 있으면 들이받지 않고 평소처럼 자리 끝을 조심합니다. */
const RAM_DRIFT = 6;
/** 교착을 풀 때 물러나지 않고 뛰어넘을 확률입니다. */
const HOP_CHANCE = 0.5;
/** 부딪친 뒤 물러나는 거리(m)의 범위입니다. */
const BACK_OFF_MIN = 3;
const BACK_OFF_MAX = 9;
/** 상대 반대쪽으로 이 거리(m) 안에, 물러날 곳보다 이만큼(m) 넘게 높은 곳이 있으면 거기까지 올라갑니다. */
const HIGH_GROUND_REACH = 14;
const HIGH_GROUND_RISE = 0.5;
/** 물러나는 데 주는 시간입니다. 기본 시간(초)에, 물러날 거리를 이 속력(m/s)으로 나눈 시간을 더합니다. */
const BACK_OFF_TIME = 0.5;
const BACK_OFF_PACE = 4;
/** 뒤가 자리 끝에서 이만큼 안이면 물러나지 않고 뛰어넘습니다(m). */
const BACK_ROOM = 1.2;
/** 뛰어넘으려고 뛰는 거리(m)입니다. */
const HOP_RANGE = 2.2;
/** 뛰어넘기를 이 시간(초) 안에 끝내지 못하면 그만둡니다. */
const HOP_TIME = 1.5;
/** 뛰어넘은 뒤 상대와 이만큼 벌어지면 돌아섭니다(m). */
const HOP_CLEAR = 1.5;
/** 상대가 이만큼 이상 높이 있고 가까우면 뜁니다(m). */
const JUMP_IF_ABOVE = 1.2;
const JUMP_IF_NEAR = 2;

/** 클래식에서 이 거리(m)보다 가까워지면 무거워집니다. 다가가는 속력만큼 더 일찍 누릅니다. */
const HEAVY_RANGE = 1.3;
/** 무거워지기를 누르고 있는 시간(초)의 범위입니다. */
const HEAVY_MIN = 0.2;
const HEAVY_MAX = 0.5;
/** 무거워지기를 다시 쓰기까지 쉬는 시간(초)의 범위입니다. */
const HEAVY_REST_MIN = 0.5;
const HEAVY_REST_MAX = 1.2;
/** 무거워지기의 남은 효과가 이보다 적으면 누르지 않고 돌아오기를 기다립니다. */
const HEAVY_WORTH = 0.5;

/** 생각 한 번 사이에 가로 속도가 이만큼 넘게 바뀌면 세게 부딪친 것으로 봅니다(m/s). */
const STUN_JOLT = 3.5;
/** 다른 공이 이 거리(m) 안에 있을 때만 공끼리 부딪친 것으로 봅니다. */
const STUN_RANGE = 2;
/** 튕겨 나가는 속력이 이보다 빨라야 밀린 것으로 봅니다(m/s). 밀어낸 쪽은 멈추지 않고 계속 몰아붙입니다. */
const STUN_SPEED = 3;
/** 손을 놓고 있는 시간(초)의 상한입니다. */
const STUN_CAP = 1.2;
/** 한 번 튕겨 나갈 때마다 손을 놓고 있는 시간과 그 상한이 이 비율만큼 늘어납니다. */
const BRUISE_GAIN = 0.5;
/** 아무리 많이 맞아도 손을 놓고 있는 시간은 이보다 길어지지 않습니다(초). */
const STUN_CAP_MAX = 3;

/** 움직이는 발판을 기다릴 때 자리 끝에서 이만큼(m) 안쪽에 섭니다. */
const WAIT_INSET = 1.2;
/** 쏠 기회가 이 시간(초) 동안 없으면 상대 쪽으로 건너갑니다. */
const ARROW_PATIENCE = 3;
/** 화살 모드에서 상대와 두려는 거리(m)의 범위입니다. */
const ARROW_NEAR = 3;
const ARROW_FAR = 6.5;
/** 화살 모드에서 서성일 곳을 다시 고르는 간격(초)의 범위입니다. */
const WANDER_MIN = 0.5;
const WANDER_MAX = 1.3;
/** 겨누는 방향이 쏘려는 방향과 이 각도(라디안) 안이면 맞춘 것으로 봅니다. 한 step에 도는 각도의 절반입니다. */
const AIM_ALIGN = (TUNING.arrowTurnSpeed * TUNING.step) / 2;
/** 비스듬한 방향의 단위 벡터 성분입니다. */
const DIAGONAL = Math.SQRT1_2;

/** AI가 보는 상황입니다. */
export interface BotSense {
  map: GameMap;
  mode: Mode;
  me: { x: number; y: number; vx: number; vy: number };
  /** 생존한 다른 공. */
  others: readonly { id: string; x: number; y: number }[];
  roped: boolean;
  /** 지금 모은 시간 비율 0~1. */
  charge: number;
  /** 화살을 모으는 동안 겨누고 있는 방향의 단위 벡터입니다. 모으고 있지 않으면 null입니다. */
  aimDir: readonly [number, number] | null;
  /** 무거워지기의 남은 효과 0~1. */
  heft: number;
  /** 갈고리 충전량 0~1과, 줄을 쓸 수 없이 잠겨 있는지 여부. */
  fuel: number;
  locked: boolean;
}

type Me = BotSense['me'];
type Other = BotSense['others'][number];

/** 상대와 같은 자리에서 싸울 때의 행동입니다. */
type Tactic = 'charge' | 'retreat' | 'hop';

/** 모으고 있는 화살입니다. id는 겨누는 상대, dir은 쏘려는 방향의 단위 벡터, release는 놓을 때까지 모을 시간(초)입니다. */
interface Shot {
  id: string;
  dir: readonly [number, number];
  release: number;
  prefer: number;
  since: number;
}

/** dir 쪽으로 미는 입력입니다. 이미 cap보다 빠르면 밀지 않습니다. */
function rush(me: Me, dir: number, cap: number): Input {
  return {
    ...NO_INPUT,
    right: dir > 0 && me.vx < cap,
    left: dir < 0 && me.vx > -cap,
  };
}

/** goal 지점에 멈춰 서도록 미는 입력입니다. */
function steer(me: Me, goal: number, cap: number): Input {
  const err = goal - me.x;
  const want = Math.abs(err) < ARRIVE_SLACK ? 0 : Math.sign(err) * Math.min(cap, Math.sqrt(2 * BRAKE * Math.abs(err)));
  return {
    ...NO_INPUT,
    right: me.vx < want - SPEED_SLACK,
    left: me.vx > want + SPEED_SLACK,
  };
}

/**
 * 스스로 싸우는 AI입니다. 수준에 따라 정해진 간격(보통은 0.15초)마다 상황을 보고 입력을 고칩니다.
 * 상대를 골라 같은 자리까지 건너간 뒤, 모드에 맞게 부딪치거나 화살을 쏩니다.
 */
export class Bot {
  private held: Input = { ...NO_INPUT };
  private elapsed: number;
  /** 생각하기 시작한 뒤 지난 시간(초)입니다. AI는 play 단계에서만 생각하므로 라운드가 시작된 뒤의 시간과 같습니다. */
  private clock = 0;
  private targetId: string | null = null;
  private retargetAt = 0;
  private tactic: Tactic = 'charge';
  private tacticUntil = 0;
  private backGoal = 0;
  /** 물러날 곳이 지금 있는 곳보다 높은지 여부입니다. */
  private high = false;
  private hopDir = 1;
  private heavyUntil = 0;
  private heavyReadyAt = 0;
  /** 상대와 떨어져 있던 마지막 때입니다. 그 뒤로는 계속 붙어 있었습니다. */
  private clinchAt = 0;
  private patience = STUCK_TIME_MAX;
  private lastVx = 0;
  private rescueAt = 0;
  /** 지난번에 본 다른 공들의 x와, 그 사이에 움직인 가로 속도(m/s)입니다. */
  private seen = new Map<string, { x: number; vx: number }>();
  private stunUntil = 0;
  /** 마지막으로 살펴본 다른 공들과, 다시 살필 때입니다. */
  private noticed: BotSense['others'] = [];
  private noticeAt = 0;
  /** 이번 라운드에 튕겨 나간 횟수입니다. */
  private bruises = 0;
  private leap: { ledge: number; x: number; since: number } | null = null;
  private runUpUntil = 0;
  private crossFrom = -1;
  private crossTo = -1;
  private crossAt = 0;
  private shot: Shot | null = null;
  private nextShotAt: number;
  private lastChanceAt: number;
  private wanderX = 0;
  private wanderUntil = 0;
  /** 마지막으로 움직인 좌우 방향입니다. 화살을 모으기 시작할 때 겨누는 방향이 이쪽의 비스듬한 위입니다. */
  private facing = 1;

  /** 상황을 다시 보고 입력을 고르는 간격(초)입니다. */
  private readonly interval: number;

  /** random은 0 이상 1 미만의 난수를 돌려주는 함수, skill은 수준에 따른 조절값입니다. */
  constructor(
    private readonly random: () => number = Math.random,
    private readonly skill: BotSkill = SKILLS.normal,
  ) {
    this.interval = Math.max(THINK_FLOOR, skill.think);
    this.nextShotAt = this.between(...skill.firstShot);
    this.lastChanceAt = this.nextShotAt;
    // 여러 AI가 같은 프레임에 한꺼번에 생각하지 않도록 처음 생각하는 때를 서로 어긋나게 합니다.
    this.elapsed = this.between(0, this.interval);
  }

  /**
   * dt초가 지난 뒤 낼 입력입니다. 생각할 때가 아니면 지난 입력을 그대로 돌려줍니다.
   * 모으던 화살만은 좌우 키를 쏘려는 방향에 이르는 순간에 떼고, 방향이 맞은 채로 정해 둔 만큼 모이는 순간에 놓습니다.
   */
  think(sense: BotSense, dt: number): Input {
    this.clock += dt;
    this.elapsed += dt;
    if (this.shot) {
      const turn = sense.aimDir ? turnTo(sense.aimDir, this.shot.dir) : 0;
      const aligned = Math.abs(turn) <= AIM_ALIGN;
      if (aligned && sense.charge * TUNING.arrowMaxCharge >= this.shot.release - 1e-9) {
        this.rest();
        this.held = { ...NO_INPUT };
      } else {
        this.held.left = turn < -AIM_ALIGN;
        this.held.right = turn > AIM_ALIGN;
      }
    }
    if (this.elapsed >= this.interval - 1e-9) {
      this.held = this.decide(sense);
      this.elapsed = 0;
    }
    // 모으는 동안의 좌우 키는 방향을 돌릴 뿐이므로, 움직일 때의 좌우만 기억합니다.
    if (!this.shot && this.held.left !== this.held.right) this.facing = this.held.right ? 1 : -1;
    return this.held;
  }

  private between(min: number, max: number): number {
    return min + (max - min) * this.random();
  }

  /**
   * 자리 끝을 넘어가지 않도록 입력을 고칩니다. 멈출 거리가 모자라면 반대로 밉니다.
   * ramming이면 앞에 있는 상대가 속력을 받아 줄 것으로 보고 미리 멈추지 않습니다. 끝자리를 넘어선 뒤에만 되돌아옵니다.
   */
  private guard(input: Input, me: Me, ledge: Ledge, ramming = false): Input {
    const margin = Math.min(this.skill.edgeMargin, (ledge.x1 - ledge.x0) / 2 - 0.1);
    const stop = ramming ? me.x : me.x + me.vx * this.interval + (me.vx * Math.abs(me.vx)) / (2 * BRAKE);
    if (Math.max(stop, me.x) > ledge.x1 - margin) {
      input.right = false;
      input.left = me.vx > 0 || me.x > ledge.x1 - margin;
    } else if (Math.min(stop, me.x) < ledge.x0 + margin) {
      input.left = false;
      input.right = me.vx < 0 || me.x < ledge.x0 + margin;
    }
    return input;
  }

  /** 손을 놓은 채 time초 동안 구르거나 비탈을 미끄러져도 자리 안에 남는지 봅니다. */
  private settles(me: Me, ledge: Ledge, time: number): boolean {
    const slope = heightAt(ledge, me.x + GRID) - heightAt(ledge, me.x - GRID);
    const slide = (TUNING.gravity * slope) / (2 * GRID);
    const x = me.x + me.vx * time + 0.5 * slide * time * time;
    return x > ledge.x0 + this.skill.edgeMargin && x < ledge.x1 - this.skill.edgeMargin;
  }

  /** 모으던 화살을 놓은 것으로 하고, 다시 모으기까지 쉴 시간을 정합니다. */
  private rest(): void {
    this.shot = null;
    this.nextShotAt = this.clock + TUNING.arrowCooldown + this.between(...this.skill.arrowRest);
    this.lastChanceAt = this.clock;
  }

  /** 지금 상황에서 고를 입력입니다. */
  private decide(sense: BotSense): Input {
    const { me, mode } = sense;
    const terrain = terrainOf(sense.map);
    const jolt =
      Math.abs(me.vx - this.lastVx) > STUN_JOLT &&
      sense.others.some((o) => Math.hypot(o.x - me.x, o.y - me.y) < STUN_RANGE);
    this.lastVx = me.vx;
    const seen = new Map<string, { x: number; vx: number }>();
    for (const o of sense.others) {
      seen.set(o.id, { x: o.x, vx: (o.x - (this.seen.get(o.id)?.x ?? o.x)) / this.interval });
    }
    this.seen = seen;
    const here = ledgeUnder(terrain, me.x, me.y);
    const ledge = terrain.ledges[here];
    if (this.shot) {
      // 모으는 동안에는 움직일 수 없으므로, 자리 밖으로 밀려나겠으면 그만 놓고 몸부터 챙깁니다.
      if (ledge && this.settles(me, ledge, this.interval * 2)) return this.aim(sense, this.shot);
      this.rest();
    }
    if (jolt && this.thrown(sense)) {
      // 맞을수록 오래 멍해지므로, 싸움이 길어지면 한 번 밀린 쪽이 끝까지 밀려 나갑니다.
      const worn = 1 + this.bruises * BRUISE_GAIN;
      const daze = Math.abs(me.vx) * this.between(...this.skill.stunRate) * worn;
      this.stunUntil = this.clock + Math.min(STUN_CAP_MAX, STUN_CAP * worn, daze);
      this.bruises++;
    }
    if (this.clock < this.stunUntil) return { ...NO_INPUT };

    const grounded = ledge !== undefined && heightAt(ledge, me.x) - me.y < TUNING.radius + GROUND_GAP;
    if (this.leap) {
      const over = this.clock - this.leap.since;
      if (over > LEAP_TIME || (grounded && over > LEAP_SETTLE)) this.leap = null;
      else return this.fly(sense, terrain.ledges[this.leap.ledge], this.leap.x);
    }
    if (!ledge) return this.recover(sense, terrain);
    // 다음에 자리 밖으로 밀려났을 때 벽을 차거나 줄을 걸기까지 걸릴 시간을 미리 정해 둡니다.
    this.rescueAt = this.clock + this.between(...this.skill.rescueDelay);
    if (sense.roped) return this.guard(steer(me, me.x, RUN_SPEED), me, ledge);

    const view = this.watch(sense);
    const target = this.pick(view, terrain, here);
    if (!target) return this.guard(steer(me, me.x, RUN_SPEED), me, ledge);
    return mode === 'arrows'
      ? this.archer(view, terrain, here, target, grounded)
      : this.brawl(view, terrain, here, target, grounded);
  }

  /**
   * 상대를 고르고 싸울 때 보는 상황입니다. 상대를 다시 살필 때가 되기 전에는 다른 공들이 지난번에 본 곳에 있다고 봅니다.
   * 내 위치와 속도는 늘 지금 값이므로, 상대를 늦게 알아차려도 자리 끝은 제때 살핍니다.
   */
  private watch(sense: BotSense): BotSense {
    if (this.skill.notice <= 0) return sense;
    if (this.clock >= this.noticeAt) {
      this.noticed = sense.others;
      this.noticeAt = this.clock + this.skill.notice;
    }
    // 그사이에 탈락한 공은 뺍니다.
    return { ...sense, others: this.noticed.filter((o) => sense.others.some((now) => now.id === o.id)) };
  }

  /** 가까운 공에게 부딪쳐 그 공에게서 멀어지는 쪽으로 튕겨 나가고 있는지 봅니다. */
  private thrown(sense: BotSense): boolean {
    const { me } = sense;
    return sense.others.some(
      (o) =>
        Math.hypot(o.x - me.x, o.y - me.y) < STUN_RANGE && (me.x - o.x) * me.vx > 0 && Math.abs(me.vx) > STUN_SPEED,
    );
  }

  /** 노릴 상대입니다. 몇 초마다 다시 고르고, 가까운 상대와 갈 수 있는 상대를 더 자주 고릅니다. */
  private pick(sense: BotSense, terrain: Terrain, here: number): Other | null {
    const { me, others } = sense;
    const current = others.find((o) => o.id === this.targetId);
    if (current && this.clock < this.retargetAt) return current;
    if (others.length === 0) return null;
    const weights = others.map((o) => {
      const there = ledgeUnder(terrain, o.x, o.y);
      const reachable = there < 0 || terrain.next[here][there] >= 0;
      return (reachable ? 1 : UNREACHABLE_WEIGHT) / (1 + Math.hypot(o.x - me.x, o.y - me.y));
    });
    let roll = this.random() * weights.reduce((sum, w) => sum + w, 0);
    let chosen = others[others.length - 1];
    for (let i = 0; i < others.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        chosen = others[i];
        break;
      }
    }
    if (chosen.id !== this.targetId) this.tactic = 'charge';
    this.targetId = chosen.id;
    this.retargetAt = this.clock + this.between(RETARGET_MIN, RETARGET_MAX);
    return chosen;
  }

  /** 설 자리가 아래에 없을 때 가장 가까운 자리로 돌아갑니다. */
  private recover(sense: BotSense, terrain: Terrain): Input {
    const { me } = sense;
    let best: Ledge | null = null;
    let bestCost = Infinity;
    for (const ledge of terrain.ledges) {
      const side = Math.max(ledge.x0 - me.x, me.x - ledge.x1, 0);
      const near = Math.max(ledge.x0, Math.min(ledge.x1, me.x));
      const sunk = Math.max(0, me.y + TUNING.radius - heightAt(ledge, near));
      // 이미 윗면보다 낮아진 자리는 벽을 타고 올라가야 하므로 뒤로 미루고, 바로 밑에 들어간 자리는 맨 뒤로 미룹니다.
      const cost = side + sunk * 2 + (side === 0 && sunk > 0 ? UNDER_COST : 0);
      if (cost < bestCost) {
        best = ledge;
        bestCost = cost;
      }
    }
    if (!best) return { ...NO_INPUT };
    const inset = Math.min(LAND_INSET, (best.x1 - best.x0) / 2);
    return this.fly(sense, best, Math.max(best.x0 + inset, Math.min(best.x1 - inset, me.x)));
  }

  /** 공중에서 ledge의 x 지점에 내리도록 움직입니다. 윗면보다 낮아지면 벽을 차고, 갈고리 모드에서는 줄을 겁니다. */
  private fly(sense: BotSense, ledge: Ledge, x: number): Input {
    const { me, mode } = sense;
    const input = steer(me, x, this.skill.chargeSpeed);
    const sunk = me.y + TUNING.radius - heightAt(ledge, x);
    // 윗면보다 너무 깊이 떨어졌으면 벽을 차거나 줄을 걸어도 올라올 수 없다고 보고 포기합니다.
    if (sunk <= 0.1 || sunk > RESCUE_DEPTH || this.clock < this.rescueAt) return input;
    input.up = true;
    if (mode !== 'grapple') return input;
    if (sense.roped) {
      // 매달려 흔들리는 동안에는 줄을 잡고, 벽에 붙어 느려지면 줄을 놓고 벽을 찹니다.
      input.special = Math.hypot(me.vx, me.vy) > ROPE_SLOW;
    } else if (me.vy > 0 && (me.x < ledge.x0 || me.x > ledge.x1)) {
      // 자리 모서리가 가까울 때만 줄을 겁니다. 멀리서 걸면 자리 밑으로 흔들려 들어가 올라올 수 없습니다.
      const corner = me.x < ledge.x0 ? ledge.x0 : ledge.x1;
      const near = Math.hypot(corner - me.x, heightAt(ledge, corner) - me.y) <= HOOK_REACH;
      // 줄은 누르는 순간에만 걸리므로, 누르고 있었다면 한 번 뗍니다. 잠겨 있거나 충전량이 거의 없으면 벽만 찹니다.
      input.special = near && !this.held.special && !sense.locked && sense.fuel >= HOOK_FUEL;
    }
    return input;
  }

  /** 상대가 다른 자리에 있으면 그쪽으로 건너가는 입력을, 같은 자리에 있으면 null을 돌려줍니다. */
  private approach(sense: BotSense, terrain: Terrain, here: number, target: Other, grounded: boolean): Input | null {
    const { me } = sense;
    const there = ledgeUnder(terrain, target.x, target.y);
    if (there < 0 || there === here) return null;
    const ledge = terrain.ledges[here];
    const hop = terrain.next[here][there];
    const way = hop < 0 ? null : crossing(ledge, terrain.ledges[hop]);
    if (!way && hop >= 0) {
      // 움직이는 발판이 아직 멀리 있으면, 그쪽 끝에서 조금 물러나 발판이 다가오기를 기다립니다.
      const side = terrain.ledges[hop].x0 >= ledge.x1 ? ledge.x1 - WAIT_INSET : ledge.x0 + WAIT_INSET;
      return this.guard(steer(me, Math.max(ledge.x0, Math.min(ledge.x1, side)), RUN_SPEED), me, ledge);
    }
    // 건널 수 없으면 상대와 가까운 쪽 끝에서 기다립니다.
    if (!way) return this.guard(steer(me, target.x, RUN_SPEED), me, ledge);
    // 마주 보고 동시에 뛰어 틈 위에서 부딪치지 않도록, 건너기로 마음먹은 뒤 잠깐씩 다르게 뜸을 들입니다.
    if (here !== this.crossFrom || hop !== this.crossTo) {
      this.crossFrom = here;
      this.crossTo = hop;
      this.crossAt = this.clock + this.between(0, CROSS_WAIT_MAX);
    }
    if (this.clock < this.crossAt) return this.guard(steer(me, me.x, RUN_SPEED), me, ledge);
    // 자리 끝까지는 조심해서 다가가고, 지금 속력으로 건너편에 닿겠다 싶을 때만 뜁니다.
    const toEdge = Math.max(0, way.dir * (way.edge - me.x));
    const enough = way.dir * me.vx >= leapSpeed(way, toEdge);
    if (grounded && toEdge <= LEAP_FROM && enough) {
      this.leap = { ledge: hop, x: way.land, since: this.clock };
      return { ...rush(me, way.dir, this.skill.chargeSpeed), up: true };
    }
    if (toEdge <= this.skill.edgeMargin * 2 && !enough) this.runUpUntil = this.clock + RUN_UP_TIME;
    const dir = this.clock < this.runUpUntil ? -way.dir : way.dir;
    return this.guard(rush(me, dir, RUN_SPEED), me, ledge);
  }

  /** 클래식·갈고리에서 상대에게 달려들어 부딪치고, 물러났다가 다시 달려듭니다. */
  private brawl(sense: BotSense, terrain: Terrain, here: number, target: Other, grounded: boolean): Input {
    const across = this.approach(sense, terrain, here, target, grounded);
    if (across) return across;
    const { me, mode } = sense;
    const ledge = terrain.ledges[here];
    const dx = target.x - me.x;
    const dir = dx >= 0 ? 1 : -1;
    const dist = Math.hypot(dx, target.y - me.y);

    if (dist > CLINCH_RANGE) {
      // 맞붙은 둘이 같은 순간에 같은 행동을 하지 않도록 참는 시간을 매번 다르게 잡습니다.
      this.patience = this.between(STUCK_TIME_MIN, STUCK_TIME_MAX);
      this.clinchAt = this.clock;
    } else if (this.clock - this.clinchAt > this.patience) {
      this.clinchAt = this.clock;
      if (this.random() < HOP_CHANCE) this.startHop(dir);
      else this.startRetreat(me, ledge, dir);
    }
    if (this.tactic !== 'charge' && this.clock >= this.tacticUntil) this.tactic = 'charge';

    let input: Input;
    if (this.tactic === 'retreat') {
      const room = dir > 0 ? me.x - ledge.x0 : ledge.x1 - me.x;
      if (room < BACK_ROOM) this.startHop(dir);
      else if ((this.backGoal - me.x) * dir > -ARRIVE_SLACK && (!this.high || dist < HOLD_RANGE))
        this.tactic = 'charge';
    }
    if (this.tactic === 'retreat') {
      input = this.high ? steer(me, this.backGoal, RUN_SPEED) : rush(me, -dir, RUN_SPEED);
    } else if (this.tactic === 'hop') {
      input = rush(me, this.hopDir, RUN_SPEED);
      if (dir === this.hopDir && grounded && Math.abs(dx) < HOP_RANGE) input.up = true;
      if (dir !== this.hopDir && Math.abs(dx) > HOP_CLEAR) this.tactic = 'charge';
    } else {
      input = rush(me, dir, this.skill.chargeSpeed);
      if (grounded && me.y - target.y >= JUMP_IF_ABOVE && Math.abs(dx) < JUMP_IF_NEAR) input.up = true;
    }
    if (mode === 'classic') {
      const closing = Math.max(0, dir * (me.vx - (this.seen.get(target.id)?.vx ?? 0)));
      if (
        this.tactic !== 'retreat' &&
        this.clock >= this.heavyReadyAt &&
        sense.heft >= HEAVY_WORTH &&
        dist < HEAVY_RANGE + closing * this.interval
      ) {
        // 때를 놓치는 경우도 있어야 한쪽만 무거운 채로 부딪쳐 승부가 납니다.
        this.heavyUntil = this.random() < this.skill.heavyChance ? this.clock + this.between(HEAVY_MIN, HEAVY_MAX) : this.clock;
        this.heavyReadyAt = this.heavyUntil + this.between(HEAVY_REST_MIN, HEAVY_REST_MAX);
      }
      input.heavy = this.clock < this.heavyUntil - 1e-9;
    }
    // 달아나는 상대는 부딪쳐도 속력을 받아 주지 못하므로, 거의 서 있거나 다가오는 상대만 그대로 들이받습니다.
    const ramming =
      this.tactic === 'charge' &&
      Math.abs(dx) < this.skill.ramRange &&
      target.x > ledge.x0 &&
      target.x < ledge.x1 &&
      dir * (this.seen.get(target.id)?.vx ?? 0) < RAM_DRIFT;
    return this.guard(input, me, ledge, ramming);
  }

  /** 상대 반대쪽으로 물러날 곳을 정합니다. 그쪽이 오르막이면 내리막 힘을 받아 달려들 수 있게 꼭대기까지 올라갑니다. */
  private startRetreat(me: Me, ledge: Ledge, dir: number): void {
    const lo = ledge.x0 + this.skill.edgeMargin * 2;
    const hi = Math.max(lo, ledge.x1 - this.skill.edgeMargin * 2);
    const clamp = (x: number) => Math.max(lo, Math.min(hi, x));
    let goal = clamp(me.x - dir * this.between(BACK_OFF_MIN, BACK_OFF_MAX));
    for (let x = clamp(me.x - dir); Math.abs(x - me.x) <= HIGH_GROUND_REACH; x -= dir) {
      if (heightAt(ledge, x) < heightAt(ledge, goal) - HIGH_GROUND_RISE) goal = x;
      if (x === clamp(x - dir)) break;
    }
    this.tactic = 'retreat';
    this.backGoal = goal;
    this.high = heightAt(ledge, goal) < heightAt(ledge, me.x) - HIGH_GROUND_RISE;
    this.tacticUntil =
      this.clock +
      BACK_OFF_TIME +
      Math.abs(goal - me.x) / BACK_OFF_PACE +
      (this.high ? this.between(HOLD_TIME_MIN, HOLD_TIME_MAX) : 0);
  }

  private startHop(dir: number): void {
    this.tactic = 'hop';
    this.hopDir = dir;
    this.tacticUntil = this.clock + HOP_TIME;
  }

  /** 화살 모드에서 쏠 수 있으면 모으기 시작하고, 아니면 거리를 두고 움직입니다. */
  private archer(sense: BotSense, terrain: Terrain, here: number, target: Other, grounded: boolean): Input {
    const { me } = sense;
    const ledge = terrain.ledges[here];
    if (this.clock >= this.nextShotAt && grounded && this.settles(me, ledge, ARROW_CHARGE_MAX)) {
      const prefer = this.between(ARROW_CHARGE_MIN, ARROW_CHARGE_MAX);
      for (const other of [target, ...sense.others.filter((o) => o !== target)]) {
        // 모으기 시작하면 마지막에 움직이던 쪽의 비스듬한 위를 겨누므로, 거기서 돌릴 시간을 셈에 넣습니다.
        const turning = { aim: [this.facing * DIAGONAL, -DIAGONAL] as const, charge: 0 };
        const plan = aimShot(sense.map, me, other, prefer, ARROW_CHARGE_MIN, this.skill.aimTolerance, turning);
        if (!plan) continue;
        this.shot = { ...plan, id: other.id, prefer, since: this.clock };
        this.lastChanceAt = this.clock;
        return { ...NO_INPUT, special: true };
      }
    }
    if (this.clock - this.lastChanceAt > ARROW_PATIENCE) {
      const across = this.approach(sense, terrain, here, target, grounded);
      if (across) return across;
    }
    if (this.clock >= this.wanderUntil) {
      this.wanderUntil = this.clock + this.between(WANDER_MIN, WANDER_MAX);
      const lo = ledge.x0 + this.skill.edgeMargin * 2;
      const hi = Math.max(lo, ledge.x1 - this.skill.edgeMargin * 2);
      const clamp = (x: number) => Math.max(lo, Math.min(hi, x));
      if (ledgeUnder(terrain, target.x, target.y) === here) {
        const side = me.x >= target.x ? 1 : -1;
        const away = this.between(ARROW_NEAR, ARROW_FAR);
        this.wanderX = clamp(target.x + side * away);
        if (Math.abs(this.wanderX - target.x) < ARROW_NEAR) this.wanderX = clamp(target.x - side * away);
      } else {
        this.wanderX = this.between(lo, hi);
      }
    }
    return this.guard(steer(me, this.wanderX, RUN_SPEED), me, ledge);
  }

  /** 모으는 동안 쏘려는 방향과 놓을 때를 고쳐 잡습니다. 너무 오래 모이지 않으면 그만둡니다. 좌우 키는 think가 step마다 정합니다. */
  private aim(sense: BotSense, shot: Shot): Input {
    const charge = sense.charge * TUNING.arrowMaxCharge;
    if (this.clock - shot.since > TUNING.arrowCooldown + ARROW_CHARGE_MAX + this.interval) {
      this.rest();
      return { ...NO_INPUT };
    }
    const target = sense.others.find((o) => o.id === shot.id);
    const plan =
      target &&
      aimShot(
        sense.map,
        sense.me,
        target,
        shot.prefer,
        Math.max(ARROW_CHARGE_MIN, charge + TUNING.step),
        this.skill.aimTolerance,
        sense.aimDir && { aim: sense.aimDir, charge },
      );
    if (plan) {
      shot.dir = plan.dir;
      shot.release = plan.release;
    }
    const turn = sense.aimDir ? turnTo(sense.aimDir, shot.dir) : 0;
    return { ...NO_INPUT, special: true, left: turn < -AIM_ALIGN, right: turn > AIM_ALIGN };
  }
}
