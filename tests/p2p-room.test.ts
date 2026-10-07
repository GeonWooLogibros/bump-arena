import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { P2PRoom, createP2PLobby, hostIdFor } from '../src/net/p2p-room';
import { FakeNet } from './fake-peer-net';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const names = (room: P2PRoom): unknown[] => room.peers().map((peer) => peer.presence.name);

describe('P2P 방', () => {
  it('방장 이름표는 방 이름 앞에 게임 이름을 붙입니다', () => {
    expect(hostIdFor('rr-ab2cd')).toBe('bonk-arena-rr-ab2cd');
  });

  it('먼저 들어온 사람이 방장이 되고, 다음 사람은 방장에게 연결해서 서로의 상태를 받습니다', async () => {
    const net = new FakeNet();
    const host = new P2PRoom(net.make, 'rr-ab2cd', 'host-key');
    await host.ready;
    const guest = new P2PRoom(net.make, 'rr-ab2cd', 'guest-key');
    await guest.ready;
    await host.presence({ name: '방장' });
    await guest.presence({ name: '친구' });
    await vi.advanceTimersByTimeAsync(300);
    expect(names(host)).toEqual(['방장', '친구']);
    expect(names(guest)).toEqual(['친구', '방장']);
  });

  it('참가자 둘의 상태도 방장을 거쳐 서로에게 전해집니다', async () => {
    const net = new FakeNet();
    const host = new P2PRoom(net.make, 'rr-ab2cd', 'h');
    await host.ready;
    const a = new P2PRoom(net.make, 'rr-ab2cd', 'a');
    const b = new P2PRoom(net.make, 'rr-ab2cd', 'b');
    await Promise.all([a.ready, b.ready]);
    await a.presence({ name: 'A', z: 100 });
    await b.presence({ name: 'B', z: 200 });
    await vi.advanceTimersByTimeAsync(300);
    expect(new Set(names(a))).toEqual(new Set(['A', 'B', undefined]));
    expect(b.peers().find((p) => p.peer === 'a')?.presence.z).toBe(100);
  });

  it('형식이 틀린 상태는 받지 않습니다', async () => {
    const net = new FakeNet();
    const host = new P2PRoom(net.make, 'rr-ab2cd', 'h');
    await host.ready;
    const node = net.make();
    await vi.advanceTimersByTimeAsync(0);
    const conn = node.connect(hostIdFor('rr-ab2cd'));
    await vi.advanceTimersByTimeAsync(0);
    conn.send('nonsense');
    conn.send({ k: 5, s: {} });
    conn.send({ k: 'x', s: [1] });
    conn.send({ k: 'h', s: { name: '가짜 방장' } });
    await vi.advanceTimersByTimeAsync(10);
    expect(host.peers().map((p) => p.peer)).toEqual(['h']);
  });

  it('참가자가 나가면 방장 목록에서 빠집니다', async () => {
    const net = new FakeNet();
    const host = new P2PRoom(net.make, 'rr-ab2cd', 'h');
    await host.ready;
    const guest = new P2PRoom(net.make, 'rr-ab2cd', 'g');
    await guest.ready;
    await vi.advanceTimersByTimeAsync(200);
    expect(host.peers()).toHaveLength(2);
    await guest.leave();
    await vi.advanceTimersByTimeAsync(10);
    expect(host.peers()).toHaveLength(1);
  });

  it('방장이 나가면 남은 사람 중 한 명이 방장을 이어받고 다른 사람은 다시 연결합니다', async () => {
    const net = new FakeNet();
    const host = new P2PRoom(net.make, 'rr-ab2cd', 'h', () => 0);
    await host.ready;
    const a = new P2PRoom(net.make, 'rr-ab2cd', 'a', () => 0);
    const b = new P2PRoom(net.make, 'rr-ab2cd', 'b', () => 0.9);
    await Promise.all([a.ready, b.ready]);
    await a.presence({ name: 'A' });
    await b.presence({ name: 'B' });
    await vi.advanceTimersByTimeAsync(300);
    await host.leave();
    await vi.advanceTimersByTimeAsync(3000);
    expect(net.nodes.has(hostIdFor('rr-ab2cd'))).toBe(true);
    expect(new Set(names(a))).toEqual(new Set(['A', 'B']));
    expect(new Set(names(b))).toEqual(new Set(['B', 'A']));
  });
});

describe('P2P 로비', () => {
  it('방 목록은 보여 줄 수 없고, 방에 들어가는 입구 역할만 합니다', async () => {
    const net = new FakeNet();
    const lobby = createP2PLobby(net.make, 'me');
    expect(lobby.listsRooms).toBe(false);
    expect(lobby.peers()).toEqual([]);
    const room = await lobby.join('rr-ab2cd');
    expect(room.peers().map((p) => p.peer)).toEqual(['me']);
  });
});
