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
  KeyX: 'special',
  Space: 'special',
};

/** 터치 버튼입니다. 방향 버튼은 왼쪽 아래에 십자 모양으로 놓습니다. */
const PAD: readonly { key: Key; label: string; name: string }[] = [
  { key: 'up', label: '↑', name: '뛰기' },
  { key: 'left', label: '←', name: '왼쪽' },
  { key: 'down', label: '↓', name: '아래' },
  { key: 'right', label: '→', name: '오른쪽' },
];

/** Cmd, Ctrl, Alt, Shift 키 자체의 code입니다. */
const MODIFIER = /^(Meta|OS|Control|Alt|Shift)(Left|Right)$/;

/** 지금 누르고 있는 키와 터치 버튼을 기억합니다. 화면 요소를 쓰지 않습니다. */
export class InputState {
  /** 누르고 있는 키의 code입니다. */
  private readonly codes = new Set<string>();
  /** 버튼마다 그 버튼을 누르고 있는 손가락(pointer id)입니다. */
  private readonly pointers = new Map<Key, Set<number>>();

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

  /** 창이 가려지거나 초점을 잃었을 때 부릅니다. 그동안의 뗌은 알 수 없으므로 모두 뗀 것으로 봅니다. */
  reset(): void {
    this.codes.clear();
    this.pointers.clear();
  }

  read(): Input {
    const held = { left: false, right: false, up: false, down: false, special: false };
    for (const code of this.codes) held[KEYS[code]] = true;
    for (const [key, set] of this.pointers) if (set.size > 0) held[key] = true;
    return held;
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

/** 키보드(방향키, WASD, X/스페이스)와 터치 버튼의 입력을 읽습니다. */
export function attachInput(root: HTMLElement): {
  read(): Input;
  /** 터치 버튼을 보이거나 숨깁니다. special은 특수 동작 버튼에 쓸 글자입니다. 터치 화면이 아니면 항상 숨깁니다. */
  setTouchVisible(show: boolean, special?: string): void;
} {
  const state = new InputState();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

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
    // Tab으로 초점을 옮긴 버튼은 스페이스로 누를 수 있어야 하므로 그대로 둡니다. 경기 중이 아니면 이 입력은 쓰이지 않습니다.
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
    // 방향키와 스페이스가 화면을 움직이지 않게 합니다.
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => state.keyUp(event.code));
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
  const special = touchButton('special', '', 'touch-btn touch-special', '특수 동작');
  layer.append(pad, special);
  root.append(layer);

  return {
    read: () => state.read(),
    setTouchVisible(show, label = '') {
      const hidden = !(show && coarse);
      if (special.textContent !== label) special.textContent = label;
      if (layer.hidden === hidden) return;
      layer.hidden = hidden;
      if (hidden) {
        state.resetTouch();
        release();
      }
    },
  };
}
