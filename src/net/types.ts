/** 방 기능 가운데 이 게임이 쓰는 부분. claude.ai의 room 기능과 P2P 연결이 같은 모양을 따릅니다. */
export interface PeerLike {
  peer: string;
  sameTab: boolean;
  kind: string;
  presence: Readonly<Record<string, unknown>>;
  /** 이 사람의 상태를 마지막으로 받은 시각(받는 쪽의 Date.now()). */
  updatedAt: number;
}

export interface RoomLike {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly PeerLike[];
  onPeers(handler: () => void, onError?: (e: { code: string }) => void): () => void;
}

export interface NamedRoomLike extends RoomLike {
  leave(): Promise<void>;
}

export interface LobbyLike extends RoomLike {
  /** 열린 방 목록을 보여 줄 수 있는지 여부. P2P처럼 모아 둘 곳이 없으면 false입니다. */
  listsRooms?: boolean;
  join(name: string): Promise<NamedRoomLike>;
}
