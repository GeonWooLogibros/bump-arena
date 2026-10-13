import './style.css';
import { createAudio } from './audio';
import { parseRoomCode } from './game/lobby';
import type { Mode } from './game/modes';
import { TUNING } from './game/modes';
import type { Phase } from './game/round';
import { attachInput } from './input';
import { Multiplayer } from './multiplayer';
import type { PlayerInfo, Stage } from './multiplayer';
import { connect } from './net/connect';
import type { Connection } from './net/connect';
import type { WorldEvent } from './physics/world';
import { Effects } from './render/effects';
import { Poses } from './render/pose';
import { GONE_NAME, SPARK_COLORS, ballColors, drawScene, fitView, scoreRows, toWorld } from './render/scene';
import type { SessionView } from './session';
import { browserStorage, loadProfile, saveProfile } from './storage';
import { createMenus } from './ui/menus';
import type { MenuView } from './ui/menus';

/** 초대 링크를 복사한 결과를 보여 주는 시간(밀리초). */
const COPIED_MS = 2000;
/** 터치 화면의 특수 동작 버튼에 쓰는 글자입니다. */
/** 튕기는 발판에서 튕길 때는 뛰는 소리를 이 빠르기로 높여서 냅니다. */
const BOUNCE_RATE = 1.7;
const SPECIAL_LABEL: Record<Mode, string> = { classic: '무거워지기', grapple: '줄', arrows: '화살' };

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app이 없습니다.');
const canvas = document.createElement('canvas');
app.append(canvas);
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D를 사용할 수 없습니다.');
const ctx = context;

const store = browserStorage();
const audio = createAudio();
const effects = new Effects();
const poses = new Poses();
// 움직임 줄이기를 켠 사람에게는 화면 흔들림과 멈춤을 쓰지 않습니다.
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)');
function setCalm(): void {
  effects.reduced = calm?.matches ?? false;
  poses.reduced = effects.reduced;
}
setCalm();
calm?.addEventListener?.('change', setCalm);
const input = attachInput(app);
/** 초대 링크로 열었으면 주소 뒤의 방 코드를 입력 칸에 미리 넣어 둡니다. */
const invitedCode = parseRoomCode(window.location.hash) ?? '';

let profile = loadProfile(store);
let width = 0;
let height = 0;
/** 초대 링크 복사의 결과와 그 시각입니다. */
let copy: { ok: boolean; at: number } | null = null;
/** 소리를 한 번씩만 내기 위해 기억하는 지난 프레임의 경기 단계와 카운트다운 숫자입니다. */
let lastPhase: Phase = 'lobby';
let lastCount = 0;

function onStage(stage: Stage): void {
  if (stage === 'game') return;
  effects.clear();
  poses.clear();
}

/** 연결되기 전에도 연습하기를 할 수 있게, 통신 없이 먼저 만들어 둡니다. */
let mp = new Multiplayer(null, '', { onStage });
let connection: Connection | null = null;
/** 연결은 됐지만 아직 mp를 바꾸지 못했는지 여부. 연습 방에 들어가 있는 동안에는 바꾸지 않습니다. */
let pending = false;

function adopt(): void {
  if (!pending || !connection || mp.stage !== 'idle') return;
  pending = false;
  const next = new Multiplayer(connection.lobby, connection.inviteBase, { onStage });
  // 방에서 나오며 남긴 안내가 바꾸는 사이에 사라지지 않게 옮깁니다.
  next.error = mp.error;
  mp = next;
}

void connect()
  // 연결하다가 오류가 나면 연습하기만 할 수 있는 상태로 둡니다.
  .catch((): Connection => ({ lobby: null, inviteBase: '', via: 'none' }))
  .then((result) => {
    connection = result;
    pending = result.lobby !== null;
    adopt();
  });

if (import.meta.env.DEV) {
  // 개발 중 확인용입니다. mp는 연결된 뒤에 바뀌므로 읽을 때마다 지금 것을 돌려줍니다.
  Object.defineProperty(window, '__game', {
    configurable: true,
    value: {
      get mp() {
        return mp;
      },
    },
  });
}

// 브라우저는 사용자가 누른 뒤에만 소리를 낼 수 있습니다. iOS Safari는 터치의 pointerdown을 누른 것으로 치지 않습니다.
for (const type of ['pointerdown', 'pointerup', 'click', 'keydown'] as const) {
  window.addEventListener(type, () => audio.unlock());
}
// 가려진 화면은 브라우저가 멈추므로, 경기 중이면 방장을 다음 사람에게 넘깁니다.
document.addEventListener('visibilitychange', () => mp.setVisible(!document.hidden));
app.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('.menus button')) audio.play('click', 0.5);
});

function remember(name: string, color: number): void {
  profile = { name, color };
  saveProfile(store, profile);
}

const menus = createMenus(app, {
  practice: (name, color) => {
    adopt();
    remember(name, color);
    mp.practice(name, color);
  },
  create: (name, color) => {
    adopt();
    remember(name, color);
    void mp.create(name, color);
  },
  join: (code, name, color) => {
    adopt();
    remember(name, color);
    void mp.join(code, name, color);
  },
  pickColor: (color) => remember(profile.name, color),
  color: (color) => {
    mp.setColor(color);
    // 다른 사람이 먼저 쓰고 있어서 바꾸지 못했으면 저장하지 않습니다.
    if (mp.lobbyView()?.myColor === color) remember(profile.name, color);
  },
  settings: (patch) => mp.setSettings(patch),
  ready: () => mp.toggleReady(),
  start: () => mp.start(),
  copy: (invite) => {
    // 클립보드를 쓸 수 없는 환경에서는 화면의 방 코드를 직접 알려 주면 됩니다.
    const done = (ok: boolean): void => {
      copy = { ok, at: performance.now() };
    };
    try {
      navigator.clipboard.writeText(invite).then(
        () => done(true),
        () => done(false),
      );
    } catch {
      done(false);
    }
  },
  lobby: () => mp.backToLobby(),
  sound: () => audio.toggle(),
  leave: () => mp.leave(),
});

/** 이번 프레임에 일어난 일을 소리와 효과로 바꿉니다. */
function react(events: readonly WorldEvent[], view: SessionView | null, players: readonly PlayerInfo[]): void {
  for (const event of events) {
    if (event.type === 'hit') {
      const { strength, x, y, nx, ny, a, b } = event;
      // 센 충돌일수록 낮은 소리가 납니다.
      if (event.bouncy) audio.play('jump', 0.3 + 0.5 * strength, BOUNCE_RATE);
      else audio.play('hit', 0.2 + 0.8 * strength, 1.12 - 0.24 * strength);
      effects.hit(strength);
      effects.spark(x, y, nx, ny, strength, SPARK_COLORS[event.bouncy ? 'bouncy' : a && b ? 'ball' : 'ground']);
      if (a) poses.squash(a, nx, ny, strength);
      if (b) poses.squash(b, -nx, -ny, strength);
      // 발판은 공이 누른 쪽으로 눌립니다.
      if (event.bouncy && view) poses.press(view.shapes, x, y, a ? nx : -nx, a ? ny : -ny, strength);
      // 조작이 밀려 보이지 않게, 내 공이 부딪쳤을 때만 멈춥니다. 구경 중에는 어느 공이든 멈춥니다.
      if (a && b && view && (view.watching || a === view.me || b === view.me)) poses.freeze(strength);
    } else if (event.type === 'out') {
      audio.play('out', 0.9);
      effects.out(event.x, event.y, ballColors(players, event.id).fill);
    } else if (event.type === 'jump') {
      audio.play('jump', event.id === view?.me ? 0.45 : 0.2);
    } else if (event.type === 'rope') {
      audio.play('rope', 0.6);
    } else if (event.type === 'shoot') {
      audio.play('shoot', 0.8);
    } else {
      audio.play('stick', 0.5);
    }
  }

  const phase: Phase = view?.match.phase ?? 'lobby';
  const count = view && phase === 'countdown' ? Math.ceil((TUNING.countdownMs - view.match.ms) / 1000) : 0;
  if (count > 0 && count !== lastCount) audio.play('tick');
  if (phase !== lastPhase) {
    if (phase === 'play') {
      if (lastPhase === 'countdown') audio.play('go', 0.8);
      // 버튼에 초점이 남아 있으면 뛰려고 누른 스페이스가 그 버튼을 누르므로 초점을 풉니다.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } else if (phase === 'roundEnd' && view?.match.winner) {
      // 경기를 끝내는 승리이면 크게 냅니다. 이어지는 matchEnd에서는 다시 내지 않습니다.
      const { winner, scores, settings } = view.match;
      audio.play('win', (scores[winner] ?? 0) >= settings.target ? 1 : 0.6);
    } else if (phase === 'matchEnd' && lastPhase !== 'roundEnd') {
      audio.play('win');
    }
  }
  lastPhase = phase;
  lastCount = count;
}

function menuView(now: number, view: SessionView | null, players: PlayerInfo[]): MenuView {
  if (mp.stage === 'lobby') {
    const lobby = mp.lobbyView();
    const shown = copy !== null && now - copy.at < COPIED_MS ? copy : null;
    if (lobby) return { kind: 'lobby', view: lobby, copy: shown ? (shown.ok ? 'done' : 'failed') : 'idle' };
  }
  if (mp.stage === 'game') {
    if (view?.match.phase !== 'matchEnd') return { kind: 'play', muted: audio.muted };
    const rows = scoreRows(view, players);
    const { winner } = view.match;
    return {
      kind: 'result',
      winner: winner === null ? null : (rows.find((row) => row.id === winner)?.name ?? GONE_NAME),
      rows: rows
        .map((row) => ({ name: row.name, fill: row.colors.fill, edge: row.colors.edge, score: row.score, me: row.me }))
        .sort((a, b) => b.score - a.score),
      isHost: mp.isHost(),
    };
  }
  return {
    kind: 'title',
    name: profile.name,
    color: profile.color,
    code: invitedCode,
    multi: !connection ? 'connecting' : connection.lobby ? 'ready' : 'none',
    busy: mp.stage === 'joining',
    error: mp.error,
  };
}

function resize(): void {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (width !== window.innerWidth || height !== window.innerHeight || canvas.width !== Math.round(width * ratio)) {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

let last = performance.now();

function frame(time: number): void {
  // 한 프레임에서 오류가 나도 게임이 멈추지 않게 다음 프레임을 먼저 예약합니다.
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, time - last);
  last = time;
  try {
    resize();
    adopt();

    // 그릴 때와 같은 변환으로 마우스 위치를 세계 좌표로 바꿉니다.
    const pointer = input.pointer();
    const aim = pointer && toWorld(fitView(width, height), pointer[0], pointer[1]);
    const events = mp.update(elapsed, input.read(), aim);
    const view = mp.stage === 'game' ? (mp.session?.view() ?? null) : null;
    const players = mp.players();
    react(events, view, players);
    const seconds = Math.min(elapsed, 100) / 1000;
    effects.update(seconds);
    poses.update(view, seconds);

    const playing = view !== null && !view.watching && view.match.phase !== 'matchEnd';
    input.setPlaying(playing);
    input.setTouchVisible(playing, view ? SPECIAL_LABEL[view.match.settings.mode] : '');
    drawScene(ctx, { width, height, view, players, effects, poses, time, hints: !input.touch, aim });
    menus.show(menuView(time, view, players));
  } catch (error) {
    console.error(error);
  }
}

requestAnimationFrame(frame);
