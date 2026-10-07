import { describe, expect, it, vi } from 'vitest';
import { createLocalRoom } from '../src/net/local-room';

describe('createLocalRoom', () => {
  it('나만 들어 있고 같은 탭입니다', () => {
    const peers = createLocalRoom(() => 7).peers();
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ peer: 'me', sameTab: true, kind: 'user', updatedAt: 7 });
  });

  it('presence 값을 합쳐서 저장합니다', async () => {
    const room = createLocalRoom();
    await room.presence({ a: 1 });
    await room.presence({ b: 2 });
    expect(room.peers()[0].presence).toEqual({ a: 1, b: 2 });
  });

  it('onPeers 핸들러를 부르고 돌려받은 함수로 해제합니다', async () => {
    const room = createLocalRoom();
    const handler = vi.fn();
    const off = room.onPeers(handler);
    await room.presence({ a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    await room.presence({ a: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('leave는 오류 없이 끝납니다', async () => {
    await expect(createLocalRoom().leave()).resolves.toBeUndefined();
  });
});
