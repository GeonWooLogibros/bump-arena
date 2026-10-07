/** 방과 대기실, 방장 선출, 상태 송수신. 방의 presence를 읽고 쓰기만 하며, 화면 요소는 사용하지 않습니다. */
import {
  COLORS,
  MAX_PLAYERS,
  botColors,
  cleanName,
  makeRoomCode,
  matchProgress,
  parseRoomCode,
  pickHost,
  resolveColor,
  roomName,
  seatOrder,
} from './game/lobby';
import { MAPS, RANDOM_MAP } from './game/maps';
import { TARGETS, readMode } from './game/modes';
import { DEFAULT_SETTINGS, botIds, isBot } from './game/round';
import type { Settings } from './game/round';
import { createLocalRoom } from './net/local-room';
import type { LobbyLike, NamedRoomLike } from './net/types';
import { encodeBall, encodeHost, readPeer } from './net/wire';
import type { PeerState } from './net/wire';
import type { Input, WorldEvent } from './physics/world';
import { MAX_FRAME_MS, Session } from './session';

/** 경기가 진행되는 동안 내 상태를 보내는 간격(밀리초)입니다. */
export const SEND_INTERVAL = 60;
/** 방에 들어온 직후 다른 사람의 상태가 다 도착하기까지 기다리는 시간(밀리초)입니다. 그동안은 방장 권한을 쓰지 않습니다. */
export const SETTLE_MS = 2000;
/** 경기 중에 상대의 소식이 이만큼 끊기면 나간 것으로 봅니다(밀리초). 대기실에서는 쓰지 않습니다. */
export const GONE_MS = 10000;

/** 화면이 보여 줄 단계입니다. 처음 화면, 방에 들어가는 중, 대기실, 경기입니다. */
export type Stage = 'idle' | 'joining' | 'lobby' | 'game';

/** 대기실 참가자 목록의 한 줄입니다. AI도 한 줄을 차지하며 항상 준비된 것으로 표시합니다. */
export interface LobbyRow {
  id: string;
  name: string;
  color: number;
  host: boolean;
  ready: boolean;
  me: boolean;
  bot: boolean;
}

/** 대기실 화면에 보여 줄 내용입니다. */
export interface LobbyView {
  practice: boolean;
  code: string;
  invite: string;
  rows: LobbyRow[];
  isHost: boolean;
  ready: boolean;
  canStart: boolean;
  /** 방에 들어온 직후의 기다림이 끝났는지 여부입니다. */
  settled: boolean;
  settings: Settings;
  myColor: number;
  /** 다른 사람이 쓰고 있어서 고를 수 없는 색 번호입니다. */
  takenColors: number[];
  /** AI를 넣을 수 있는 최대 수(6 − 사람 수)입니다. */
  maxBots: number;
}

/** 점수표와 이름표에 쓸 참가자 한 명(사람 또는 AI)의 정보입니다. */
export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  me: boolean;
  bot: boolean;
}

/** Multiplayer가 화면에 알리는 일입니다. onStage는 단계가 바뀔 때마다 부릅니다. */
export interface MultiplayerHooks {
  onStage(stage: Stage): void;
}

/** 한 번 읽은 방의 모습입니다. */
interface Scan {
  /** 자리 순서로 앞에서 6명까지의 사람입니다. */
  humans: PeerState[];
  mine: PeerState | null;
  /** 방에 있는 사람 전체의 수입니다. */
  count: number;
  /** 내가 앞에서 6명 안에 드는지 여부입니다. */
  seated: boolean;
  /** 방장으로 행동하는 사람입니다. 아직 모르면 null입니다. */
  host: PeerState | null;
  /** 내가 방장으로 행동하는지 여부입니다. */
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
  /** stage가 game이 된 시각입니다. 대기실에서는 아무도 보내지 않으므로 소식이 끊긴 시간은 이때부터 셉니다. */
  private gameSince = 0;
  /** 방에 들어온 직후에 한 번만 하는 확인(빈 방, 가득 찬 방)을 마쳤는지 여부입니다. */
  private arrived = false;
  /** 마지막으로 방을 읽었을 때 내가 방장으로 행동하고 있었는지 여부입니다. */
  private acting = false;
  /** 사람마다 마지막으로 본 번호(n)와 그 번호가 바뀐 것을 본 시각입니다. */
  private readonly heard = new Map<string, { n: number; at: number }>();
  /** 화면이 보이는지 여부입니다. 가려진 화면은 멈추므로 경기 중에는 방장을 맡지 않습니다. */
  private visible = true;
  /** 보낼 때마다 올리는 번호입니다. */
  private n = 0;
  private lastSent = 0;
  private sentAlive = false;
  /** 대기실에서 마지막으로 보낸 방장 정보입니다. 마지막으로 보낸 것이 경기 중의 상태이면 null입니다. */
  private sentLobby: string | null = null;
  /** 방에 들어가는 시도마다 올리는 번호입니다. 기다리는 사이에 나가기를 눌렀는지 알아냅니다. */
  private attempt = 0;

  constructor(
    private readonly lobby: LobbyLike | null,
    private readonly inviteBase: string,
    private readonly hooks: MultiplayerHooks,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  /** 지금 방의 경기입니다. 방이 붙여 준 내 id를 알기 전에는 null입니다. */
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

  /** 연습하기입니다. 나만 있는 방에 들어가며, 통신이 없어도 됩니다. */
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

  /** 방장이 대기실에서 설정을 바꿉니다. 방장이 아니면 아무 일도 하지 않고, 쓸 수 없는 값은 무시합니다. */
  setSettings(patch: Partial<Settings>): void {
    const session = this.current;
    if (this.stage !== 'lobby' || !session) return;
    const { hosting, humans } = this.scan();
    if (!hosting) return;
    const { mode, target, mapSetting, bots } = patch;
    const clean: Partial<Settings> = {};
    if (mode !== undefined && readMode(mode) === mode) clean.mode = mode;
    if (target !== undefined && TARGETS.some((t) => t === target)) clean.target = target;
    if (Number.isInteger(mapSetting) && mapSetting! >= RANDOM_MAP && mapSetting! < MAPS.length) {
      clean.mapSetting = mapSetting;
    }
    if (typeof bots === 'number' && Number.isFinite(bots)) clean.bots = Math.floor(bots);
    session.setSettings(clean);
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

  /**
   * 화면이 가려지거나 다시 보일 때 부릅니다. 경기 중에 가려지면 방장에서 바로 물러나서 다음 사람이 이어받게 합니다.
   * 다시 보이면 평소처럼 방장을 정하므로, 그사이에 이어받은 사람이 있으면 그 사람이 계속 방장입니다.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!this.room) return;
    if (visible) {
      this.patch({ away: null });
    } else if (this.stage === 'game') {
      this.acting = false;
      this.patch({ away: true, host: null });
    }
  }

  /** 매 프레임 부릅니다. 방을 읽고, Session을 진행하고, 내 상태를 보낸 뒤 그동안 일어난 일을 돌려줍니다. */
  update(dtMs: number, input: Input): WorldEvent[] {
    if (!this.room || (this.stage !== 'lobby' && this.stage !== 'game')) return [];
    if (dtMs > MAX_FRAME_MS) {
      // 내 화면이 멈춰 있던 동안에는 번호가 바뀌는 것을 볼 수 없었으므로, 모두의 소식을 지금 들은 것으로 봅니다.
      const now = this.now();
      for (const last of this.heard.values()) last.at = now;
    }
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

  /** 점수표와 이름표에 쓸 참가자 정보(사람과 AI)입니다. */
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
    this.acting = false;
    this.heard.clear();
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

  /**
   * 그 사람이 올리는 번호(n)가 바뀐 것을 마지막으로 본 시각입니다. 처음 본 사람은 지금으로 봅니다.
   * 방이 알려 주는 받은 시각(updatedAt)은 같은 값을 다시 받아도 새로워지는 방이 있어서 쓰지 않습니다.
   */
  private heardAt(peer: string, n: number): number {
    let last = this.heard.get(peer);
    if (!last || last.n !== n) {
      last = { n, at: this.now() };
      this.heard.set(peer, last);
    }
    return last.at;
  }

  /** 경기 중에 소식이 오래 끊긴 사람인지 알려 줍니다. heardAt은 그 사람의 새 소식을 마지막으로 본 시각입니다. */
  private gone(heardAt: number): boolean {
    return this.stage === 'game' && this.now() - Math.max(heardAt, this.gameSince) > GONE_MS;
  }

  /** 내가 방장을 맡지 않는다고 알려야 하는지 여부입니다. 화면이 가려진 채로 경기 중일 때입니다. */
  private away(): boolean {
    return !this.visible && this.stage === 'game';
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
      let state = readPeer(peer.peer, peer.sameTab, peer.presence);
      if (peer.sameTab) {
        // 내가 올린 값은 방에 늦게 보일 수 있으므로 내가 알고 있는 값으로 봅니다.
        const { name, color, ready } = this;
        state = { ...state, name, color, ready, since: this.joinedAt, away: this.away() };
        mine = state;
      } else if (this.gone(this.heardAt(peer.peer, state.n))) {
        continue;
      } else if (state.since <= 0) {
        // 방에는 보이지만 아직 자기 상태를 올리지 않은 사람입니다. 들어온 시각을 모르므로 올릴 때까지 참가자로 보지 않습니다.
        continue;
      }
      all.push(state);
    }
    if (mine && !this.current) this.current = new Session(mine.peer, this.random);

    const humans = seatOrder(all).slice(0, MAX_PLAYERS);
    const seated = mine !== null && humans.includes(mine);
    // 멈췄다가 돌아온 예전 방장이 경기를 되돌리지 않도록, 더 많이 진행된 경기를 올리는 사람을 방장으로 봅니다.
    // 내가 방장으로 행동하는 중이면, 방에 늦게 보이는 내 방장 정보가 아니라 지금 내 경기 상태로 견줍니다.
    const live = this.acting && this.current ? matchProgress(this.current.match) : null;
    // 화면이 가려져서 물러난 사람은 방장으로 뽑지 않습니다.
    const seats = humans
      .filter((p) => !p.away)
      .map((p) => {
        if (p.me && live !== null) return { ...p, hosting: true, progress: live };
        return { ...p, hosting: p.host !== null, progress: p.host ? matchProgress(p.host) : 0 };
      });
    const picked = pickHost(seats);
    const hosting = mine !== null && picked === mine.peer && this.settled();
    this.acting = hosting;
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
    const alive = ball?.a ?? false;
    const lobby = session.match.phase === 'lobby';
    if (!lobby && this.sentLobby === null && now - this.lastSent < SEND_INTERVAL && alive === this.sentAlive) return;
    const host = hosting ? encodeHost(session.hostWire()) : null;
    if (lobby) {
      const sent = JSON.stringify(host);
      if (sent === this.sentLobby) return;
      this.sentLobby = sent;
    } else {
      this.sentLobby = null;
      this.sentAlive = alive;
    }
    this.lastSent = now;
    this.patch({ key, n: ++this.n, ball: ball && encodeBall(ball), host, away: this.away() || null });
  }
}
