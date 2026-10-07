import type { LobbyLike } from './types';

/** claude.ai에 게시한 게임 링크. 그 안에서 열었을 때 초대 링크는 이 주소 뒤에 #방코드를 붙입니다. 배포 뒤에 채웁니다. */
const CLAUDE_GAME_URL = '';

export interface Connection {
  lobby: LobbyLike | null;
  /** 초대 링크의 앞부분. 이 뒤에 #방코드를 붙입니다. 비어 있으면 방 코드만 알려 줍니다. */
  inviteBase: string;
  /** 어떤 방식으로 연결했는지. 'claude'는 claude.ai의 room 기능, 'p2p'는 공개 사이트입니다. */
  via: 'claude' | 'p2p' | 'none';
}

/**
 * 방 기능에 연결합니다. claude.ai 안에서 열었으면 그 room 기능을 쓰고,
 * 공개 사이트용으로 빌드했으면 브라우저끼리 직접 연결합니다. 둘 다 아니면 혼자 하기만 됩니다.
 */
export async function connect(): Promise<Connection> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    // 연결할 수 없는 환경이면 최대 10초 뒤에 null이 옵니다.
    const lobby = (await claude.use('room').catch(() => null)) as LobbyLike | null;
    return { lobby, inviteBase: CLAUDE_GAME_URL, via: lobby ? 'claude' : 'none' };
  }

  const here = `${window.location.origin}${window.location.pathname}`;
  if (import.meta.env.VITE_NET === 'p2p') {
    try {
      const [{ Peer }, { createP2PLobby }, { makePeerKey }] = await Promise.all([
        import('peerjs'),
        import('./p2p-room'),
        import('./peer-key'),
      ]);
      const make = (id?: string) => (id ? new Peer(id) : new Peer()) as unknown as import('./p2p-room').NodeLike;
      return { lobby: createP2PLobby(make, makePeerKey()), inviteBase: here, via: 'p2p' };
    } catch {
      return { lobby: null, inviteBase: here, via: 'none' };
    }
  }
  return { lobby: null, inviteBase: here, via: 'none' };
}
