import type { ConnLike, NodeLike } from '../src/net/p2p-room';

type Handler = (...args: never[]) => void;

/**
 * 메모리 안에서만 동작하는 PeerJS 흉내. 이름표 차지, 연결, 끊김을 그대로 따라 합니다.
 * connectMs를 주면 실제처럼 연결에 그만큼 시간이 걸립니다. 0이면 바로 연결됩니다.
 */
export class FakeNet {
  readonly nodes = new Map<string, FakeNode>();
  private counter = 0;
  constructor(readonly connectMs = 0) {}
  make = (id?: string): NodeLike => new FakeNode(this, id ?? `anon-${++this.counter}`);
}

class FakeEmitter {
  private readonly handlers = new Map<string, Handler[]>();
  on(event: string, callback: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), callback]);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) (handler as (...a: unknown[]) => void)(...args);
  }
}

class FakeConn extends FakeEmitter implements ConnLike {
  open = false;
  other: FakeConn | null = null;
  send(data: unknown): void {
    const target = this.other;
    if (!this.open || !target?.open) return;
    queueMicrotask(() => target.emit('data', JSON.parse(JSON.stringify(data))));
  }
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
    if (this.other?.open) this.other.close();
  }
}

class FakeNode extends FakeEmitter implements NodeLike {
  readonly conns: FakeConn[] = [];
  destroyed = false;
  constructor(
    private readonly net: FakeNet,
    readonly id: string,
  ) {
    super();
    queueMicrotask(() => {
      if (net.nodes.has(id)) {
        this.emit('error', { type: 'unavailable-id' });
        return;
      }
      net.nodes.set(id, this);
      this.emit('open', id);
    });
  }
  connect(id: string): ConnLike {
    const mine = new FakeConn();
    this.conns.push(mine);
    const link = (): void => {
      const target = this.net.nodes.get(id);
      if (!target || target.destroyed) {
        this.emit('error', { type: 'peer-unavailable' });
        return;
      }
      const theirs = new FakeConn();
      target.conns.push(theirs);
      mine.other = theirs;
      theirs.other = mine;
      mine.open = true;
      theirs.open = true;
      target.emit('connection', theirs);
      mine.emit('open');
      theirs.emit('open');
    };
    if (this.net.connectMs > 0) setTimeout(link, this.net.connectMs);
    else queueMicrotask(link);
    return mine;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.net.nodes.get(this.id) === this) this.net.nodes.delete(this.id);
    for (const conn of this.conns) conn.close();
  }
}
