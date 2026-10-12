/** 한 경기 실행. 물리 세계, 경기 진행, AI, 받은 상태 맞추기를 묶습니다. */
import { Bot } from './game/bot';
import { MAX_PLAYERS } from './game/lobby';
import { MAPS, spawnSlot } from './game/maps';
import type { GameMap, Shape } from './game/maps';
import { TUNING } from './game/modes';
import { DEFAULT_SETTINGS, advance, botIds, isBot, lobbyMatch, startMatch, toLobby } from './game/round';
import type { Match, Settings } from './game/round';
import { roundKey } from './net/wire';
import type { BallWire, HostWire, PeerState } from './net/wire';
import { NO_INPUT, World, packInput, unpackInput } from './physics/world';
import type { ArrowView, BallView, Input, WorldEvent } from './physics/world';

/** 상대 공의 받은 위치를 이만큼 앞으로 옮겨서 맞춥니다(초). 통신 지연의 어림값입니다. */
export const NET_LEAD = 0.1;
/** 한 프레임의 경과 시간이 이보다 길면 밀린 시간을 계산하지 않습니다(밀리초). */
export const MAX_FRAME_MS = 500;
/** 참가자가 방에서 보이지 않아도 이만큼은 나간 것으로 보지 않습니다(밀리초). 방을 중계하는 사람이 바뀌는 동안에는 목록이 잠깐 빕니다. */
export const ABSENT_GRACE_MS = 3000;

/** 방장이 아닐 때, 받은 경기 시간과 내 시계가 이보다 크게 어긋나면 바로 맞춥니다(밀리초). */
export const CLOCK_SNAP_MS = 250;
/** 방장이 아닐 때, 경기 시간을 받을 때마다 어긋난 만큼의 이 비율을 내 시계에 반영합니다. */
const CLOCK_PULL = 0.2;

/** 한 프레임에 진행하는 step의 최대 수입니다. */
const MAX_STEPS = 10;

/** 한 프레임에 방에서 읽은 내용입니다. */
export interface Frame {
  /** 내가 방장인지 여부. */
  hosting: boolean;
  /** 방장이 올린 경기 상태(내가 방장이면 무시한다). */
  host: HostWire | null;
  /** 방에 있는 다른 사람들. */
  peers: readonly PeerState[];
}

/** 화면에 그릴 한 순간의 모습입니다. map은 대기실이면 null입니다. shapes는 발판들이 지금 있는 위치의 도형입니다. */
export interface SessionView {
  match: Match;
  map: GameMap | null;
  shapes: readonly Shape[];
  balls: BallView[];
  arrows: ArrowView[];
  /** 내가 이번 라운드에 참가하지 않고 구경 중인지 여부. */
  watching: boolean;
  me: string;
  /** 마지막 step 직전의 모습입니다. 그리기에서 지금 모습과 이어 그리는 데 씁니다. 라운드가 막 시작되어 아직 없으면 null입니다. */
  prev: PrevView | null;
  /** 발판의 위치를 정한 시간(초)입니다. */
  time: number;
  /** 마지막 step 뒤로 지난 시간을 step 길이로 나눈 값(0~1)입니다. */
  alpha: number;
}

/** step 하나를 진행하기 직전의 공, 화살, 발판 시간입니다. */
export interface PrevView {
  balls: BallView[];
  arrows: ArrowView[];
  time: number;
}

/** 한 경기를 실행합니다. 내 공과 (방장일 때의) AI 공은 여기서 정하고, 나머지는 받은 상태를 따릅니다. */
export class Session {
  private current: Match = lobbyMatch({ ...DEFAULT_SETTINGS });
  private world: World | null = null;
  private map: GameMap | null = null;
  /** 지금 세계가 속한 라운드 열쇠입니다. 세계가 없으면 0입니다. */
  private key = 0;
  private hosting = false;
  private acc = 0;
  /**
   * play 단계가 시작된 뒤 지난 시간(밀리초)입니다. 움직이는 발판의 위치를 정합니다.
   * 방장은 경기 상태의 ms를 그대로 쓰고, 나머지는 방장이 올린 ms를 따라가도록 맞춥니다.
   */
  private clock = 0;
  /** 시계를 맞추는 데 마지막으로 쓴 방장의 ms입니다. */
  private clockSeen = -1;
  /** 세계에 마지막으로 알려 준 play 단계의 경과 시간(초)입니다. */
  private worldTime = 0;
  /** 마지막 step 직전의 모습입니다. 그리기에만 씁니다. */
  private before: PrevView | null = null;
  private input: Readonly<Input> = NO_INPUT;
  private readonly bots = new Map<string, Bot>();
  private readonly botInputs = new Map<string, Input>();
  /** 사람마다 마지막으로 적용한 소식의 번호입니다. */
  private readonly seen = new Map<string, number>();
  /** 이번 라운드 도중에 방에서 사라진 사람입니다. 다시 나타나도 다음 라운드까지는 탈락으로 봅니다. */
  private readonly gone = new Set<string>();
  /** 참가자마다 방에서 보이지 않은 채로 지난 시간(밀리초)입니다. 다시 보이면 지웁니다. */
  private readonly absent = new Map<string, number>();
  /** AI 공에 마지막으로 적용한 방장 소식의 번호입니다. */
  private hostSeen: number | null = null;

  constructor(
    private readonly me: string,
    private readonly random: () => number = Math.random,
  ) {}

  /** 지금 따르고 있는 경기 상태입니다. */
  get match(): Match {
    return this.current;
  }

  /** 방장: 설정을 바꿉니다(대기실에서만). */
  setSettings(patch: Partial<Settings>): void {
    if (this.current.phase !== 'lobby') return;
    this.current = { ...this.current, settings: { ...this.current.settings, ...patch } };
  }

  /** 방장: 경기를 시작합니다. humans는 참가할 사람의 id(나 포함, 자리 순서)입니다. */
  start(humans: readonly string[]): void {
    if (this.current.phase !== 'lobby') return;
    this.hosting = true;
    this.current = startMatch(this.current, this.withBots(humans), this.random);
    this.syncWorld();
  }

  /** 방장: 최종 결과에서 대기실로 돌아갑니다. */
  backToLobby(): void {
    this.current = toLobby(this.current);
    this.syncWorld();
  }

  /** 매 프레임 부릅니다. 세계를 진행하고 그동안 일어난 일을 돌려줍니다. */
  update(dtMs: number, input: Input, frame: Frame): WorldEvent[] {
    const dt = dtMs >= 0 && dtMs <= MAX_FRAME_MS ? dtMs : 0;
    if (frame.hosting !== this.hosting) {
      this.hosting = frame.hosting;
      this.assignBots();
    }
    if (frame.hosting) {
      if (this.current.phase !== 'lobby') {
        const here = frame.peers.map((p) => p.peer);
        // 잠깐 보이지 않는 참가자는 아직 방에 있는 것으로 보고 다음 라운드에도 넣습니다.
        const waiting = [...this.absent.keys()].filter((id) => !here.includes(id));
        const present = this.withBots([this.me, ...here, ...waiting]);
        this.current = advance(this.current, dt, this.alive(frame.peers), present, this.random);
      }
    } else if (frame.host) {
      const { bs, ...match } = frame.host;
      this.current = match;
    }
    this.syncWorld();
    const world = this.world;
    if (!world) return [];
    this.syncClock(dt);

    const events: WorldEvent[] = [];
    this.applyRemote(world, frame, dt, events);
    const { phase } = this.current;
    this.input = phase === 'play' ? { ...input } : NO_INPUT;
    world.setInput(this.me, this.input);
    if (phase !== 'play') this.rest(world);
    if (phase === 'countdown') {
      this.acc = 0;
      return events;
    }
    this.acc += dt / 1000;
    for (let steps = 0; steps < MAX_STEPS && this.acc >= TUNING.step; steps++) {
      this.acc -= TUNING.step;
      if (phase === 'play') this.think(world);
      this.before = { balls: world.balls(), arrows: world.arrows(), time: this.worldTime };
      // 아직 계산하지 않고 남겨 둔 시간만큼은 시계에서 뺍니다. play가 아니면 시간을 그대로 두어 발판을 멈춥니다.
      if (phase === 'play') this.worldTime = Math.max(0, this.clock / 1000 - this.acc);
      events.push(...world.step(this.worldTime));
    }
    if (this.acc >= TUNING.step) this.acc = 0;
    return events;
  }

  /** 내가 올릴 공 상태입니다. 참가 중이 아니면 key 0, ball null입니다. */
  mine(): { key: number; ball: BallWire | null } {
    if (!this.world || !this.current.roster.includes(this.me)) return { key: 0, ball: null };
    return { key: this.key, ball: this.wire(this.world, this.me, this.input) };
  }

  /** 방장일 때 올릴 경기 상태입니다(AI 공 포함). */
  hostWire(): HostWire {
    const bs: Record<string, BallWire> = {};
    if (this.world) {
      for (const id of this.current.roster) {
        if (isBot(id)) bs[id] = this.wire(this.world, id, this.botInputs.get(id) ?? NO_INPUT);
      }
    }
    return { ...this.current, bs };
  }

  /** 화면에 그릴 지금의 모습입니다. */
  view(): SessionView {
    const { phase, roster } = this.current;
    return {
      match: this.current,
      map: this.map,
      shapes: this.world?.shapes() ?? [],
      balls: this.world?.balls() ?? [],
      arrows: this.world?.arrows() ?? [],
      watching: phase !== 'lobby' && !roster.includes(this.me),
      me: this.me,
      prev: this.before,
      time: this.worldTime,
      alpha: Math.min(1, this.acc / TUNING.step),
    };
  }

  /** 사람 목록 뒤에 AI를 붙입니다. 사람과 AI를 합쳐 6명까지입니다. */
  private withBots(humans: readonly string[]): string[] {
    const people = humans.slice(0, MAX_PLAYERS);
    return [...people, ...botIds(Math.min(this.current.settings.bots, MAX_PLAYERS - people.length))];
  }

  /**
   * 방장이 보는 생존자입니다. 나와 AI는 내 세계에서, 다른 사람은 그 사람이 올린 상태에서 판단합니다.
   * 방에서 잠깐 보이지 않는 사람은 나간 것으로 정해지기 전까지 생존으로 봅니다.
   */
  private alive(peers: readonly PeerState[]): string[] {
    const world = this.world;
    if (!world) return [];
    return this.current.roster.filter((id) => {
      if (id === this.me || isBot(id)) return world.alive(id);
      if (this.gone.has(id)) return false;
      const peer = peers.find((p) => p.peer === id);
      return peer === undefined || peer.key !== this.key || peer.ball?.a === true;
    });
  }

  /** 경기 상태에 맞는 세계를 둡니다. 라운드가 바뀌었으면 새로 만들고 대기실이면 버립니다. */
  private syncWorld(): void {
    const { phase, game, round, roster, settings } = this.current;
    const key = phase === 'lobby' ? 0 : roundKey(game, round);
    if (phase !== 'lobby' && this.world && key === this.key) return;
    this.key = key;
    this.acc = 0;
    this.clock = 0;
    this.clockSeen = -1;
    this.worldTime = 0;
    this.before = null;
    this.input = NO_INPUT;
    this.seen.clear();
    this.gone.clear();
    this.hostSeen = null;
    if (phase === 'lobby') {
      this.absent.clear();
      this.world = null;
      this.map = null;
      this.assignBots();
      return;
    }
    const map = MAPS[this.current.map];
    const world = new World(map, settings.mode);
    roster.forEach((id, i) => {
      const [x, y] = map.spawns[spawnSlot(i, round)];
      world.addBall(id, x, y, id === this.me);
    });
    this.world = world;
    this.map = map;
    this.assignBots();
  }

  /**
   * play 단계의 경과 시간을 정합니다. 방장은 자기가 진행하는 ms가 곧 그 시간입니다.
   * 나머지는 프레임마다 스스로 흐르게 두고, 방장의 ms를 새로 받을 때마다 통신 지연(NET_LEAD)을 더한 값 쪽으로 당깁니다.
   * 발판의 위치는 이 시간만으로 정해지므로, 시간이 맞으면 어느 브라우저에서나 발판이 같은 곳에 있습니다.
   */
  private syncClock(dt: number): void {
    const { phase, ms } = this.current;
    if (phase !== 'play') {
      if (phase === 'countdown') this.clock = 0;
      return;
    }
    if (this.hosting) {
      this.clock = ms;
    } else {
      this.clock += dt;
      if (ms !== this.clockSeen) {
        const off = ms + NET_LEAD * 1000 - this.clock;
        this.clock += Math.abs(off) > CLOCK_SNAP_MS ? off : off * CLOCK_PULL;
      }
    }
    this.clockSeen = ms;
  }

  /** 방장이면 AI 공을 내가 정하는 공으로 바꾸고 AI를 만듭니다. 아니면 받은 상태를 따르게 합니다. */
  private assignBots(): void {
    this.bots.clear();
    this.botInputs.clear();
    if (!this.world) return;
    for (const id of this.current.roster) {
      if (!isBot(id)) continue;
      this.world.setLocal(id, this.hosting);
      if (this.hosting) this.bots.set(id, new Bot(this.random));
    }
  }

  /**
   * 받은 상태로 다른 사람의 공과 (방장이 아닐 때의) AI 공을 맞춥니다.
   * 방에서 보이지 않는 참가자는 ABSENT_GRACE_MS가 지난 뒤에 탈락시키고, 그동안에는 마지막 입력으로 계속 움직이게 둡니다.
   */
  private applyRemote(world: World, frame: Frame, dt: number, events: WorldEvent[]): void {
    for (const id of this.current.roster) {
      if (id === this.me || isBot(id) || this.gone.has(id)) continue;
      const peer = frame.peers.find((p) => p.peer === id);
      if (!peer) {
        const waited = (this.absent.get(id) ?? 0) + dt;
        if (waited < ABSENT_GRACE_MS) {
          this.absent.set(id, waited);
          continue;
        }
        this.absent.delete(id);
        this.gone.add(id);
        this.eliminate(world, id, events);
        continue;
      }
      this.absent.delete(id);
      if (peer.key === this.key && peer.ball) {
        this.follow(world, id, peer.ball, peer.n !== this.seen.get(id), events);
        this.seen.set(id, peer.n);
      }
    }
    if (frame.hosting || !frame.host) return;
    // 방장이 바뀌는 동안에는 두 사람이 경기 상태를 올릴 수 있으므로, 받은 것과 같은 객체를 올린 사람을 먼저 찾습니다.
    const sender = frame.peers.find((p) => p.host === frame.host) ?? frame.peers.find((p) => p.host !== null);
    const n = sender?.n ?? -1;
    const fresh = n !== this.hostSeen;
    this.hostSeen = n;
    for (const id of this.current.roster) {
      const ball = isBot(id) ? frame.host.bs[id] : undefined;
      if (ball) this.follow(world, id, ball, fresh, events);
    }
  }

  /** 원격 공 하나를 받은 상태에 맞춥니다. fresh는 지난번과 다른 소식인지 여부입니다. */
  private follow(world: World, id: string, ball: BallWire, fresh: boolean, events: WorldEvent[]): void {
    if (fresh) {
      if (ball.a) {
        const { b } = ball;
        world.setInput(id, unpackInput(ball.i));
        const to = { ...b, x: b.x + b.vx * NET_LEAD, y: b.y + b.vy * NET_LEAD };
        if (world.correct(id, to)) {
          // 바로 옮겨진 공은 직전 모습도 같은 곳에 두어, 화면에서 그 사이를 가로질러 그리지 않게 합니다.
          const was = this.before?.balls.find((ball) => ball.id === id);
          if (was) {
            was.x = to.x;
            was.y = to.y;
          }
        }
        world.setRope(id, ball.rp);
        world.setAim(id, ball.am && { dx: ball.am[0], dy: ball.am[1], charge: ball.am[2] });
      }
      world.syncShots(id, ball.ar);
    }
    if (!ball.a) this.eliminate(world, id, events);
  }

  /** 원격 공을 탈락시키고 효과에 쓸 out을 한 번 남깁니다. */
  private eliminate(world: World, id: string, events: WorldEvent[]): void {
    const at = world.state(id);
    if (!at) return;
    world.kill(id);
    events.push({ type: 'out', id, x: at.x, y: at.y, cause: 'fall' });
  }

  /** play가 아닐 때 나와 AI의 조작을 멈춥니다. 모으던 화살은 쏘지 않고 버립니다. */
  private rest(world: World): void {
    world.cancelCharge(this.me);
    for (const id of this.bots.keys()) {
      this.botInputs.set(id, NO_INPUT);
      world.setInput(id, NO_INPUT);
      world.cancelCharge(id);
    }
  }

  /** 생존한 AI마다 이번 step의 입력을 정합니다. */
  private think(world: World): void {
    if (!this.map) return;
    const map = world.footing();
    for (const [id, bot] of this.bots) {
      const me = world.state(id);
      if (!me) continue;
      const others = world.balls().filter((b) => b.alive && b.id !== id);
      const sense = {
        map,
        mode: this.current.settings.mode,
        me,
        others,
        roped: world.rope(id) !== null,
        charge: world.aim(id)?.charge ?? 0,
      };
      const input = bot.think(sense, TUNING.step);
      this.botInputs.set(id, input);
      world.setInput(id, input);
    }
  }

  /** 공 하나를 올릴 모양으로 만듭니다. 탈락한 공은 마지막 위치에 멈춘 것으로 올립니다. */
  private wire(world: World, id: string, input: Readonly<Input>): BallWire {
    const last = world.balls().find((b) => b.id === id);
    const aim = world.aim(id);
    return {
      b: world.state(id) ?? { x: last?.x ?? 0, y: last?.y ?? 0, vx: 0, vy: 0, av: 0 },
      i: packInput(input),
      a: world.alive(id),
      rp: world.rope(id),
      am: aim && [aim.dx, aim.dy, aim.charge],
      ar: world.shots(id),
    };
  }
}
