import { describe, expect, it } from 'vitest';
import { Multiplayer, SEND_INTERVAL, SETTLE_MS } from '../src/multiplayer';
import type { Stage } from '../src/multiplayer';
import type { LobbyLike, NamedRoomLike, PeerLike } from '../src/net/types';
import { NO_INPUT } from '../src/physics/world';
import type { BallView, Input, WorldEvent } from '../src/physics/world';

const FRAME_MS = 16;

type Member = { presence: Record<string, unknown>; kind: string; updatedAt: number };

/** 메모리 안에서만 동작하는 방입니다. 시계를 직접 움직여서 시간에 따른 동작을 확인합니다. */
class FakeHub {
  now = 1000;
  readonly rooms = new Map<string, Map<string, Member>>();
  /** 사람마다 presence를 부른 시각입니다. */
  readonly sends = new Map<string, number[]>();

  lobby(peer: string): LobbyLike {
    const hub = this;
    return {
      presence: () => Promise.resolve(),
      peers: () => [],
      onPeers: () => () => undefined,
      join(name: string): Promise<NamedRoomLike> {
        const members = hub.rooms.get(name) ?? new Map<string, Member>();
        hub.rooms.set(name, members);
        members.set(peer, { presence: {}, kind: 'user', updatedAt: hub.now });
        return Promise.resolve({
          presence(patch: Record<string, unknown>): Promise<void> {
            hub.sends.set(peer, [...(hub.sends.get(peer) ?? []), hub.now]);
            const entry = members.get(peer);
            if (!entry) return Promise.resolve();
            const next = { ...entry.presence };
            for (const [key, value] of Object.entries(patch)) {
              if (value === null) delete next[key];
              else next[key] = JSON.parse(JSON.stringify(value));
            }
            members.set(peer, { ...entry, presence: next, updatedAt: hub.now });
            return Promise.resolve();
          },
          peers: (): PeerLike[] =>
            [...members].map(([key, entry]) => ({
              peer: key,
              sameTab: key === peer,
              kind: entry.kind,
              presence: entry.presence,
              updatedAt: entry.updatedAt,
            })),
          onPeers: () => () => undefined,
          leave(): Promise<void> {
            members.delete(peer);
            return Promise.resolve();
          },
        });
      },
    };
  }

  /** 사람이 아닌 참가자(게시한 세션)를 모든 방에 넣습니다. */
  addAgent(peer: string): void {
    for (const members of this.rooms.values()) members.set(peer, { presence: {}, kind: 'agent', updatedAt: this.now });
  }
}

interface Client {
  mp: Multiplayer;
  stages: Stage[];
  input: Input;
  events: WorldEvent[];
}

function client(hub: FakeHub, peer: string): Client {
  const stages: Stage[] = [];
  const mp = new Multiplayer(
    hub.lobby(peer),
    'https://example.com/',
    { onStage: (stage) => stages.push(stage) },
    () => hub.now,
    () => 0.5,
  );
  return { mp, stages, input: { ...NO_INPUT }, events: [] };
}

/** ms만큼을 16ms씩 나눠 모든 화면을 update합니다. */
function pass(hub: FakeHub, ms: number, ...clients: Client[]): void {
  for (let t = 0; t < ms; t += FRAME_MS) {
    hub.now += FRAME_MS;
    for (const c of clients) c.events.push(...c.mp.update(FRAME_MS, c.input));
  }
}

/** 조건이 참이 될 때까지 진행합니다. limitMs 안에 참이 되지 않으면 실패합니다. */
function passUntil(hub: FakeHub, done: () => boolean, clients: Client[], limitMs = 60000): void {
  for (let ms = 0; !done(); ms += FRAME_MS) {
    if (ms >= limitMs) throw new Error('조건이 제한 시간 안에 참이 되지 않았습니다.');
    pass(hub, FRAME_MS, ...clients);
  }
}

/** 방장이 방을 만들고 손님들이 차례로 들어와 settle이 지난 대기실입니다. */
async function room(hub: FakeHub, guests: number, colors: number[] = [0, 1, 2, 3, 4, 5, 0]): Promise<Client[]> {
  const host = client(hub, 'p0');
  await host.mp.create('방장', colors[0]);
  const all = [host];
  for (let i = 1; i <= guests; i++) {
    hub.now += 10;
    const guest = client(hub, `p${i}`);
    await guest.mp.join(host.mp.code, `손님${i}`, colors[i]);
    all.push(guest);
  }
  pass(hub, SETTLE_MS + 100, ...all);
  return all;
}

/** 방장과 손님 한 명이 평지에서 경기를 시작한 상태입니다. */
async function startedPair(hub: FakeHub, bots: number): Promise<{ host: Client; guest: Client }> {
  const [host, guest] = await room(hub, 1);
  host.mp.setSettings({ bots, mapSetting: 0 });
  guest.mp.toggleReady();
  pass(hub, 100, host, guest);
  host.mp.start();
  pass(hub, 100, host, guest);
  return { host, guest };
}

function ball(c: Client, id: string): BallView {
  const found = c.mp.session?.view().balls.find((b) => b.id === id);
  if (!found) throw new Error(`${id} 공이 없습니다.`);
  return found;
}

function practice(hub = new FakeHub()): Client {
  const stages: Stage[] = [];
  const mp = new Multiplayer(null, '', { onStage: (stage) => stages.push(stage) }, () => hub.now, () => 0.5);
  mp.practice('나', 3);
  return { mp, stages, input: { ...NO_INPUT }, events: [] };
}

describe('연습하기', () => {
  it('바로 대기실에 들어가고 AI 1명과 시작할 수 있다', () => {
    const c = practice();
    expect(c.mp.stage).toBe('lobby');
    expect(c.stages).toEqual(['lobby']);
    const view = c.mp.lobbyView();
    expect(view?.practice).toBe(true);
    expect(view?.rows).toEqual([
      { id: 'me', name: '나', color: 3, host: true, ready: false, me: true, bot: false },
      { id: 'bot1', name: 'AI 1', color: 0, host: false, ready: true, me: false, bot: true },
    ]);
    expect(view?.isHost).toBe(true);
    expect(view?.settled).toBe(true);
    expect(view?.canStart).toBe(true);
    expect(view?.maxBots).toBe(5);
    expect(view?.invite).toBe('');

    c.mp.start();
    c.mp.update(FRAME_MS, c.input);
    expect(c.mp.stage).toBe('game');
    expect(c.mp.lobbyView()).toBeNull();
    expect(c.mp.session?.match.roster).toEqual(['me', 'bot1']);
    expect(c.mp.players()).toEqual([
      { id: 'me', name: '나', color: 3, me: true, bot: false },
      { id: 'bot1', name: 'AI 1', color: 0, me: false, bot: true },
    ]);
  });

  it('AI는 1명 아래로 줄지 않고 다른 설정은 그대로 반영된다', () => {
    const c = practice();
    c.mp.setSettings({ bots: 0 });
    expect(c.mp.lobbyView()?.settings.bots).toBe(1);
    c.mp.setSettings({ bots: 9 });
    expect(c.mp.lobbyView()?.settings.bots).toBe(5);
    expect(c.mp.lobbyView()?.rows).toHaveLength(6);
    c.mp.setSettings({ mode: 'arrows', target: 3 });
    expect(c.mp.lobbyView()?.settings).toMatchObject({ mode: 'arrows', target: 3, bots: 5 });
  });

  it('경기를 진행하면 카운트다운 뒤에 내 공이 움직이고 대기실로 돌아올 수 있다', () => {
    const hub = new FakeHub();
    const c = practice(hub);
    c.mp.setSettings({ mapSetting: 0 });
    c.mp.start();
    pass(hub, 3100, c);
    expect(c.mp.session?.match.phase).toBe('play');
    const before = ball(c, 'me').x;
    c.input = { ...NO_INPUT, right: true };
    pass(hub, 500, c);
    expect(ball(c, 'me').x).toBeGreaterThan(before);
    c.mp.backToLobby();
    expect(c.mp.stage).toBe('lobby');
    expect(c.stages).toEqual(['lobby', 'game', 'lobby']);
  });

  it('나가면 처음 상태로 돌아간다', () => {
    const c = practice();
    c.mp.leave();
    expect(c.mp.stage).toBe('idle');
    expect(c.mp.session).toBeNull();
    expect(c.mp.lobbyView()).toBeNull();
    expect(c.mp.players()).toEqual([]);
    expect(c.mp.update(FRAME_MS, c.input)).toEqual([]);
  });
});

describe('방에 들어가기', () => {
  it('방 기능이 없으면 안내를 남기고, 연습하기는 동작한다', async () => {
    const mp = new Multiplayer(null, '', { onStage: () => undefined });
    await mp.create('가', 0);
    expect(mp.stage).toBe('idle');
    expect(mp.error).toBe('이 환경에서는 같이 하기를 사용할 수 없습니다.');
    mp.practice('가', 0);
    expect(mp.stage).toBe('lobby');
    expect(mp.error).toBeNull();
  });

  it('방 코드가 올바르지 않으면 들어가지 않는다', async () => {
    const guest = client(new FakeHub(), 'guest');
    await guest.mp.join('???', '손님', 0);
    expect(guest.mp.stage).toBe('idle');
    expect(guest.mp.error).toBe('방 코드가 올바르지 않습니다.');
  });

  it('없는 방 코드로 들어가면 settle 뒤에 안내와 함께 나온다', async () => {
    const hub = new FakeHub();
    const guest = client(hub, 'guest');
    await guest.mp.join('abcde', '손님', 0);
    expect(guest.mp.stage).toBe('lobby');
    pass(hub, SETTLE_MS - 100, guest);
    expect(guest.mp.stage).toBe('lobby');
    expect(guest.mp.isHost()).toBe(false);
    expect(guest.mp.lobbyView()?.settled).toBe(false);
    pass(hub, 200, guest);
    expect(guest.mp.stage).toBe('idle');
    expect(guest.mp.error).toBe('방을 찾을 수 없습니다.');
  });

  it('방에 들어가지 못하면 안내를 남긴다', async () => {
    const lobby: LobbyLike = { ...new FakeHub().lobby('a'), join: () => Promise.reject(new Error('fail')) };
    const mp = new Multiplayer(lobby, '', { onStage: () => undefined });
    await mp.create('가', 0);
    expect(mp.stage).toBe('idle');
    expect(mp.error).toBe('방에 들어가지 못했습니다. 잠시 후 다시 시도할 수 있습니다.');
  });

  it('들어가는 사이에 나가면 뒤늦게 열린 방에서 바로 나온다', async () => {
    const hub = new FakeHub();
    const c = client(hub, 'a');
    const entering = c.mp.create('가', 0);
    expect(c.mp.stage).toBe('joining');
    c.mp.leave();
    await entering;
    expect(c.mp.stage).toBe('idle');
    expect([...hub.rooms.values()].every((members) => members.size === 0)).toBe(true);
  });

  it('방을 만든 사람은 기다리지 않고 방장이 되며 혼자 있어도 머문다', async () => {
    const hub = new FakeHub();
    const host = client(hub, 'host');
    await host.mp.create('방장', 1);
    pass(hub, FRAME_MS, host);
    expect(host.mp.isHost()).toBe(true);
    pass(hub, SETTLE_MS + 500, host);
    const view = host.mp.lobbyView();
    expect(view?.practice).toBe(false);
    expect(view?.invite).toBe(`https://example.com/#${host.mp.code}`);
    expect(view?.rows.map((row) => row.id)).toEqual(['host', 'bot1']);
    expect(view?.maxBots).toBe(5);
    host.mp.setSettings({ bots: 0 });
    expect(host.mp.lobbyView()?.canStart).toBe(false);
  });

  it('손님이 들어오면 양쪽 대기실에 두 사람이 보이고 만든 사람이 방장이다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1);
    hub.addAgent('agent');
    host.mp.setSettings({ bots: 0 });
    pass(hub, 100, host, guest);
    for (const c of [host, guest]) {
      const view = c.mp.lobbyView();
      expect(view?.rows.map((row) => [row.id, row.name, row.host])).toEqual([
        ['p0', '방장', true],
        ['p1', '손님1', false],
      ]);
    }
    expect(host.mp.lobbyView()?.isHost).toBe(true);
    expect(guest.mp.lobbyView()?.isHost).toBe(false);
    expect(guest.mp.isHost()).toBe(false);
    expect(guest.mp.lobbyView()?.settings.bots).toBe(0);
  });

  it('일곱 번째로 들어온 사람은 방이 가득 찼다는 안내와 함께 나온다', async () => {
    const hub = new FakeHub();
    const all = await room(hub, 6);
    expect(all.slice(0, 6).map((c) => c.mp.stage)).toEqual(Array(6).fill('lobby'));
    expect(all[6].mp.stage).toBe('idle');
    expect(all[6].mp.error).toBe('방이 가득 찼습니다.');
    pass(hub, 100, ...all.slice(0, 6));
    const view = all[0].mp.lobbyView();
    expect(view?.rows).toHaveLength(6);
    expect(view?.maxBots).toBe(0);
    expect(new Set(view?.rows.map((row) => row.color)).size).toBe(6);
  });
});

describe('색', () => {
  it('같은 색을 고른 두 사람 가운데 늦게 온 사람이 빈 색으로 옮겨진다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1, [2, 2]);
    expect(host.mp.lobbyView()?.myColor).toBe(2);
    expect(guest.mp.lobbyView()?.myColor).toBe(0);
    expect(guest.mp.lobbyView()?.takenColors).toEqual([2]);
    expect(host.mp.lobbyView()?.takenColors).toEqual([0]);
    expect(host.mp.lobbyView()?.rows.map((row) => row.color)).toEqual([2, 0, 1]);
  });

  it('다른 사람이 쓰는 색은 고를 수 없고 빈 색은 고를 수 있다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1, [2, 4]);
    guest.mp.setColor(2);
    guest.mp.setColor(9);
    expect(guest.mp.lobbyView()?.myColor).toBe(4);
    guest.mp.setColor(5);
    pass(hub, 100, host, guest);
    expect(guest.mp.lobbyView()?.myColor).toBe(5);
    expect(host.mp.lobbyView()?.takenColors).toEqual([5]);
  });
});

describe('설정과 시작', () => {
  it('손님이 준비해야 시작할 수 있고, 시작하면 모두 같은 경기에 들어간다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1);
    expect(host.mp.lobbyView()?.canStart).toBe(false);
    host.mp.start();
    pass(hub, 100, host, guest);
    expect(host.mp.stage).toBe('lobby');

    guest.mp.toggleReady();
    pass(hub, 100, host, guest);
    expect(host.mp.lobbyView()?.rows[1].ready).toBe(true);
    expect(host.mp.lobbyView()?.canStart).toBe(true);
    expect(guest.mp.lobbyView()?.canStart).toBe(false);
    host.mp.start();
    pass(hub, 100, host, guest);
    for (const c of [host, guest]) {
      expect(c.mp.stage).toBe('game');
      expect(c.mp.session?.match.round).toBe(1);
      expect(c.mp.session?.match.roster).toEqual(['p0', 'p1', 'bot1']);
      expect(c.mp.session?.view().watching).toBe(false);
      expect(c.mp.players().map((p) => [p.id, p.color])).toEqual([
        ['p0', 0],
        ['p1', 1],
        ['bot1', 2],
      ]);
    }
    expect(guest.stages).toEqual(['joining', 'lobby', 'game']);
  });

  it('방장이 아닌 사람의 설정 변경과 시작은 아무 일도 하지 않는다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1);
    guest.mp.toggleReady();
    guest.mp.setSettings({ mode: 'grapple', bots: 3 });
    guest.mp.start();
    pass(hub, 100, host, guest);
    expect(guest.mp.stage).toBe('lobby');
    expect(host.mp.stage).toBe('lobby');
    expect(host.mp.lobbyView()?.settings).toMatchObject({ mode: 'classic', bots: 1 });
    expect(guest.mp.lobbyView()?.settings).toMatchObject({ mode: 'classic', bots: 1 });
  });

  it('방장이 바꾼 설정이 손님의 대기실에도 보인다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1);
    host.mp.setSettings({ mode: 'arrows', target: 7, bots: 4 });
    pass(hub, 100, host, guest);
    expect(guest.mp.lobbyView()?.settings).toEqual({ mode: 'arrows', target: 7, mapSetting: -1, bots: 4 });
    expect(guest.mp.lobbyView()?.rows).toHaveLength(6);
    host.mp.setSettings({ bots: 5 });
    expect(host.mp.lobbyView()?.settings.bots).toBe(4);
  });

  it('사람이 늘어 자리가 모자라면 방장이 AI를 줄인다', async () => {
    const hub = new FakeHub();
    const host = client(hub, 'p0');
    await host.mp.create('방장', 0);
    pass(hub, 100, host);
    host.mp.setSettings({ bots: 3 });
    expect(host.mp.lobbyView()?.settings.bots).toBe(3);
    const all = [host];
    for (let i = 1; i <= 4; i++) {
      hub.now += 10;
      const guest = client(hub, `p${i}`);
      await guest.mp.join(host.mp.code, `손님${i}`, i);
      all.push(guest);
    }
    pass(hub, 100, ...all);
    expect(host.mp.session?.match.settings.bots).toBe(1);
    expect(host.mp.lobbyView()?.rows).toHaveLength(6);
  });

  it('대기실에서 방장이 나가면 다음 사람이 설정을 이어받아 방장이 된다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1);
    host.mp.setSettings({ mode: 'grapple' });
    pass(hub, 100, host, guest);
    host.mp.leave();
    pass(hub, 100, guest);
    expect(guest.mp.stage).toBe('lobby');
    expect(guest.mp.isHost()).toBe(true);
    expect(guest.mp.lobbyView()?.rows.map((row) => row.id)).toEqual(['p1', 'bot1']);
    expect(guest.mp.lobbyView()?.settings.mode).toBe('grapple');
  });
});

describe('경기 중', () => {
  it('방장이 나가면 남은 사람이 방장이 되어 점수와 라운드를 이어 간다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 0);
    guest.input = { ...NO_INPUT, left: true };
    passUntil(hub, () => host.mp.session?.match.round === 2, [host, guest]);
    const scores = { ...guest.mp.session?.match.scores };
    expect(Object.keys(scores)).toEqual(['p0', 'p1']);
    expect(scores.p0 + scores.p1).toBe(1);

    host.mp.leave();
    expect(host.mp.stage).toBe('idle');
    pass(hub, 200, guest);
    expect(guest.mp.isHost()).toBe(true);
    expect(guest.mp.stage).toBe('game');
    expect(guest.mp.session?.match).toMatchObject({ game: 1, round: 2, scores });
    expect(guest.stages).toEqual(['joining', 'lobby', 'game']);
  });

  it('방장이 나가도 새 방장의 화면에서 AI가 계속 움직인다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 1);
    pass(hub, 3500, host, guest);
    expect(guest.mp.session?.match.phase).toBe('play');
    host.mp.leave();
    pass(hub, 100, guest);
    expect(guest.mp.isHost()).toBe(true);
    expect(ball(guest, 'p0').alive).toBe(false);
    const before = ball(guest, 'bot1').x;
    pass(hub, 1500, guest);
    expect(guest.mp.session?.match.phase).toBe('play');
    expect(ball(guest, 'bot1').x).not.toBe(before);
    expect(guest.mp.session?.hostWire().bs.bot1).toBeDefined();
  });

  it('손님의 화면에서 방장의 공과 AI가 받은 상태를 따라 움직인다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 1);
    pass(hub, 3100, host, guest);
    host.input = { ...NO_INPUT, right: true };
    pass(hub, 800, host, guest);
    expect(Math.abs(ball(guest, 'p0').x - ball(host, 'p0').x)).toBeLessThan(1.5);
    expect(Math.abs(ball(guest, 'bot1').x - ball(host, 'bot1').x)).toBeLessThan(1.5);
  });

  it('경기 중에 들어온 사람은 구경하다가 다음 라운드부터 참가한다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 0);
    const late = client(hub, 'p2');
    await late.mp.join(host.mp.code, '늦은이', 0);
    pass(hub, 200, host, guest, late);
    expect(late.mp.stage).toBe('game');
    expect(late.mp.session?.view().watching).toBe(true);
    expect(late.mp.isHost()).toBe(false);
    expect(late.mp.lobbyView()).toBeNull();
    expect(late.mp.players().map((p) => [p.id, p.color])).toEqual([
      ['p0', 0],
      ['p1', 1],
      ['p2', 2],
    ]);

    pass(hub, SETTLE_MS, host, guest, late);
    expect(late.mp.stage).toBe('game');
    guest.input = { ...NO_INPUT, left: true };
    passUntil(hub, () => host.mp.session?.match.round === 2, [host, guest, late]);
    pass(hub, 100, host, guest, late);
    expect(late.mp.session?.match.roster).toEqual(['p0', 'p1', 'p2']);
    expect(late.mp.session?.view().watching).toBe(false);
  });

  it('방장이 대기실로 돌아가면 모두 대기실로 가고 준비가 풀린다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 1);
    guest.mp.backToLobby();
    pass(hub, 100, host, guest);
    expect(host.mp.stage).toBe('game');

    host.mp.backToLobby();
    pass(hub, 100, host, guest);
    for (const c of [host, guest]) {
      expect(c.mp.stage).toBe('lobby');
      expect(c.mp.lobbyView()?.ready).toBe(false);
      expect(c.mp.lobbyView()?.rows.map((row) => row.ready)).toEqual([false, false, true]);
      expect(c.mp.session?.view().map).toBeNull();
    }
    expect(host.mp.lobbyView()?.canStart).toBe(false);
    guest.mp.toggleReady();
    pass(hub, 100, host, guest);
    host.mp.start();
    pass(hub, 100, host, guest);
    expect(guest.mp.session?.match).toMatchObject({ game: 2, round: 1, phase: 'countdown' });
  });
});

describe('송신', () => {
  it('경기 중에는 60ms보다 짧은 간격으로 다시 보내지 않는다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 1);
    const from = hub.now;
    pass(hub, 960, host, guest);
    for (const peer of ['p0', 'p1']) {
      const times = (hub.sends.get(peer) ?? []).filter((t) => t > from);
      expect(times.length).toBeGreaterThanOrEqual(10);
      expect(times.length).toBeLessThanOrEqual(960 / SEND_INTERVAL);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(SEND_INTERVAL);
    }
  });

  it('보낼 때마다 번호가 오른다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 1);
    const read = () => Number([...hub.rooms.values()][0].get('p1')?.presence.n);
    const before = read();
    pass(hub, 320, host, guest);
    expect(read()).toBeGreaterThan(before);
  });

  it('탈락하면 간격을 기다리지 않고 바로 보낸다', async () => {
    const hub = new FakeHub();
    const { host, guest } = await startedPair(hub, 1);
    pass(hub, 3100, host, guest);
    guest.input = { ...NO_INPUT, left: true };
    passUntil(hub, () => guest.events.some((e) => e.type === 'out' && e.id === 'p1'), [host, guest]);
    expect(hub.sends.get('p1')?.at(-1)).toBe(hub.now);
  });

  it('대기실에서는 값이 바뀌었을 때만 보낸다', async () => {
    const hub = new FakeHub();
    const [host, guest] = await room(hub, 1);
    const count = () => (hub.sends.get('p0')?.length ?? 0) + (hub.sends.get('p1')?.length ?? 0);
    const before = count();
    pass(hub, 1000, host, guest);
    expect(count()).toBe(before);
    host.mp.setSettings({ target: 3 });
    pass(hub, 1000, host, guest);
    expect(count()).toBe(before + 1);
  });
});
