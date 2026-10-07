import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/game/round';
import { Multiplayer } from '../src/multiplayer';
import { P2PRoom, createP2PLobby } from '../src/net/p2p-room';
import type { LobbyLike } from '../src/net/types';
import { NO_INPUT } from '../src/physics/world';
import { ABSENT_GRACE_MS } from '../src/session';
import { FakeNet } from './fake-peer-net';

const FRAME_MS = 16;
/** 실제 PeerJS처럼 연결에 걸리는 시간(밀리초)입니다. */
const CONNECT_MS = 300;

/** 한 사람의 화면입니다. running이 false이면 가려진 탭처럼 update를 부르지 않습니다. 방의 타이머는 계속 돕니다. */
interface Client {
  id: string;
  mp: Multiplayer;
  running: boolean;
}

/** 실제 P2PRoom을 쓰는 화면을 만듭니다. order(0~1)는 방장이 사라졌을 때 이름표를 다시 차지하러 가는 순서입니다. */
function client(net: FakeNet, id: string, order = 0): Client {
  const lobby: LobbyLike = {
    ...createP2PLobby(net.make, id),
    async join(name) {
      const room = new P2PRoom(net.make, name, id, () => order);
      await room.ready;
      return room;
    },
  };
  const mp = new Multiplayer(lobby, '', { onStage: () => undefined }, undefined, () => 0.5);
  return { id, mp, running: true };
}

/** ms만큼 시계를 16ms씩 움직이며 running인 화면만 update합니다. */
async function run(ms: number, clients: Client[]): Promise<void> {
  for (let t = 0; t < ms; t += FRAME_MS) {
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    for (const c of clients) if (c.running) c.mp.update(FRAME_MS, NO_INPUT);
  }
}

/** 방에 들어가는 동안 시계를 움직여 연결이 끝나게 합니다. */
async function enter(entering: Promise<void>): Promise<void> {
  await vi.advanceTimersByTimeAsync(CONNECT_MS + 100);
  await entering;
}

/** 첫 번째 사람이 방을 만들고 나머지가 들어와 평지에서 경기를 시작한 상태입니다. orders는 사람마다의 order입니다. */
async function started(ids: string[], orders: number[], patch: Partial<Settings>): Promise<Client[]> {
  const net = new FakeNet(CONNECT_MS);
  const all = ids.map((id, i) => client(net, id, orders[i]));
  const [host, ...guests] = all;
  await enter(host.mp.create('방장', 0));
  for (const [i, guest] of guests.entries()) {
    await vi.advanceTimersByTimeAsync(50);
    await enter(guest.mp.join(host.mp.code, `손님${i + 1}`, i + 1));
  }
  await run(2300, all);
  host.mp.setSettings({ mapSetting: 0, ...patch });
  for (const guest of guests) guest.mp.toggleReady();
  await run(300, all);
  host.mp.start();
  await run(200, all);
  for (const c of all) expect(c.mp.stage).toBe('game');
  return all;
}

function alive(c: Client, id: string): boolean | undefined {
  return c.mp.session?.view().balls.find((b) => b.id === id)?.alive;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('실제 P2P 방에서 가려진 탭', () => {
  it('손님의 화면이 11초 멈추면 방의 타이머가 계속 돌아도 그 손님을 나간 것으로 본다', async () => {
    const all = await started(['hhhh', 'aaaa'], [0, 0], { bots: 0 });
    const [h, a] = all;
    await run(3400, all);
    expect(h.mp.session?.match.phase).toBe('play');

    a.running = false;
    await run(9000, all);
    expect(h.mp.players().map((p) => p.id)).toEqual(['hhhh', 'aaaa']);
    expect(alive(h, 'aaaa')).toBe(true);
    await run(2000, all);
    expect(h.mp.players().map((p) => p.id)).toEqual(['hhhh']);

    await run(ABSENT_GRACE_MS + 500, all);
    expect(alive(h, 'aaaa')).toBe(false);
    expect(h.mp.session?.match).toMatchObject({ phase: 'roundEnd', winner: 'hhhh' });
  });

  it('방장의 화면이 11초 멈추면 다음 사람이 방장이 되어 경기를 이어 간다', async () => {
    const all = await started(['hhhh', 'aaaa'], [0, 0], { bots: 1 });
    const [h, a] = all;
    await run(800, all);
    expect(a.mp.session?.match.phase).toBe('countdown');

    h.running = false;
    await run(9000, all);
    expect(a.mp.isHost()).toBe(false);
    expect(a.mp.session?.match.phase).toBe('countdown');
    await run(2000, all);
    expect(a.mp.isHost()).toBe(true);
    expect(a.mp.stage).toBe('game');
    await run(2500, all);
    expect(a.mp.session?.match).toMatchObject({ game: 1, round: 1, phase: 'play' });
  });
});

describe('실제 P2P 방에서 방장이 나갈 때', () => {
  it('사람 셋 가운데 방장이 나가도 남은 두 사람은 서로를 탈락시키지 않고 라운드를 이어 간다', async () => {
    // 방장이 나가면 b가 먼저(200ms 뒤) 이름표를 차지하고, a는 1280ms 뒤에야 다시 연결하러 갑니다.
    const all = await started(['hhhh', 'aaaa', 'bbbb'], [0, 0.9, 0], { bots: 0 });
    const [h, a, b] = all;
    await run(3400, all);
    for (const c of [a, b]) expect(c.mp.session?.match.phase).toBe('play');

    h.running = false;
    h.mp.leave();
    const rest = [a, b];
    for (let ms = 0; ms < 2000; ms += FRAME_MS) {
      await run(FRAME_MS, rest);
      for (const c of rest) {
        expect(c.mp.session?.match).toMatchObject({ phase: 'play', winner: null });
        expect(alive(c, 'aaaa')).toBe(true);
        expect(alive(c, 'bbbb')).toBe(true);
      }
    }
    expect(rest.map((c) => c.mp.isHost())).toEqual([false, true]);
    expect(a.mp.players().map((p) => p.id)).toEqual(['aaaa', 'bbbb']);

    // 나간 방장은 기다리는 시간이 지난 뒤에 탈락하고, 남은 두 사람의 라운드는 계속됩니다.
    await run(ABSENT_GRACE_MS, rest);
    for (const c of rest) {
      expect(alive(c, 'hhhh')).toBe(false);
      expect(alive(c, 'aaaa')).toBe(true);
      expect(alive(c, 'bbbb')).toBe(true);
      expect(c.mp.session?.match).toMatchObject({ phase: 'play', scores: { hhhh: 0, aaaa: 0, bbbb: 0 } });
    }
  });
});
