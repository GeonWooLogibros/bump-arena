import { describe, expect, it } from 'vitest';
import { MAPS, moveOffset, spawnSlot } from '../src/game/maps';
import type { Settings } from '../src/game/round';
import { encodeBall, encodeHost, readPeer, roundKey } from '../src/net/wire';
import type { PeerState } from '../src/net/wire';
import { NO_INPUT } from '../src/physics/world';
import type { BallView, Input, WorldEvent } from '../src/physics/world';
import { ABSENT_GRACE_MS, MAX_FRAME_MS, NET_LEAD, Session } from '../src/session';
import type { Frame } from '../src/session';

const FRAME_MS = 16;
/** 방에 상태를 올리는 간격(프레임 수)입니다. 16ms × 4 = 64ms입니다. */
const PUBLISH_EVERY = 4;
const SOLO: Frame = { hosting: true, host: null, peers: [] };

function press(...keys: (keyof Input)[]): Input {
  const input = { ...NO_INPUT };
  for (const key of keys) input[key] = true;
  return input;
}

/** ms만큼을 16ms씩 나눠 update합니다. */
function tick(session: Session, ms: number, input: Input = NO_INPUT, frame: Frame = SOLO): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let left = ms; left > 0; left -= FRAME_MS) events.push(...session.update(Math.min(FRAME_MS, left), input, frame));
  return events;
}

/** 조건이 참이 될 때까지 16ms씩 update합니다. limitMs 안에 참이 되지 않으면 실패합니다. */
function tickUntil(session: Session, done: () => boolean, input: Input, limitMs = 60000): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let ms = 0; !done(); ms += FRAME_MS) {
    if (ms >= limitMs) throw new Error('조건이 제한 시간 안에 참이 되지 않았습니다.');
    events.push(...session.update(FRAME_MS, input, SOLO));
  }
  return events;
}

/** 평지에서 AI 1명과 하는 연습 경기입니다. */
function practice(patch: Partial<Settings> = {}): Session {
  const session = new Session('me', () => 0);
  session.setSettings({ bots: 1, mapSetting: 0, ...patch });
  session.start(['me']);
  return session;
}

function ball(session: Session, id: string): BallView {
  const found = session.view().balls.find((b) => b.id === id);
  if (!found) throw new Error(`${id} 공이 없습니다.`);
  return found;
}

function outs(events: WorldEvent[], id: string): WorldEvent[] {
  return events.filter((e) => e.type === 'out' && e.id === id);
}

/** 세션이 올릴 값을 실제 통신 형식으로 바꿨다가 다시 읽어서 만든 상태입니다. */
function publish(session: Session, id: string, n: number, hosting: boolean): PeerState {
  const { key, ball: mine } = session.mine();
  const presence = {
    name: id,
    color: 0,
    ready: true,
    since: 1,
    key,
    n,
    ball: mine && encodeBall(mine),
    host: hosting ? encodeHost(session.hostWire()) : null,
  };
  return readPeer(id, false, JSON.parse(JSON.stringify(presence)));
}

/** 여러 세션을 한 방처럼 묶습니다. 가장 먼저 들어온 사람이 방장이고, 4프레임마다 상태를 올립니다. */
class Room {
  readonly inputs = new Map<string, Input>();
  readonly events = new Map<string, WorldEvent[]>();
  readonly states = new Map<string, PeerState>();
  private readonly sessions = new Map<string, Session>();
  /** 모든 사람의 peers 맨 앞에 끼워 넣는 상태입니다. */
  extra: PeerState[] = [];
  private readonly frozen = new Set<string>();
  private readonly hidden = new Set<string>();
  private forcedHost: string | null = null;
  private frames = 0;

  constructor(ids: string[]) {
    for (const id of ids) this.join(id);
  }

  get host(): string {
    return this.forcedHost ?? [...this.sessions.keys()][0];
  }

  /** 방장을 바꿉니다. 이전 방장은 다음 프레임부터 참가자가 됩니다. */
  setHost(id: string): void {
    this.forcedHost = id;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`${id} 세션이 없습니다.`);
    return session;
  }

  join(id: string): void {
    this.sessions.set(id, new Session(id, () => 0));
    this.events.set(id, []);
  }

  /** 방에서 나갑니다. 올린 상태도 사라집니다. */
  leave(id: string): void {
    this.sessions.delete(id);
    this.states.delete(id);
  }

  /** 더는 계산하지도 올리지도 않게 합니다. 마지막으로 올린 상태는 방에 남습니다. */
  freeze(id: string): void {
    this.frozen.add(id);
  }

  /** 멈췄던 사람이 다시 계산하고 올리게 합니다. */
  thaw(id: string): void {
    this.frozen.delete(id);
  }

  /** 계산은 계속하지만 다른 사람에게 보이지 않게 합니다(잠깐 끊긴 연결). */
  hide(id: string): void {
    this.hidden.add(id);
  }

  show(id: string): void {
    this.hidden.delete(id);
  }

  run(ms: number): void {
    for (let left = ms; left > 0; left -= FRAME_MS) this.frame();
  }

  runUntil(done: () => boolean, limitMs = 60000): void {
    for (let ms = 0; !done(); ms += FRAME_MS) {
      if (ms >= limitMs) throw new Error('조건이 제한 시간 안에 참이 되지 않았습니다.');
      this.frame();
    }
  }

  private frame(): void {
    const host = this.host;
    if (this.frames % PUBLISH_EVERY === 0) {
      for (const [id, session] of this.sessions) {
        if (!this.frozen.has(id)) this.states.set(id, publish(session, id, this.frames, id === host));
      }
    }
    this.frames++;
    for (const [id, session] of this.sessions) {
      if (this.frozen.has(id)) continue;
      const hosting = id === host;
      const others = [...this.states].filter(([peer]) => peer !== id && !this.hidden.has(peer));
      const peers = [...this.extra, ...others.map(([, state]) => state)];
      const frame: Frame = { hosting, host: hosting ? null : (this.states.get(host)?.host ?? null), peers };
      this.events.get(id)?.push(...session.update(FRAME_MS, this.inputs.get(id) ?? NO_INPUT, frame));
    }
  }
}

/** 평지에서 하는 방을 만들고 경기를 시작합니다. 첫 번째 사람이 방장입니다. */
function room(ids: string[], patch: Partial<Settings> = {}): Room {
  const made = new Room(ids);
  const host = made.get(ids[0]);
  host.setSettings({ bots: 0, mapSetting: 0, ...patch });
  host.start(ids);
  return made;
}

describe('연습 경기', () => {
  it('시작하면 카운트다운이 되고 나와 AI의 공이 놓인다', () => {
    const session = practice();
    expect(session.match.phase).toBe('countdown');
    expect(session.match.roster).toEqual(['me', 'bot1']);
    expect(session.view().balls).toHaveLength(2);
    expect(session.view().map).toBe(MAPS[0]);
    expect(session.view().watching).toBe(false);
    expect(session.view().me).toBe('me');
  });

  it('카운트다운 동안에는 눌러도 움직이지 않고 3초 뒤부터 움직인다', () => {
    const session = practice();
    const startX = ball(session, 'me').x;
    const startY = ball(session, 'me').y;
    tick(session, 2900, press('right'));
    expect(session.match.phase).toBe('countdown');
    expect(ball(session, 'me').x).toBe(startX);
    expect(ball(session, 'me').y).toBe(startY);
    tick(session, 120, press('right'));
    expect(session.match.phase).toBe('play');
    tick(session, 500, press('right'));
    expect(ball(session, 'me').x).toBeGreaterThan(startX + 0.5);
  });

  it('AI가 스스로 움직인다', () => {
    const session = practice();
    tick(session, 3000);
    const before = ball(session, 'bot1').x;
    tick(session, 2000);
    expect(ball(session, 'bot1').x).not.toBe(before);
  });

  it('떨어지면 라운드가 끝나고 남은 한 명이 점수를 얻으며 다음 라운드에 세계를 새로 만든다', () => {
    const session = practice();
    tick(session, 3000);
    const events = tickUntil(session, () => session.match.phase !== 'play', press('left'));
    expect(outs(events, 'me')).toHaveLength(1);
    expect(session.match.phase).toBe('roundEnd');
    const survivors = session.view().balls.filter((b) => b.alive);
    expect(survivors.map((b) => b.id)).toEqual(['bot1']);
    expect(session.match.winner).toBe('bot1');
    expect(session.match.scores).toEqual({ me: 0, bot1: 1 });

    tick(session, 2100, press('left'));
    expect(session.match.phase).toBe('countdown');
    expect(session.match.round).toBe(2);
    const [x, y] = MAPS[0].spawns[spawnSlot(0, 2)];
    expect(ball(session, 'me')).toMatchObject({ alive: true, x, y });
    expect(ball(session, 'bot1').alive).toBe(true);
    expect(session.mine().key).toBe(roundKey(1, 2));
  });

  it('화살을 모으던 채로 다음 라운드가 되면 겨누기와 화살이 남지 않는다', () => {
    const session = practice({ mode: 'arrows' });
    tick(session, 3000);
    const held = press('special');
    tick(session, 300, held);
    expect(ball(session, 'me').aim).not.toBeNull();
    tickUntil(session, () => session.match.phase !== 'play', held);
    expect(session.match.phase).toBe('roundEnd');
    tickUntil(session, () => session.match.round === 2, held, 2100);
    expect(ball(session, 'me').aim).toBeNull();
    expect(session.view().arrows).toHaveLength(0);
    tick(session, 1000, held);
    expect(session.match.phase).toBe('countdown');
    expect(ball(session, 'me').aim).toBeNull();
    expect(session.view().arrows).toHaveLength(0);
  });

  it('한 프레임이 0.5초보다 길면 단계도 공도 그대로다', () => {
    const session = practice();
    session.update(MAX_FRAME_MS + 4500, press('right'), SOLO);
    expect(session.match.phase).toBe('countdown');
    expect(session.match.ms).toBe(0);

    tick(session, 3000);
    tick(session, 300, press('right'));
    const before = { ...ball(session, 'me') };
    const ms = session.match.ms;
    expect(session.update(5000, press('right'), SOLO)).toEqual([]);
    expect(session.match.phase).toBe('play');
    expect(session.match.ms).toBe(ms);
    expect(ball(session, 'me')).toMatchObject({ x: before.x, y: before.y });
  });

  it('한 프레임에 최대 10 step만 진행하고 밀린 시간은 버린다', () => {
    const fast = practice({ bots: 1 });
    const slow = practice({ bots: 1 });
    tick(fast, 3000);
    tick(slow, 3000);
    // 0.4초는 24 step이지만 한 프레임에는 10 step만 진행한다.
    fast.update(400, press('right'), SOLO);
    for (let i = 0; i < 10; i++) slow.update(1000 / 60 + 0.001, press('right'), SOLO);
    expect(ball(fast, 'me').x).toBeCloseTo(ball(slow, 'me').x, 6);
    const x = ball(fast, 'me').x;
    fast.update(1, press('right'), SOLO);
    expect(ball(fast, 'me').x).toBe(x);
  });

  it('내가 올릴 공 상태는 경기 전에는 비어 있고, 탈락한 뒤에도 계속 올린다', () => {
    const session = new Session('me', () => 0);
    expect(session.mine()).toEqual({ key: 0, ball: null });
    session.setSettings({ bots: 1, mapSetting: 0 });
    session.start(['me']);
    tick(session, 3200, press('left'));
    const playing = session.mine();
    expect(playing.key).toBe(roundKey(1, 1));
    expect(playing.ball).toMatchObject({ a: true, i: 1, rp: null, am: null, ar: [] });
    tickUntil(session, () => !ball(session, 'me').alive, press('left'));
    const fallen = session.mine();
    expect(fallen.key).toBe(roundKey(1, 1));
    expect(fallen.ball?.a).toBe(false);
  });

  it('사람과 AI를 합쳐 6명까지만 참가한다', () => {
    const session = new Session('p1', () => 0);
    session.setSettings({ bots: 3 });
    session.start(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(session.match.roster).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'bot1']);
    expect(session.view().balls).toHaveLength(6);
  });

  it('설정은 대기실에서만 바뀐다', () => {
    const session = practice();
    session.setSettings({ target: 3 });
    expect(session.match.settings.target).toBe(5);
  });

  it('대기실로 돌아가면 세계를 버린다', () => {
    const session = practice();
    tick(session, 3500);
    session.backToLobby();
    expect(session.match.phase).toBe('lobby');
    expect(session.view().map).toBeNull();
    expect(session.view().balls).toEqual([]);
    expect(session.mine()).toEqual({ key: 0, ball: null });
    expect(session.update(FRAME_MS, press('right'), SOLO)).toEqual([]);
    expect(session.match.phase).toBe('lobby');
  });
});

describe('참가자', () => {
  it('방장이 올린 경기 상태로 같은 맵과 같은 참가자의 세계를 만든다', () => {
    const made = room(['a', 'b'], { bots: 1, mapSetting: 2 });
    made.run(200);
    const a = made.get('a');
    const b = made.get('b');
    expect(b.match.phase).toBe('countdown');
    expect(b.match.roster).toEqual(['a', 'b', 'bot1']);
    expect(b.view().map).toBe(MAPS[2]);
    expect(b.view().balls.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      a.view().balls.map(({ id, x, y }) => ({ id, x, y })),
    );
    expect(b.mine().key).toBe(roundKey(1, 1));
  });

  it('방장의 공이 받은 상태를 따라간다', () => {
    const made = room(['a', 'b', 'c']);
    made.run(3200);
    const a = made.get('a');
    const c = made.get('c');
    expect(c.match.phase).toBe('play');
    const startX = ball(a, 'a').x;
    made.inputs.set('a', press('left'));
    made.run(700);
    made.inputs.set('a', press('right'));
    made.run(1300);
    expect(ball(a, 'a').alive).toBe(true);
    expect(Math.abs(ball(a, 'a').x - startX)).toBeGreaterThan(1);
    expect(Math.abs(ball(c, 'a').x - ball(a, 'a').x)).toBeLessThan(1.5);
  });

  it('새 소식이 없으면 다시 맞추지 않고 마지막으로 받은 입력으로 계속 움직인다', () => {
    const made = room(['a', 'b', 'c']);
    made.run(3200);
    made.inputs.set('a', press('left'));
    made.run(300);
    made.freeze('a');
    const received = made.states.get('a')?.ball?.b.x ?? NaN;
    made.run(500);
    expect(ball(made.get('c'), 'a').x).toBeLessThan(received - 2);
  });

  it('방장이 탈락했다고 알리면 그 공을 탈락시키고 out을 한 번 돌려준다', () => {
    const made = room(['a', 'b', 'c']);
    made.run(3200);
    made.inputs.set('a', press('left'));
    made.runUntil(() => !ball(made.get('a'), 'a').alive);
    made.run(500);
    const b = made.get('b');
    expect(ball(b, 'a').alive).toBe(false);
    const seen = outs(made.events.get('b') ?? [], 'a');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cause: 'fall' });
    expect(b.match.phase).toBe('play');
  });

  it('참가자 가운데 방에서 사라진 사람은 3초를 기다린 뒤에 탈락시킨다', () => {
    const made = room(['a', 'b', 'c', 'd']);
    made.run(3200);
    made.leave('d');
    made.run(ABSENT_GRACE_MS - 200);
    for (const id of ['a', 'b', 'c']) {
      expect(ball(made.get(id), 'd').alive).toBe(true);
      expect(outs(made.events.get(id) ?? [], 'd')).toHaveLength(0);
    }
    expect(made.get('a').match.phase).toBe('play');
    made.run(700);
    for (const id of ['a', 'b', 'c']) {
      expect(ball(made.get(id), 'd').alive).toBe(false);
      expect(outs(made.events.get(id) ?? [], 'd')).toHaveLength(1);
    }
    expect(made.get('a').match.phase).toBe('play');
  });

  it('대전 중에 들어오면 구경하다가 다음 라운드부터 참가한다', () => {
    const made = room(['a'], { bots: 1 });
    made.run(3500);
    made.join('c');
    made.run(200);
    const a = made.get('a');
    const c = made.get('c');
    expect(c.view().watching).toBe(true);
    expect(c.view().balls.map((b) => b.id)).toEqual(['a', 'bot1']);
    expect(c.mine()).toEqual({ key: 0, ball: null });
    expect(a.match.roster).toEqual(['a', 'bot1']);

    made.inputs.set('a', press('left'));
    made.runUntil(() => a.match.phase === 'roundEnd');
    expect(c.view().watching).toBe(true);
    made.inputs.set('a', NO_INPUT);
    made.run(2300);
    expect(a.match.round).toBe(2);
    expect(a.match.roster).toEqual(['a', 'c', 'bot1']);
    expect(a.match.scores.c).toBe(0);
    expect(c.view().watching).toBe(false);
    expect(c.mine().key).toBe(roundKey(1, 2));
    expect(ball(c, 'c').alive).toBe(true);
  });
});

describe('참가자가 보는 AI', () => {
  /**
   * ms 동안 진행하면서 참가자 화면의 AI 공이 방장 화면의 것에서 가장 멀어진 거리를 잽니다.
   * 받은 위치를 속도×NET_LEAD만큼 앞으로 옮겨 맞추므로 그만큼은 빼고 셉니다.
   */
  function drift(made: Room, host: string, guest: string, ms: number): number {
    let worst = 0;
    for (let left = ms; left > 0; left -= FRAME_MS) {
      made.run(FRAME_MS);
      const lead = Math.abs(made.get(host).hostWire().bs.bot1.b.vx) * NET_LEAD;
      const gap = Math.abs(ball(made.get(guest), 'bot1').x - ball(made.get(host), 'bot1').x);
      worst = Math.max(worst, gap - lead);
    }
    return worst;
  }

  it('AI 공이 방장의 것을 따라간다', () => {
    const made = room(['a', 'b'], { bots: 1 });
    made.run(3000);
    const a = made.get('a');
    const b = made.get('b');
    const startX = ball(a, 'bot1').x;
    const worst = drift(made, 'a', 'b', 1600);
    expect(ball(a, 'bot1').alive).toBe(true);
    expect(ball(b, 'bot1').alive).toBe(true);
    expect(Math.abs(ball(a, 'bot1').x - startX)).toBeGreaterThan(5);
    expect(worst).toBeLessThan(0.75);
  });

  it('방장 쪽에서 AI가 탈락하면 out을 한 번 돌려준다', () => {
    // 화살 모드에서 AI 둘이 있으면 라운드가 끝나기 전에 적어도 하나는 탈락한다.
    const made = room(['a', 'b'], { bots: 2, mode: 'arrows' });
    made.run(3000);
    const a = made.get('a');
    const b = made.get('b');
    const dead = (): string | undefined => ['bot1', 'bot2'].find((id) => !ball(a, id).alive);
    made.runUntil(() => dead() !== undefined, 95000);
    const id = dead() ?? '';
    made.run(300);
    expect(ball(b, id).alive).toBe(false);
    const seen = outs(made.events.get('b') ?? [], id);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ cause: 'fall' });
  });

  it('방장의 소식이 새로 오지 않으면 AI 공을 다시 맞추지 않는다', () => {
    const made = room(['a', 'b'], { bots: 1 });
    made.run(3000);
    const a = made.get('a');
    made.runUntil(() => a.hostWire().bs.bot1.i !== 0, 1000);
    made.run(300);
    made.freeze('a');
    const received = made.states.get('a')?.host?.bs.bot1;
    expect(received?.i).not.toBe(0);
    made.run(600);
    expect(Math.abs(ball(made.get('b'), 'bot1').x - (received?.b.x ?? NaN))).toBeGreaterThan(2);
  });

  it('경기 상태를 올린 사람이 둘이면 받은 상태를 올린 사람의 번호로 새 소식을 가린다', () => {
    const made = room(['a', 'b'], { bots: 1 });
    made.run(3000);
    const a = made.get('a');
    // 이미 물러난 방장의 마지막 상태가 방에 남아 있는 경우입니다. 번호는 더 오르지 않습니다.
    const old = made.states.get('a');
    if (!old?.host) throw new Error('방장의 상태가 없습니다.');
    made.extra = [{ ...old, peer: 'z', ball: null, key: 0 }];
    const startX = ball(a, 'bot1').x;
    const worst = drift(made, 'a', 'b', 1600);
    expect(Math.abs(ball(a, 'bot1').x - startX)).toBeGreaterThan(5);
    expect(worst).toBeLessThan(0.75);
  });

  it('방장에서 물러나면 AI 공은 새 방장의 것을 따라간다', () => {
    const made = room(['a', 'b'], { bots: 1 });
    made.run(3500);
    const a = made.get('a');
    const b = made.get('b');
    expect(a.hostWire().bs.bot1.i).not.toBe(0);
    made.setHost('b');
    made.run(200);
    expect(b.match).toMatchObject({ game: 1, round: 1, phase: 'play' });
    // a가 0.7초 멈춘 동안 새 방장의 AI는 계속 움직인다. 돌아온 a는 받은 상태로 AI 공을 옮긴다.
    made.freeze('a');
    const stale = ball(a, 'bot1').x;
    made.run(700);
    expect(Math.abs(ball(b, 'bot1').x - stale)).toBeGreaterThan(1);
    made.thaw('a');
    made.run(100);
    expect(Math.abs(ball(a, 'bot1').x - ball(b, 'bot1').x)).toBeLessThan(0.5);
    for (let ms = 0; ms < 1000; ms += FRAME_MS) {
      made.run(FRAME_MS);
      expect(a.hostWire().bs.bot1.i).toBe(0);
    }
    expect(a.match.phase).toBe('play');
    expect(Math.abs(ball(a, 'bot1').x - ball(b, 'bot1').x)).toBeLessThan(1.5);
  });
});

describe('play가 아닌 단계의 화살', () => {
  function shoots(events: WorldEvent[] | undefined): WorldEvent[] {
    return (events ?? []).filter((e) => e.type === 'shoot');
  }

  it('AI가 모으던 중에 라운드가 끝나면 쏘지 않고, 결과를 보여 주는 동안 새로 쏘지도 않는다', () => {
    // 방장 a는 구경하고 b와 AI가 겨룬다. b가 탈락했다고 올리면 그 순간 라운드가 끝난다.
    const made = new Room(['a', 'b']);
    const a = made.get('a');
    a.setSettings({ bots: 1, mapSetting: 0, mode: 'arrows' });
    a.start(['b']);
    expect(a.match.roster).toEqual(['b', 'bot1']);
    made.run(3000);
    made.runUntil(() => (ball(a, 'bot1').aim?.charge ?? 0) >= 0.3, 5000);
    expect(a.match.phase).toBe('play');
    expect(a.hostWire().bs.bot1.i & 16).toBe(16);
    const before = shoots(made.events.get('a')).length;

    const last = made.states.get('b');
    if (!last?.ball) throw new Error('b의 상태가 없습니다.');
    made.freeze('b');
    made.states.set('b', { ...last, ball: { ...last.ball, a: false } });
    made.run(FRAME_MS);
    expect(a.match.phase).toBe('roundEnd');
    expect(a.match.winner).toBe('bot1');
    for (let ms = 0; ms < 1900; ms += FRAME_MS) {
      made.run(FRAME_MS);
      expect(a.match.phase).toBe('roundEnd');
      expect(a.hostWire().bs.bot1.i).toBe(0);
      expect(ball(a, 'bot1').aim).toBeNull();
    }
    expect(shoots(made.events.get('a'))).toHaveLength(before);
    expect(a.view().arrows.filter((arrow) => arrow.owner === 'bot1')).toHaveLength(0);
  });

  it('내가 모으던 중에 라운드가 끝나면 쏘지 않는다', () => {
    const made = room(['a', 'b'], { mode: 'arrows' });
    const a = made.get('a');
    made.run(3000);
    made.inputs.set('a', press('special'));
    made.runUntil(() => (ball(a, 'a').aim?.charge ?? 0) >= 0.3, 2000);
    made.leave('b');
    made.run(ABSENT_GRACE_MS + 1000);
    expect(a.match).toMatchObject({ phase: 'roundEnd', winner: 'a' });
    expect(shoots(made.events.get('a'))).toHaveLength(0);
    expect(a.view().arrows).toHaveLength(0);
    expect(a.mine().ball).toMatchObject({ i: 0, am: null, ar: [] });
  });
});

describe('방장', () => {
  it('다른 사람이 탈락했다고 올리면 라운드를 끝내고, 지난 라운드의 상태는 생존으로 본다', () => {
    const made = room(['a', 'b']);
    made.run(3200);
    const a = made.get('a');
    // b는 a의 오른쪽에서 시작하므로 오른쪽으로 가면 a를 밀지 않고 혼자 떨어진다.
    made.inputs.set('b', press('right'));
    made.runUntil(() => !ball(made.get('b'), 'b').alive);
    expect(a.match.phase).toBe('play');
    made.run(200);
    expect(a.match.phase).toBe('roundEnd');
    expect(a.match.winner).toBe('a');
    expect(a.match.scores).toEqual({ a: 1, b: 0 });
    expect(outs(made.events.get('a') ?? [], 'b')).toHaveLength(1);

    // b가 멈춰서 1라운드의 탈락 상태만 방에 남아 있어도 2라운드는 바로 끝나지 않는다.
    made.freeze('b');
    made.run(2000 + 3000 + 1000);
    expect(made.states.get('b')).toMatchObject({ key: roundKey(1, 1), ball: { a: false } });
    expect(a.match.round).toBe(2);
    expect(a.match.phase).toBe('play');
    expect(a.match.scores).toEqual({ a: 1, b: 0 });
  });

  it('라운드 도중에 사라졌다가 돌아온 사람은 그 라운드에서는 탈락이고 다음 라운드에 다시 참가한다', () => {
    const made = room(['a', 'b', 'c'], { mode: 'arrows' });
    made.run(3200);
    const a = made.get('a');
    const b = made.get('b');
    const c = made.get('c');
    made.hide('b');
    made.run(ABSENT_GRACE_MS + 200);
    made.show('b');
    // b는 자기 화면에서는 살아 있어서 화살도 쏘지만, 방장과 다른 참가자에게는 이미 탈락한 사람이다.
    made.inputs.set('b', press('special'));
    made.run(500);
    made.inputs.set('b', NO_INPUT);
    made.run(200);
    expect(made.states.get('b')).toMatchObject({ key: roundKey(1, 1), ball: { a: true } });
    expect(b.view().arrows.filter((arrow) => arrow.owner === 'b')).toHaveLength(1);
    expect(a.match.phase).toBe('play');
    for (const id of ['a', 'c']) {
      expect(ball(made.get(id), 'b')).toMatchObject({ alive: false, aim: null });
      expect(made.get(id).view().arrows).toHaveLength(0);
      expect(outs(made.events.get(id) ?? [], 'b')).toHaveLength(1);
    }

    // c는 가장 오른쪽에서 시작하므로 오른쪽으로 가면 아무도 밀지 않고 혼자 떨어진다.
    made.inputs.set('c', press('right'));
    made.runUntil(() => !ball(c, 'c').alive);
    made.inputs.set('c', NO_INPUT);
    made.run(200);
    expect(ball(b, 'b').alive).toBe(true);
    expect(a.match.phase).toBe('roundEnd');
    expect(a.match.winner).toBe('a');
    expect(a.match.scores).toEqual({ a: 1, b: 0, c: 0 });

    made.run(2000 + 3000 + 200);
    expect(a.match).toMatchObject({ round: 2, phase: 'play', roster: ['a', 'b', 'c'] });
    expect(ball(a, 'b').alive).toBe(true);
    expect(ball(c, 'b').alive).toBe(true);
  });

  it('방장이 나가면 남은 사람이 같은 점수표로 이어서 진행하고 AI를 맡는다', () => {
    const made = room(['a', 'b'], { bots: 1 });
    made.run(3200);
    const b = made.get('b');
    made.inputs.set('a', press('left'));
    made.inputs.set('b', press('left'));
    made.runUntil(() => b.match.round === 2);
    made.inputs.set('a', NO_INPUT);
    made.inputs.set('b', NO_INPUT);
    made.run(1000);
    const before = b.match;
    expect(before.phase).toBe('countdown');
    expect(Object.values(before.scores).reduce((sum, score) => sum + score, 0)).toBe(1);
    expect(b.hostWire().bs.bot1).toBeDefined();

    made.leave('a');
    made.run(FRAME_MS);
    expect(made.host).toBe('b');
    expect(b.match).toMatchObject({ game: before.game, round: 2, phase: 'countdown', scores: before.scores });
    expect(b.match.roster).toEqual(['a', 'b', 'bot1']);
    // 나간 사람의 공은 기다리는 시간(3초)이 지난 뒤에 탈락합니다.
    expect(ball(b, 'a').alive).toBe(true);

    // 받은 경기 상태 없이도 혼자서 단계를 넘기고 AI의 입력을 정한다.
    const botX = ball(b, 'bot1').x;
    let botPressed = false;
    made.runUntil(() => b.match.phase === 'play', 2500);
    for (let i = 0; i < 100; i++) {
      made.run(FRAME_MS);
      if (b.hostWire().bs.bot1.i !== 0) botPressed = true;
    }
    expect(botPressed).toBe(true);
    expect(ball(b, 'bot1').x).not.toBe(botX);
    expect(b.match).toMatchObject({ game: before.game, round: 2, scores: before.scores });
    expect(b.hostWire().bs.bot1.a).toBe(true);
    expect(ball(b, 'a').alive).toBe(false);
  });
});

describe('방에서 잠깐 보이지 않는 참가자', () => {
  it('사람 셋 가운데 방장이 나간 뒤 1초 동안 아무도 보이지 않아도 새 방장은 아무도 탈락시키지 않는다', () => {
    const made = room(['h', 'a', 'b']);
    made.run(3200);
    const a = made.get('a');
    const b = made.get('b');
    // 방을 중계하던 방장이 나가면, 먼저 이어받은 b에게는 a가 다시 연결할 때까지 방이 비어 보입니다.
    made.setHost('b');
    made.leave('h');
    made.hide('a');
    for (let ms = 0; ms < 1000; ms += FRAME_MS) {
      made.run(FRAME_MS);
      expect(b.match).toMatchObject({ phase: 'play', winner: null });
      expect(ball(b, 'a').alive).toBe(true);
      expect(ball(b, 'h').alive).toBe(true);
    }
    made.show('a');
    made.run(1000);
    for (const session of [a, b]) {
      expect(session.match).toMatchObject({ phase: 'play', winner: null });
      expect(ball(session, 'a').alive).toBe(true);
      expect(ball(session, 'b').alive).toBe(true);
    }
    expect(outs(made.events.get('b') ?? [], 'a')).toHaveLength(0);

    // 돌아오지 않은 h만 3초가 지난 뒤에 탈락하고, 남은 두 사람의 라운드는 계속됩니다.
    made.run(ABSENT_GRACE_MS - 1500);
    for (const id of ['a', 'b']) {
      expect(ball(made.get(id), 'h').alive).toBe(false);
      expect(outs(made.events.get(id) ?? [], 'h')).toHaveLength(1);
    }
    expect(b.match).toMatchObject({ phase: 'play', scores: { h: 0, a: 0, b: 0 } });
  });

  it('둘이 하다가 상대가 사라지면 1초 뒤에는 라운드가 계속되고 3.5초 뒤에는 남은 사람이 이긴다', () => {
    const made = room(['a', 'b']);
    made.run(3200);
    const a = made.get('a');
    made.leave('b');
    made.run(1000);
    expect(a.match.phase).toBe('play');
    expect(ball(a, 'b').alive).toBe(true);
    made.run(2500);
    expect(ball(a, 'b').alive).toBe(false);
    expect(a.match).toMatchObject({ phase: 'roundEnd', winner: 'a', scores: { a: 1, b: 0 } });
  });

  it('한 프레임이 0.5초보다 길면 그 시간은 보이지 않은 시간으로 세지 않는다', () => {
    const made = room(['a', 'b']);
    made.run(3200);
    const a = made.get('a');
    made.leave('b');
    made.run(FRAME_MS);
    a.update(20000, NO_INPUT, { hosting: true, host: null, peers: [] });
    made.run(1000);
    expect(ball(a, 'b').alive).toBe(true);
    expect(a.match.phase).toBe('play');
  });

  it('라운드가 넘어가는 동안 잠깐 보이지 않은 사람도 다음 라운드에 참가한다', () => {
    const made = room(['a', 'b', 'c']);
    made.run(3200);
    const a = made.get('a');
    // b와 c는 a의 오른쪽에서 시작하므로 오른쪽으로 가면 a를 밀지 않고 떨어진다.
    made.inputs.set('b', press('right'));
    made.inputs.set('c', press('right'));
    made.runUntil(() => a.match.phase === 'roundEnd');
    made.inputs.set('b', NO_INPUT);
    made.inputs.set('c', NO_INPUT);
    expect(a.match.winner).toBe('a');
    made.run(1000);
    made.hide('b');
    made.run(1500);
    expect(a.match).toMatchObject({ round: 2, phase: 'countdown', roster: ['a', 'c', 'b'] });
    made.show('b');
    made.run(3000);
    expect(a.match).toMatchObject({ round: 2, phase: 'play' });
    for (const id of ['a', 'b', 'c']) expect(ball(made.get(id), 'b').alive).toBe(true);
  });
});

describe('움직이는 발판의 시간', () => {
  const FERRY = MAPS.findIndex((m) => m.id === 'ferry');
  const boat = MAPS[FERRY].shapes[2];
  if (boat.kind !== 'box' || !boat.move) throw new Error('나룻배 맵의 셋째 도형이 움직이는 발판이 아닙니다.');
  const move = boat.move;
  const rest = boat.x;

  /** 세션이 그리는 배의 x입니다. */
  function boatX(session: Session): number {
    const shape = session.view().shapes[2];
    if (shape.kind !== 'box') throw new Error('상자가 아닙니다.');
    return shape.x;
  }

  /** play 단계가 시작된 뒤 ms가 지났을 때 배가 있어야 할 x입니다. */
  function expected(ms: number): number {
    return rest + moveOffset(move, ms / 1000)[0];
  }

  it('카운트다운 동안에는 제자리에 멈춰 있다', () => {
    const made = room(['a', 'b'], { mapSetting: FERRY });
    made.run(2900);
    expect(made.get('a').match.phase).toBe('countdown');
    expect(boatX(made.get('a'))).toBe(rest);
    expect(boatX(made.get('b'))).toBe(rest);
  });

  it('방장의 발판은 play 단계의 경과 시간으로 정해진 곳에 있다', () => {
    const made = room(['a', 'b'], { mapSetting: FERRY });
    const a = made.get('a');
    made.runUntil(() => a.match.phase === 'play');
    for (let i = 0; i < 40; i++) {
      made.run(500);
      // 아직 계산하지 않고 남겨 둔 시간(한 step 미만)만큼만 어긋납니다.
      expect(Math.abs(boatX(a) - expected(a.match.ms))).toBeLessThan(0.05);
    }
  });

  it('참가자의 발판은 방장의 발판을 따라가고 시간이 지나도 벌어지지 않는다', () => {
    const made = room(['a', 'b'], { mapSetting: FERRY });
    const a = made.get('a');
    const b = made.get('b');
    made.runUntil(() => a.match.phase === 'play');
    made.run(1000);
    let worst = 0;
    for (let i = 0; i < 1200; i++) {
      made.run(FRAME_MS);
      worst = Math.max(worst, Math.abs(boatX(b) - boatX(a)));
    }
    // 통신 지연 어림값(NET_LEAD) 동안 발판이 움직이는 거리보다 조금 넉넉한 값입니다.
    expect(worst).toBeLessThan(0.3);
    expect(boatX(b)).not.toBeCloseTo(rest, 0);
  });

  it('경기 도중에 들어온 사람의 발판도 바로 같은 곳에 놓인다', () => {
    const made = room(['a', 'b'], { mapSetting: FERRY });
    const a = made.get('a');
    made.runUntil(() => a.match.phase === 'play');
    made.run(3000);
    made.join('c');
    made.run(200);
    expect(Math.abs(boatX(made.get('c')) - boatX(a))).toBeLessThan(0.3);
    expect(Math.abs(boatX(a) - rest)).toBeGreaterThan(1);
  });

  it('방장이 바뀌어도 발판이 튀지 않는다', () => {
    const made = room(['a', 'b'], { mapSetting: FERRY });
    const a = made.get('a');
    const b = made.get('b');
    made.runUntil(() => a.match.phase === 'play');
    made.run(2000);
    made.setHost('b');
    let last = boatX(b);
    for (let i = 0; i < 120; i++) {
      made.run(FRAME_MS);
      expect(Math.abs(boatX(b) - last)).toBeLessThan(0.3);
      last = boatX(b);
    }
    expect(Math.abs(boatX(b) - expected(b.match.ms))).toBeLessThan(0.05);
  });

  it('라운드가 끝나면 발판이 멈춘다', () => {
    const session = new Session('me', () => 0);
    session.setSettings({ bots: 1, mapSetting: FERRY });
    session.start(['me']);
    tickUntil(session, () => session.match.phase === 'play', NO_INPUT);
    tick(session, 2000);
    // 왼쪽 끝으로 달려 나가 떨어집니다.
    tickUntil(session, () => session.match.phase === 'roundEnd', press('left'));
    tick(session, 100);
    const stopped = boatX(session);
    tick(session, 1000);
    expect(session.match.phase).toBe('roundEnd');
    expect(boatX(session)).toBe(stopped);
  });
});

describe('이어 그리기에 쓰는 직전 모습', () => {
  it('라운드가 막 시작되어 step을 진행하기 전에는 없다', () => {
    const session = practice();
    expect(session.view().prev).toBeNull();
    tick(session, 1000);
    expect(session.view().prev).toBeNull();
    expect(session.view().alpha).toBe(0);
  });

  it('step을 진행한 뒤에는 마지막 step 직전의 공 위치를 담는다', () => {
    const session = practice();
    tick(session, 3200);
    tick(session, 320, press('right'));
    const view = session.view();
    const now = ball(session, 'me');
    const was = view.prev?.balls.find((b) => b.id === 'me');
    expect(was).toBeDefined();
    // 오른쪽으로 가는 중이므로 직전 위치는 조금 왼쪽입니다.
    expect(now.x - was!.x).toBeGreaterThan(0);
    expect(now.x - was!.x).toBeLessThan(0.5);
  });

  it('alpha는 마지막 step 뒤로 남은 시간의 비율이다', () => {
    const session = practice();
    tick(session, 3200);
    for (let i = 0; i < 40; i++) {
      session.update(7, NO_INPUT, SOLO);
      const { alpha } = session.view();
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    // 7ms 프레임에서는 step 사이에 그리는 프레임이 생기므로 0이 아닌 값이 나옵니다.
    session.update(7, NO_INPUT, SOLO);
    const a = session.view().alpha;
    session.update(7, NO_INPUT, SOLO);
    expect(session.view().alpha).not.toBe(a);
  });

  it('step을 진행하지 않은 프레임에서는 직전 모습이 그대로다', () => {
    const session = practice();
    tick(session, 3200);
    const before = session.view().prev;
    session.update(0, NO_INPUT, SOLO);
    expect(session.view().prev).toBe(before);
  });

  it('새 라운드가 시작되면 지난 라운드의 모습을 버린다', () => {
    const session = practice();
    tick(session, 3200);
    expect(session.view().prev).not.toBeNull();
    tickUntil(session, () => session.match.round === 2, press('left'));
    expect(session.view().prev).toBeNull();
  });

  it('원격 공이 받은 위치로 바로 옮겨지면 직전 모습도 같은 곳에 둔다', () => {
    const a = new Session('a', () => 0);
    a.setSettings({ bots: 0, mapSetting: 0 });
    a.start(['a', 'b']);
    const b = new Session('b', () => 0);
    const hostState = publish(a, 'a', 1, true);
    b.update(FRAME_MS, NO_INPUT, { hosting: false, host: hostState.host, peers: [hostState] });
    const peer = publish(b, 'b', 1, false);
    tick(a, 3200, NO_INPUT, { hosting: true, host: null, peers: [peer] });
    expect(a.view().prev).not.toBeNull();

    const wire = peer.ball!;
    const far = { ...peer, n: 2, ball: { ...wire, b: { ...wire.b, x: wire.b.x + 5 } } };
    a.update(0, NO_INPUT, { hosting: true, host: null, peers: [far] });
    const view = a.view();
    const now = view.balls.find((ball) => ball.id === 'b')!;
    const was = view.prev!.balls.find((ball) => ball.id === 'b')!;
    expect(now.x).toBeCloseTo(wire.b.x + 5, 5);
    expect(was.x).toBe(now.x);
    expect(was.y).toBe(now.y);
  });

  it('화살에는 주인별 번호가 붙는다', () => {
    const session = practice({ mode: 'arrows' });
    tick(session, 3200);
    tick(session, 500, press('special', 'up'));
    tick(session, 100);
    const mine = session.view().arrows.filter((arrow) => arrow.owner === 'me');
    expect(mine.map((arrow) => arrow.id)).toEqual([1]);
  });
});
