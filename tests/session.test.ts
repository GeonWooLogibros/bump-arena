import { describe, expect, it } from 'vitest';
import { MAPS, spawnSlot } from '../src/game/maps';
import type { Settings } from '../src/game/round';
import { encodeBall, encodeHost, readPeer, roundKey } from '../src/net/wire';
import type { PeerState } from '../src/net/wire';
import { NO_INPUT } from '../src/physics/world';
import type { BallView, Input, WorldEvent } from '../src/physics/world';
import { MAX_FRAME_MS, Session } from '../src/session';
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
  private readonly frozen = new Set<string>();
  private frames = 0;

  constructor(ids: string[]) {
    for (const id of ids) this.join(id);
  }

  get host(): string {
    return [...this.sessions.keys()][0];
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
      const peers = [...this.states].filter(([peer]) => peer !== id).map(([, state]) => state);
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

  it('참가자 가운데 방에서 사라진 사람을 탈락시킨다', () => {
    const made = room(['a', 'b', 'c', 'd']);
    made.run(3200);
    made.leave('d');
    made.run(200);
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

describe('play가 아닌 단계의 화살', () => {
  function shoots(events: WorldEvent[] | undefined): WorldEvent[] {
    return (events ?? []).filter((e) => e.type === 'shoot');
  }

  it('AI가 모으던 중에 라운드가 끝나면 쏘지 않고, 결과를 보여 주는 동안 새로 쏘지도 않는다', () => {
    // 방장 a는 구경하고 b와 AI가 겨룬다. b가 방에서 나가면 그 순간 라운드가 끝난다.
    const made = new Room(['a', 'b']);
    const a = made.get('a');
    a.setSettings({ bots: 1, mapSetting: 0, mode: 'arrows' });
    a.start(['b']);
    expect(a.match.roster).toEqual(['b', 'bot1']);
    made.run(3000);
    made.runUntil(() => (ball(a, 'bot1').aim?.charge ?? 0) >= 0.3, 2000);
    expect(a.match.phase).toBe('play');
    expect(a.hostWire().bs.bot1.i & 16).toBe(16);
    const before = shoots(made.events.get('a')).length;

    made.leave('b');
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
    made.run(2000);
    expect(a.match.winner).toBe('a');
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
    expect(ball(b, 'a').alive).toBe(false);

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
  });
});
