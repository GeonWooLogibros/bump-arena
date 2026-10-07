import type { LobbyLike, NamedRoomLike, PeerLike } from './types';

/**
 * 브라우저끼리 직접 연결(WebRTC)해서 방 기능을 만듭니다. 별도 서버 없이 GitHub Pages 같은 정적 호스팅에서 동작합니다.
 *
 * 방 이름으로 정한 고정 이름표를 먼저 차지한 브라우저가 방장(중계)이 되고, 나머지는 그 이름표로 연결합니다.
 * 참가자는 자기 상태를 방장에게 보내고, 방장은 모두의 상태를 묶어 모두에게 보냅니다.
 * 방장이 나가면 남은 사람들이 이름표를 다시 차지하려 하고, 먼저 차지한 사람이 새 방장이 됩니다.
 */

/** PeerJS의 DataConnection 가운데 이 연결이 쓰는 부분. */
export interface ConnLike {
  readonly open: boolean;
  on(event: 'open' | 'close', callback: () => void): void;
  on(event: 'data', callback: (data: unknown) => void): void;
  on(event: 'error', callback: (error: { type?: string }) => void): void;
  send(data: unknown): void;
  close(): void;
}

/** PeerJS의 Peer 가운데 이 연결이 쓰는 부분. */
export interface NodeLike {
  on(event: 'open', callback: (id: string) => void): void;
  on(event: 'connection', callback: (conn: ConnLike) => void): void;
  on(event: 'error', callback: (error: { type?: string }) => void): void;
  connect(id: string): ConnLike;
  destroy(): void;
}

/** id를 주면 그 이름표로, 주지 않으면 아무 이름표로 Peer를 만듭니다. */
export type NodeMaker = (id?: string) => NodeLike;

/** 상태를 보내는 간격과, 바뀐 것이 없어도 다시 보내는 간격(밀리초). */
const SEND_INTERVAL = 60;
const RELAY_INTERVAL = 80;
const HEARTBEAT = 1000;
/** 방에 들어가거나 방장을 이어받는 데 기다리는 시간(밀리초). */
const READY_TIMEOUT = 10000;
/** 방장이 사라졌을 때 이름표를 다시 차지하기 전에 기다리는 시간의 범위. 여럿이 한꺼번에 시도하지 않게 흩어 둡니다. */
const MIGRATE_MIN = 200;
const MIGRATE_SPREAD = 1200;

type State = Record<string, unknown>;

function isRecord(value: unknown): value is State {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 방 이름으로 방장이 차지할 이름표를 만듭니다. 다른 서비스와 겹치지 않게 앞에 게임 이름을 붙입니다. */
export function hostIdFor(name: string): string {
  return `bonk-arena-${name}`;
}

export class P2PRoom implements NamedRoomLike {
  private node: NodeLike | null = null;
  private role: 'host' | 'client' | 'none' = 'none';
  private mine: State = {};
  private mineAt = Date.now();
  /** 방장일 때는 참가자별 연결과 상태, 참가자일 때는 방장이 보내 준 모두의 상태를 둡니다. */
  private readonly clients = new Map<ConnLike, string>();
  private states = new Map<string, { state: State; at: number }>();
  private hostConn: ConnLike | null = null;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSent = 0;
  private dirty = true;
  private closed = false;
  private notifyQueued = false;
  readonly ready: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private rejectReady: (error: Error) => void = () => undefined;
  private readied = false;

  constructor(
    private readonly make: NodeMaker,
    private readonly name: string,
    private readonly key: string,
    private readonly random: () => number = Math.random,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    setTimeout(() => {
      if (!this.readied) this.rejectReady(new Error('timeout'));
    }, READY_TIMEOUT);
    this.claim();
  }

  /** 방장 이름표를 차지해 봅니다. 이미 누가 차지했으면 그 방장에게 연결합니다. */
  private claim(): void {
    if (this.closed) return;
    const node = this.make(hostIdFor(this.name));
    this.node = node;
    node.on('open', () => {
      if (this.node !== node) return;
      this.becomeHost();
    });
    node.on('connection', (conn) => this.accept(conn));
    node.on('error', (error) => {
      if (this.node !== node) return;
      if (error.type === 'unavailable-id') {
        node.destroy();
        this.joinAsClient();
      }
    });
  }

  private becomeHost(): void {
    this.role = 'host';
    this.hostConn = null;
    // 참가자일 때 받아 둔 다른 사람의 상태는 새로 연결해 오면 다시 채워집니다.
    this.states = new Map();
    this.markReady();
    this.startTimer();
    this.notify();
  }

  private accept(conn: ConnLike): void {
    conn.on('data', (data) => {
      if (this.role !== 'host' || !isRecord(data) || typeof data.k !== 'string' || !isRecord(data.s)) return;
      const key = data.k.slice(0, 64);
      if (key === this.key) return;
      this.clients.set(conn, key);
      this.states.set(key, { state: data.s, at: Date.now() });
      this.dirty = true;
      this.notify();
    });
    conn.on('close', () => {
      const key = this.clients.get(conn);
      this.clients.delete(conn);
      if (key) this.states.delete(key);
      this.dirty = true;
      this.notify();
    });
    conn.on('error', () => conn.close());
  }

  private joinAsClient(): void {
    if (this.closed) return;
    const node = this.make();
    this.node = node;
    node.on('error', (error) => {
      if (this.node !== node) return;
      // 방장이 막 나가서 이름표가 비었으면 잠시 뒤에 직접 차지해 봅니다.
      if (error.type === 'peer-unavailable') this.migrate(node);
    });
    node.on('open', () => {
      if (this.node !== node) return;
      const conn = node.connect(hostIdFor(this.name));
      this.hostConn = conn;
      conn.on('open', () => {
        if (this.hostConn !== conn) return;
        this.role = 'client';
        this.dirty = true;
        this.markReady();
        this.startTimer();
        this.send();
      });
      conn.on('data', (data) => {
        if (this.hostConn !== conn || !isRecord(data) || !isRecord(data.all)) return;
        const at = Date.now();
        const next = new Map<string, { state: State; at: number }>();
        for (const [key, state] of Object.entries(data.all)) {
          if (key !== this.key && isRecord(state)) next.set(key.slice(0, 64), { state, at });
        }
        this.states = next;
        this.notify();
      });
      conn.on('close', () => {
        if (this.hostConn === conn) this.migrate(node);
      });
    });
  }

  /** 방장이 사라졌으면 흩어 둔 시간만큼 기다린 뒤 이름표를 차지해 봅니다. */
  private migrate(node: NodeLike): void {
    if (this.closed || this.node !== node) return;
    this.role = 'none';
    this.hostConn = null;
    this.stopTimer();
    node.destroy();
    this.node = null;
    setTimeout(() => this.claim(), MIGRATE_MIN + this.random() * MIGRATE_SPREAD);
  }

  private markReady(): void {
    if (this.readied) return;
    this.readied = true;
    this.resolveReady();
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.send(), this.role === 'host' ? RELAY_INTERVAL : SEND_INTERVAL);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private send(): void {
    if (this.closed) return;
    const now = Date.now();
    if (!this.dirty && now - this.lastSent < HEARTBEAT) return;
    this.dirty = false;
    this.lastSent = now;
    if (this.role === 'client' && this.hostConn?.open) {
      this.hostConn.send({ k: this.key, s: this.mine });
    } else if (this.role === 'host') {
      const all: Record<string, State> = { [this.key]: this.mine };
      for (const [key, entry] of this.states) all[key] = entry.state;
      // 참가자는 연결하자마자 자기 상태를 보내므로, 상태를 한 번이라도 보낸 연결에만 보내면 됩니다.
      for (const conn of this.clients.keys()) if (conn.open) conn.send({ all });
    }
  }

  private notify(): void {
    if (this.notifyQueued || this.closed) return;
    this.notifyQueued = true;
    setTimeout(() => {
      this.notifyQueued = false;
      if (!this.closed) for (const listener of this.listeners) listener();
    }, 0);
  }

  presence(patch: Record<string, unknown>): Promise<void> {
    const next = { ...this.mine };
    for (const [field, value] of Object.entries(patch)) {
      if (value === null) delete next[field];
      else next[field] = value;
    }
    this.mine = next;
    this.mineAt = Date.now();
    this.dirty = true;
    this.notify();
    return Promise.resolve();
  }

  peers(): readonly PeerLike[] {
    const list: PeerLike[] = [
      { peer: this.key, sameTab: true, kind: 'viewer', presence: this.mine, updatedAt: this.mineAt },
    ];
    for (const [peer, entry] of this.states) {
      list.push({ peer, sameTab: false, kind: 'viewer', presence: entry.state, updatedAt: entry.at });
    }
    return list;
  }

  onPeers(handler: () => void): () => void {
    this.listeners.add(handler);
    this.notify();
    return () => this.listeners.delete(handler);
  }

  leave(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.stopTimer();
    this.listeners.clear();
    this.node?.destroy();
    this.node = null;
    return Promise.resolve();
  }
}

/** P2P에는 방 목록을 모아 둘 곳이 없으므로, 로비는 방에 들어가는 입구 역할만 합니다. */
export function createP2PLobby(make: NodeMaker, key: string): LobbyLike {
  return {
    listsRooms: false,
    presence: () => Promise.resolve(),
    peers: () => [],
    onPeers: () => () => undefined,
    async join(name) {
      const room = new P2PRoom(make, name, key);
      try {
        await room.ready;
      } catch (error) {
        await room.leave();
        throw error;
      }
      return room;
    },
  };
}
