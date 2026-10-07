/** 방과 대기실, 방장 선출, 상태 송수신. 방의 presence를 읽고 쓰기만 하며, 화면 요소는 사용하지 않습니다. */
import {
  COLORS,
  MAX_PLAYERS,
  botColors,
  cleanName,
  makeRoomCode,
  parseRoomCode,
  pickHost,
  resolveColor,
  roomName,
  seatOrder,
} from './game/lobby';
import { DEFAULT_SETTINGS, botIds, isBot } from './game/round';
import type { Settings } from './game/round';
import { createLocalRoom } from './net/local-room';
import type { LobbyLike, NamedRoomLike } from './net/types';
import { encodeBall, encodeHost, readPeer } from './net/wire';
import type { PeerState } from './net/wire';
import type { Input, WorldEvent } from './physics/world';
import { Session } from './session';

/** 경기가 진행되는 동안 내 상태를 보내는 간격(밀리초)입니다. */
export const SEND_INTERVAL = 60;
/** 방에 들어온 직후 다른 사람의 상태가 다 도착하기까지 기다리는 시간(밀리초)입니다. 그동안은 방장 권한을 쓰지 않습니다. */
export const SETTLE_MS = 2000;
/** 경기 중에 상대의 소식이 이만큼 끊기면 나간 것으로 봅니다(밀리초). 대기실에서는 쓰지 않습니다. */
export const GONE_MS = 10000;

export type Stage = 'idle' | 'joining' | 'lobby' | 'game';

export interface LobbyRow {
  id: string;
  name: string;
  color: number;
  host: boolean;
  ready: boolean;
  me: boolean;
  bot: boolean;
}

export interface LobbyView {
  practice: boolean;
  code: string;
  invite: string;
  rows: LobbyRow[];
  isHost: boolean;
  ready: boolean;
  canStart: boolean;
  /** 방에 들어온 직후의 기다림이 끝났는지 여부. */
  settled: boolean;
  settings: Settings;
  myColor: number;
  /** 다른 사람이 쓰고 있어서 고를 수 없는 색 번호. */
  takenColors: number[];
  /** AI를 더 넣을 수 있는 최대 수(6 − 사람 수). */
  maxBots: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  me: boolean;
  bot: boolean;
}

export interface MultiplayerHooks {
  onStage(stage: Stage): void;
}

/** 한 번 읽은 방의 모습입니다. */
interface Scan {
  /** 자리 순서로 앞에서 6명까지의 사람. */
  humans: PeerState[];
  mine: PeerState | null;
  /** 방에 있는 사람 전체의 수. */
  count: number;
  /** 내가 앞에서 6명 안에 드는지 여부. */
  seated: boolean;
  /** 방장으로 행동하는 사람. 아직 모르면 null. */
  host: PeerState | null;
  /** 내가 방장으로 행동하는지 여부. */
  hosting: boolean;
}

function validColor(color: number): boolean {
  return Number.isInteger(color) && color >= 0 && color < COLORS.length;
}

/** 방에 들어가고 나가며, 매 프레임 방을 읽어 Session을 진행하고 내 상태를 올립니다. 연습하기는 나만 있는 방으로 같은 경로를 씁니다. */
export class Multiplayer {
  stage: Stage = 'idle';
  error: string | null = null;
  code = '';
  private room: NamedRoomLike | null = null;
  private current: Session | null = null;
  private solo = false;
  private created = false;
  private name = '';
  private color = 0;
  private ready = false;
  private joinedAt = 0;
  /** stage가 game이 된 시각. 대기실에서는 아무도 보내지 않으므로 소식이 끊긴 시간은 이때부터 셉니다. */
  private gameSince = 0;
  /** 방에 들어온 직후에 한 번만 하는 확인(빈 방, 가득 찬 방)을 마쳤는지 여부. */
  private arrived = false;
  /** 보낼 때마다 올리는 번호. */
  private n = 0;
  private lastSent = 0;
  private sentAlive = false;
  /** 대기실에서 마지막으로 보낸 방장 정보. 마지막으로 보낸 것이 경기 중의 상태이면 null입니다. */
  private sentLobby: string | null = null;
  /** 방에 들어가는 시도마다 올리는 번호. 기다리는 사이에 나가기를 눌렀는지 알아냅니다. */
  private attempt = 0;

  constructor(
    private readonly lobby: LobbyLike | null,
    private readonly inviteBase: string,
    private readonly hooks: MultiplayerHooks,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  /** 지금 방의 경기. 방이 붙여 준 내 id를 알기 전에는 null입니다. */
  get session(): Session | null {
    return this.current;
  }

  /** 새 방을 만들어 들어갑니다. */
  create(name: string, color: number): Promise<void> {
    return this.enter(makeRoomCode(this.random), name, color, true);
  }

  /** 방 코드나 초대 링크로 방에 들어갑니다. */
  join(text: string, name: string, color: number): Promise<void> {
    const code = parseRoomCode(text);
    if (!code) {
      this.error = '방 코드가 올바르지 않습니다.';
      return Promise.resolve();
    }
    return this.enter(code, name, color, false);
  }

  /** 연습하기: 나만 있는 방에 들어간다. 통신이 없어도 된다. */
  practice(name: string, color: number): void {
    if (this.stage !== 'idle') return;
    this.attempt++;
    this.error = null;
    this.open(createLocalRoom(this.now), '', name, color, true, true);
    this.scan();
  }

  /** 방에서 나갑니다. message는 처음 화면에 보여 줄 안내입니다. */
  leave(message: string | null = null): void {
    this.attempt++;
    this.room?.leave().catch(() => undefined);
    this.room = null;
    this.current = null;
    this.solo = false;
    this.ready = false;
    this.code = '';
    this.error = message;
    this.setStage('idle');
  }

  /** 대기실에서 준비 여부를 바꿉니다. */
  toggleReady(): void {
    if (this.stage !== 'lobby') return;
    this.ready = !this.ready;
    this.patch({ ready: this.ready });
  }

  /** 대기실에서 내 색을 바꿉니다. 다른 사람이 쓰고 있는 색이면 아무 일도 하지 않습니다. */
  setColor(color: number): void {
    if (this.stage !== 'lobby' || !validColor(color) || color === this.color) return;
    if (this.scan().humans.some((p) => !p.me && p.color === color)) return;
    this.color = color;
    this.patch({ color });
  }

  /** 방장이 대기실에서 설정을 바꿉니다. 방장이 아니면 아무 일도 하지 않습니다. */
  setSettings(patch: Partial<Settings>): void {
    const session = this.current;
    if (this.stage !== 'lobby' || !session) return;
    const { hosting, humans } = this.scan();
    if (!hosting) return;
    session.setSettings(patch);
    session.setSettings({ bots: this.botCount(humans.length) });
  }

  /** 방장이 경기를 시작합니다. 방장이 아니거나 시작할 수 없으면 아무 일도 하지 않습니다. */
  start(): void {
    const session = this.current;
    if (this.stage !== 'lobby' || !session) return;
    const scan = this.scan();
    if (!this.startable(scan)) return;
    session.start(scan.humans.map((p) => p.peer));
    this.follow();
  }

  /** 방장이 경기를 끝내고 모두를 대기실로 돌려보냅니다. 방장이 아니면 아무 일도 하지 않습니다. */
  backToLobby(): void {
    if (this.stage !== 'game' || !this.current || !this.scan().hosting) return;
    this.current.backToLobby();
    this.follow();
  }

  /** 매 프레임. 방을 읽고, Session을 진행하고, 내 상태를 보낸다. */
  update(dtMs: number, input: Input): WorldEvent[] {
    if (!this.room || (this.stage !== 'lobby' && this.stage !== 'game')) return [];
    const scan = this.scan();
    const session = this.current;
    const { humans, mine, host, hosting } = scan;
    if (!mine || !session) return [];

    if (!this.arrived && this.settled()) {
      this.arrived = true;
      if (!this.created && scan.count === 1) {
        this.leave('방을 찾을 수 없습니다.');
        return [];
      }
      if (!scan.seated) {
        this.leave('방이 가득 찼습니다.');
        return [];
      }
    }

    if (scan.seated) {
      const color = resolveColor(humans.map((p) => ({ ...p, hosting: p.host !== null })), mine.peer);
      if (color !== this.color) {
        this.color = color;
        this.patch({ color });
      }
    }
    if (hosting && session.match.phase === 'lobby') {
      const bots = this.botCount(humans.length);
      if (bots !== session.match.settings.bots) session.setSettings({ bots });
    }

    const events = session.update(dtMs, input, {
      hosting,
      host: hosting ? null : (host?.host ?? null),
      peers: humans.filter((p) => !p.me),
    });
    this.follow();
    this.publish(session, hosting);
    return events;
  }

  /** 대기실 화면에 보여 줄 내용입니다. 대기실이 아니면 null입니다. */
  lobbyView(): LobbyView | null {
    if (this.stage !== 'lobby' || !this.room) return null;
    const scan = this.scan();
    const { humans, host } = scan;
    const settings = this.current?.match.settings ?? DEFAULT_SETTINGS;
    return {
      practice: this.solo,
      code: this.code,
      invite: this.code && this.inviteBase ? `${this.inviteBase}#${this.code}` : this.code,
      rows: this.infos(scan).map((info) => ({
        ...info,
        host: info.id === host?.peer,
        ready: info.bot || humans.some((p) => p.peer === info.id && p.ready),
      })),
      isHost: scan.hosting,
      ready: this.ready,
      canStart: this.startable(scan),
      settled: this.settled(),
      settings: { ...settings, bots: this.botCount(humans.length) },
      myColor: this.color,
      takenColors: humans.filter((p) => !p.me).map((p) => p.color),
      maxBots: MAX_PLAYERS - humans.length,
    };
  }

  /** 점수표와 이름표에 쓸 참가자 정보(사람과 AI). */
  players(): PlayerInfo[] {
    return this.room ? this.infos(this.scan()) : [];
  }

  /** 내가 지금 방장으로 행동하고 있는지 알려 줍니다. */
  isHost(): boolean {
    return this.scan().hosting;
  }

  private async enter(code: string, name: string, color: number, created: boolean): Promise<void> {
    if (this.stage !== 'idle') return;
    if (!this.lobby) {
      this.error = '이 환경에서는 같이 하기를 사용할 수 없습니다.';
      return;
    }
    const attempt = ++this.attempt;
    this.error = null;
    this.setStage('joining');
    let room: NamedRoomLike;
    try {
      room = await this.lobby.join(roomName(code));
    } catch {
      if (attempt === this.attempt) {
        this.error = '방에 들어가지 못했습니다. 잠시 후 다시 시도할 수 있습니다.';
        this.setStage('idle');
      }
      return;
    }
    if (attempt !== this.attempt) {
      room.leave().catch(() => undefined);
      return;
    }
    this.open(room, code, name, color, created, false);
  }

  /** 방에 들어온 직후의 상태를 만들고 내 presence를 올립니다. */
  private open(
    room: NamedRoomLike,
    code: string,
    name: string,
    color: number,
    created: boolean,
    solo: boolean,
  ): void {
    this.room = room;
    this.current = null;
    this.code = code;
    this.solo = solo;
    this.created = created;
    this.name = cleanName(name);
    this.color = validColor(color) ? color : 0;
    this.ready = false;
    this.joinedAt = this.now();
    this.arrived = false;
    this.n = 0;
    this.lastSent = 0;
    this.sentAlive = false;
    this.sentLobby = null;
    this.patch({
      name: this.name,
      color: this.color,
      ready: false,
      since: this.joinedAt,
      key: 0,
      n: 0,
      ball: null,
      host: null,
    });
    this.setStage('lobby');
  }

  /** 다른 사람의 상태가 다 도착했다고 볼 수 있는지 알려 줍니다. 방을 만든 사람과 연습 방은 기다리지 않습니다. */
  private settled(): boolean {
    return this.created || this.now() - this.joinedAt >= SETTLE_MS;
  }

  /** 경기 중에 소식이 오래 끊긴 사람인지 알려 줍니다. updatedAt은 그 사람의 상태를 마지막으로 받은 시각입니다. */
  private gone(updatedAt: number): boolean {
    return this.stage === 'game' && this.now() - Math.max(updatedAt, this.gameSince) > GONE_MS;
  }

  private setStage(stage: Stage): void {
    if (this.stage === stage) return;
    this.stage = stage;
    if (stage === 'game') this.gameSince = this.now();
    this.hooks.onStage(stage);
  }

  private patch(patch: Record<string, unknown>): void {
    this.room?.presence(patch).catch(() => undefined);
  }

  /**
   * 방을 읽습니다. 사람마다 한 번만 읽어서 그 결과를 방장 정보와 Frame에 함께 씁니다.
   * 방이 붙여 준 내 id를 처음 알게 되면 그 id로 Session을 만듭니다.
   */
  private scan(): Scan {
    const all: PeerState[] = [];
    let mine: PeerState | null = null;
    for (const peer of this.room?.peers() ?? []) {
      // 게시한 세션이 방에 들어와 있을 수 있는데, 사람이 아니므로 뺍니다.
      if (peer.kind === 'agent') continue;
      if (!peer.sameTab && this.gone(peer.updatedAt)) continue;
      let state = readPeer(peer.peer, peer.sameTab, peer.presence);
      if (peer.sameTab) {
        // 내가 올린 값은 방에 늦게 보일 수 있으므로 내가 알고 있는 값으로 봅니다.
        state = { ...state, name: this.name, color: this.color, ready: this.ready, since: this.joinedAt };
        mine = state;
      }
      all.push(state);
    }
    if (mine && !this.current) this.current = new Session(mine.peer, this.random);

    const humans = seatOrder(all).slice(0, MAX_PLAYERS);
    const seated = mine !== null && humans.includes(mine);
    const picked = pickHost(humans.map((p) => ({ ...p, hosting: p.host !== null })));
    const hosting = mine !== null && picked === mine.peer && this.settled();
    const host = hosting ? mine : (humans.find((p) => p.peer === picked && !p.me) ?? null);
    return { humans, mine, count: all.length, seated, host, hosting };
  }

  /** 지금 설정에서 실제로 넣을 AI 수입니다. 빈 자리보다 많을 수 없고, 연습 방에서는 1명 이상입니다. */
  private botCount(humans: number): number {
    const bots = this.current?.match.settings.bots ?? DEFAULT_SETTINGS.bots;
    return Math.max(this.solo ? 1 : 0, Math.min(MAX_PLAYERS - humans, bots));
  }

  /** 방장인 내가 경기를 시작할 수 있는지 알려 줍니다. 나를 뺀 모든 사람이 준비했고 사람과 AI를 합쳐 2명 이상이어야 합니다. */
  private startable({ humans, hosting }: Scan): boolean {
    return hosting && humans.every((p) => p.me || p.ready) && humans.length + this.botCount(humans.length) >= 2;
  }

  /**
   * 사람과 AI의 이름과 색입니다. AI는 사람이 쓰지 않는 색을 받습니다.
   * 경기 중에는 이번 라운드에 참가한 AI만 넣고, 구경하는 사람의 색은 AI가 쓸 수 있는 색으로 봅니다.
   */
  private infos({ humans }: Scan): PlayerInfo[] {
    const match = this.current?.match;
    const roster = match && match.phase !== 'lobby' ? match.roster : null;
    const count = roster ? roster.filter(isBot).length : this.botCount(humans.length);
    const playing = roster ? humans.filter((p) => roster.includes(p.peer)) : humans;
    const colors = botColors(
      playing.map((p) => p.color),
      count,
    );
    const ids = botIds(colors.length);
    return [
      ...humans.map((p) => ({ id: p.peer, name: p.name, color: p.color, me: p.me, bot: false })),
      ...colors.map((color, i) => ({ id: ids[i], name: `AI ${i + 1}`, color, me: false, bot: true })),
    ];
  }

  /** 단계를 Session이 따르고 있는 경기 상태에 맞춥니다. 경기에서 대기실로 돌아오면 준비를 풉니다. */
  private follow(): void {
    const lobby = !this.current || this.current.match.phase === 'lobby';
    if (lobby && this.stage === 'game' && this.ready) {
      this.ready = false;
      this.patch({ ready: false });
    }
    this.setStage(lobby ? 'lobby' : 'game');
  }

  /** 내 상태를 올립니다. 경기 중에는 일정한 간격으로(탈락은 바로), 대기실에서는 방장 정보가 바뀌었을 때만 보냅니다. */
  private publish(session: Session, hosting: boolean): void {
    const now = this.now();
    const { key, ball } = session.mine();
    const host = hosting ? encodeHost(session.hostWire()) : null;
    if (session.match.phase === 'lobby') {
      const lobby = JSON.stringify(host);
      if (lobby === this.sentLobby) return;
      this.sentLobby = lobby;
    } else {
      const alive = ball?.a ?? false;
      if (this.sentLobby === null && now - this.lastSent < SEND_INTERVAL && alive === this.sentAlive) return;
      this.sentLobby = null;
      this.sentAlive = alive;
    }
    this.lastSent = now;
    this.patch({ key, n: ++this.n, ball: ball && encodeBall(ball), host });
  }
}
