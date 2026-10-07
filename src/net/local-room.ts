import type { NamedRoomLike } from './types';

/** 나만 들어 있는 방. 연습하기에서 같이 하기와 같은 경로를 쓰기 위한 것입니다. */
export function createLocalRoom(now: () => number = Date.now): NamedRoomLike {
  let presence: Record<string, unknown> = {};
  let updatedAt = now();
  const handlers = new Set<() => void>();
  return {
    async presence(patch) {
      presence = { ...presence, ...patch };
      for (const [field, value] of Object.entries(patch)) if (value === null) delete presence[field];
      updatedAt = now();
      for (const handler of [...handlers]) handler();
    },
    peers: () => [{ peer: 'me', sameTab: true, kind: 'user', presence, updatedAt }],
    onPeers(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    async leave() {
      handlers.clear();
    },
  };
}
