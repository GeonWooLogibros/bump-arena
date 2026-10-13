import type { Input } from './physics/world';

type Key = keyof Input;

/** 자판의 위치로 읽습니다. 한글 입력 상태에서도 같은 키가 같은 동작을 합니다. */
const KEYS: Record<string, Key> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'up',
  KeyX: 'heavy',
  ShiftLeft: 'heavy',
  ShiftRight: 'heavy',
  KeyZ: 'special',
};

/** 터치 버튼입니다. 방향 버튼은 왼쪽 아래에 십자 모양으로 놓습니다. */
const PAD: readonly { key: Key; label: string; name: string }[] = [
  { key: 'up', label: '↑', name: '뛰기' },
  { key: 'left', label: '←', name: '왼쪽' },
  { key: 'down', label: '↓', name: '아래' },
  { key: 'right', label: '→', name: '오른쪽' },
];

/** 마우스를 이만큼(밀리초) 움직이지 않았으면 마우스로 겨누지 않는 것으로 봅니다. 키보드만 쓰는 사람의 화살이 가만히 둔 커서 쪽으로 나가지 않게 합니다. */
export const MOUSE_IDLE_MS = 3000;

/** Cmd, Ctrl, Alt 키 자체의 code입니다. Shift는 무거워지기에 쓰므로 여기에 넣지 않습니다. */
const MODIFIER = /^(Meta|OS|Control|Alt)(Left|Right)$/;

/**
 * 지금 누르고 있는 키, 터치 버튼, 마우스를 기억합니다. 화면 요소를 쓰지 않습니다.
 * 겨누는 방향은 마지막으로 쓴 장치가 정합니다. 마우스를 움직이거나 누르면 마우스로 겨누고,
 * 키보드의 특수 동작 키를 누르고 있는 동안 좌우 키를 새로 누르면 키보드로 겨눕니다. 그 밖의 좌우 키는 이동이므로 겨누는 장치를 바꾸지 않습니다.
 */
export class InputState {
  /** 누르고 있는 키의 code입니다. */
  private readonly codes = new Set<string>();
  /** 버튼마다 그 버튼을 누르고 있는 손가락(pointer id)입니다. */
  private readonly pointers = new Map<Key, Set<number>>();
  /** 마우스의 마지막 위치(화면 px)입니다. 아직 움직이지 않았거나 창을 벗어났으면 null입니다. */
  private mouse: readonly [number, number] | null = null;
  /** 마우스를 마지막으로 움직이거나 누른 시각(밀리초)입니다. */
  private movedAt = 0;
  /** 마우스 왼쪽 버튼을 누르고 있는지 여부. */
  private button = false;
  /** 마우스 오른쪽 버튼을 누르고 있는지 여부. */
  private side = false;
  /** 키보드로 겨누고 있는지 여부. */
  private keyAim = false;

  /**
   * 키를 눌렀을 때 부릅니다. 게임이 쓴 키이면 true를 돌려줍니다.
   * meta는 Cmd를, chord는 Ctrl이나 Alt를 함께 누르고 있는지입니다. 함께 누른 키는 브라우저의 단축키이므로 게임이 쓰지 않습니다.
   */
  keyDown(code: string, meta: boolean, chord = false): boolean {
    if (MODIFIER.test(code)) return false;
    if (meta) {
      // macOS는 Cmd와 함께 누른 키의 뗌을 알려 주지 않으므로, 누르고 있던 키를 모두 뗀 것으로 봅니다.
      this.codes.clear();
      return false;
    }
    if (chord || !(code in KEYS)) return false;
    // 누르고 있는 키는 같은 keydown이 되풀이되어 들어오므로 새로 누른 키만 봅니다.
    const turning = KEYS[code] === 'left' || KEYS[code] === 'right';
    if (!this.codes.has(code) && turning && this.keySpecial()) this.keyAim = true;
    this.codes.add(code);
    return true;
  }

  keyUp(code: string): void {
    this.codes.delete(code);
  }

  touchDown(key: Key, pointer: number): void {
    const set = this.pointers.get(key) ?? new Set<number>();
    set.add(pointer);
    this.pointers.set(key, set);
  }

  touchUp(key: Key, pointer: number): void {
    this.pointers.get(key)?.delete(pointer);
  }

  /** 터치 버튼을 하나라도 누르고 있는지 알려 줍니다. */
  touching(key: Key): boolean {
    return (this.pointers.get(key)?.size ?? 0) > 0;
  }

  resetTouch(): void {
    this.pointers.clear();
  }

  /** 마우스를 움직였을 때 부릅니다. now는 지금 시각(밀리초)입니다. */
  mouseMove(x: number, y: number, now = 0): void {
    this.mouse = [x, y];
    this.movedAt = now;
    this.keyAim = false;
  }

  /** 마우스 왼쪽 버튼을 눌렀을 때 부릅니다. 누르는 동안 특수 동작입니다. */
  mouseDown(x: number, y: number, now = 0): void {
    this.mouseMove(x, y, now);
    this.button = true;
  }

  mouseUp(): void {
    this.button = false;
  }

  /** 마우스 오른쪽 버튼을 누르거나 뗐을 때 부릅니다. 누르는 동안 무거워지기입니다. */
  mouseHeavy(down: boolean): void {
    this.side = down;
  }

  /** 마우스가 창을 벗어났을 때 부릅니다. 버튼을 누른 채로 벗어났으면 마지막 위치로 계속 겨눕니다. */
  mouseLeave(): void {
    if (!this.button) this.mouse = null;
  }

  /**
   * 마우스로 겨누고 있으면 그 위치(화면 px)이고, 키보드로 겨누고 있으면 null입니다.
   * pressed이면 왼쪽 버튼을 누르고 있을 때만 위치를 돌려줍니다. 키보드로 건 줄이 가만히 둔 마우스 쪽으로 가지 않게 하는 데 씁니다.
   * now는 지금 시각(밀리초)입니다. 마우스를 MOUSE_IDLE_MS 동안 움직이지 않았고 왼쪽 버튼도 누르고 있지 않으면 키보드로 겨누는 것으로 봅니다.
   */
  pointer(pressed = false, now = 0): readonly [number, number] | null {
    if (!this.button && (pressed || now - this.movedAt >= MOUSE_IDLE_MS)) return null;
    return this.keyAim ? null : this.mouse;
  }

  /** 마우스 버튼을 모두 뗀 것으로 합니다. 뗌을 알 수 없게 되었을 때 부릅니다. */
  mouseReset(): void {
    this.button = false;
    this.side = false;
  }

  /** 창이 가려지거나 초점을 잃었을 때 부릅니다. 그동안의 뗌은 알 수 없으므로 모두 뗀 것으로 봅니다. */
  reset(): void {
    this.codes.clear();
    this.pointers.clear();
    this.mouseReset();
  }

  read(): Input {
    const held = { left: false, right: false, up: false, down: false, heavy: this.side, special: this.button };
    for (const code of this.codes) held[KEYS[code]] = true;
    for (const [key, set] of this.pointers) if (set.size > 0) held[key] = true;
    return held;
  }

  /** 키보드의 특수 동작 키를 누르고 있는지 알려 줍니다. */
  private keySpecial(): boolean {
    for (const code of this.codes) if (KEYS[code] === 'special') return true;
    return false;
  }
}

/** 글자를 입력하는 칸에 초점이 있는지 알려 줍니다. 그동안에는 키를 게임 조작으로 읽지 않습니다. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** 키보드(방향키, WASD, 스페이스, X와 Shift, Z), 마우스, 터치 버튼의 입력을 읽습니다. */
export function attachInput(root: HTMLElement): {
  read(): Input;
  /** 마우스로 겨누고 있으면 그 위치(화면 px)이고, 아니면 null입니다. pressed이면 왼쪽 버튼을 누르고 있을 때만 돌려줍니다. */
  pointer(pressed?: boolean): readonly [number, number] | null;
  /** 터치 버튼을 쓰는 기기인지 여부. 그런 기기에서는 키보드 조작 안내를 보여 주지 않습니다. */
  readonly touch: boolean;
  /** 경기에서 공을 조작하고 있는지 알려 줍니다. 그동안에는 스페이스가 초점이 있는 버튼을 누르지 않습니다. */
  setPlaying(playing: boolean): void;
  /** 터치 버튼을 보이거나 숨깁니다. special은 특수 동작 버튼에 쓸 글자이고, 비어 있으면 그 버튼을 숨깁니다. 터치 화면이 아니면 항상 숨깁니다. */
  setTouchVisible(show: boolean, special?: string): void;
} {
  const state = new InputState();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  let playing = false;

  const layer = document.createElement('div');
  layer.className = 'touch';
  layer.hidden = true;

  const release = (): void => {
    for (const node of layer.querySelectorAll('.held')) node.classList.remove('held');
  };
  const reset = (): void => {
    state.reset();
    release();
  };

  window.addEventListener('keydown', (event) => {
    if (typing(event.target)) return;
    if (!state.keyDown(event.code, event.metaKey, event.ctrlKey || event.altKey)) return;
    // 메뉴에서는 Tab으로 초점을 옮긴 버튼을 스페이스로 누를 수 있어야 하므로 그대로 둡니다. 경기 중이 아니면 이 입력은 쓰이지 않습니다.
    if (!playing && event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
    // 방향키와 스페이스가 화면을 움직이거나 Shift와 방향키가 글자를 고르지 않게 합니다.
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    state.keyUp(event.code);
    // 버튼은 스페이스를 뗄 때 눌리므로, 경기 중에는 뗄 때에도 막습니다.
    if (playing && event.code === 'Space' && event.target instanceof HTMLButtonElement) event.preventDefault();
  });
  // 터치는 화면의 버튼으로만 조작하므로 마우스만 읽습니다.
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    state.mouseMove(event.clientX, event.clientY, performance.now());
    // 한 버튼을 누른 채로 다른 버튼을 누르면 pointerdown이 아니라 pointermove로 옵니다.
    press(event);
    // 창 밖에서 버튼을 떼면 뗌을 알 수 없으므로, 움직일 때마다 버튼이 아직 눌려 있는지 봅니다.
    if ((event.buttons & 1) === 0) state.mouseUp();
    if ((event.buttons & 2) === 0) state.mouseHeavy(false);
  });
  /** 이 이벤트로 새로 눌린 마우스 버튼을 읽습니다. 왼쪽은 특수 동작이고 오른쪽은 무거워지기입니다. */
  function press(event: PointerEvent): void {
    // 메뉴의 버튼을 누르는 클릭은 조작으로 치지 않도록, 경기 중에 경기 화면을 누른 것만 봅니다.
    if (!playing || !(event.target instanceof HTMLCanvasElement)) return;
    if (event.button === 0 && (event.buttons & 1) !== 0) state.mouseDown(event.clientX, event.clientY, performance.now());
    else if (event.button === 2 && (event.buttons & 2) !== 0) state.mouseHeavy(true);
    else return;
    // 누른 채로 끌어도 화면의 글자가 골라지지 않게 합니다.
    event.preventDefault();
  }
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') press(event);
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, (event) => {
      if (event.pointerType !== 'mouse') return;
      if (event.button === 0) state.mouseUp();
      if (event.button === 2) state.mouseHeavy(false);
    });
  }
  document.documentElement.addEventListener('mouseleave', () => state.mouseLeave());
  window.addEventListener('contextmenu', (event) => {
    if (playing && event.target instanceof HTMLCanvasElement) event.preventDefault();
    // 메뉴가 뜨면 그 뒤의 버튼 뗌을 알 수 없으므로 누르고 있던 버튼을 뗀 것으로 봅니다.
    else state.mouseReset();
  });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });

  function touchButton(key: Key, label: string, className: string, name: string): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.setAttribute('aria-label', name);
    // 누른 채로 초점이 넘어오거나 길게 눌러 메뉴가 뜨지 않게 합니다.
    node.tabIndex = -1;
    node.addEventListener('contextmenu', (event) => event.preventDefault());
    node.addEventListener('pointerdown', (event) => {
      state.touchDown(key, event.pointerId);
      node.classList.add('held');
      event.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      node.addEventListener(type, (event) => {
        state.touchUp(key, event.pointerId);
        node.classList.toggle('held', state.touching(key));
      });
    }
    return node;
  }

  const pad = document.createElement('div');
  pad.className = 'touch-pad';
  for (const { key, label, name } of PAD) pad.append(touchButton(key, label, `touch-btn touch-${key}`, name));
  const actions = document.createElement('div');
  actions.className = 'touch-actions';
  const heavy = touchButton('heavy', '무겁게', 'touch-btn touch-heavy', '무거워지기');
  const special = touchButton('special', '', 'touch-btn touch-special', '특수 동작');
  actions.append(heavy, special);
  layer.append(pad, actions);
  root.append(layer);

  return {
    read: () => state.read(),
    pointer: (pressed) => state.pointer(pressed, performance.now()),
    touch: coarse,
    setPlaying(value) {
      playing = value;
    },
    setTouchVisible(show, label = '') {
      const hidden = !(show && coarse);
      if (special.textContent !== label) special.textContent = label;
      if (special.hidden !== (label === '')) {
        special.hidden = label === '';
        // 숨긴 버튼은 뗌을 알려 주지 않으므로 누르고 있던 손가락을 지웁니다.
        state.resetTouch();
        release();
      }
      if (layer.hidden === hidden) return;
      layer.hidden = hidden;
      if (hidden) {
        state.resetTouch();
        release();
      }
    },
  };
}
