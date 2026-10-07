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

function none(): Input {
  return { left: false, right: false, up: false, down: false, special: false };
}

/** 키보드(방향키, WASD, X/스페이스)와 터치 버튼의 입력을 읽습니다. */
export function attachInput(root: HTMLElement): {
  read(): Input;
  /** 터치 버튼을 보이거나 숨깁니다. special은 특수 동작 버튼에 쓸 글자입니다. 터치 화면이 아니면 항상 숨깁니다. */
  setTouchVisible(show: boolean, special?: string): void;
} {
  const keys = none();
  const touch = none();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  const typing = (event: KeyboardEvent): boolean =>
    event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement;

  window.addEventListener('keydown', (event) => {
    const key = KEYS[event.code];
    if (!key || typing(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    keys[key] = true;
    // 방향키와 스페이스가 화면을 움직이지 않게 합니다.
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const key = KEYS[event.code];
    if (key) keys[key] = false;
  });
  window.addEventListener('blur', () => {
    Object.assign(keys, none());
    Object.assign(touch, none());
  });

  const layer = document.createElement('div');
  layer.className = 'touch';
  layer.hidden = true;

  function touchButton(key: Key, label: string, className: string, name: string): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = label;
    node.setAttribute('aria-label', name);
    // 누른 채로 글자 칸에 초점이 넘어가거나 길게 눌러 메뉴가 뜨지 않게 합니다.
    node.tabIndex = -1;
    node.addEventListener('contextmenu', (event) => event.preventDefault());
    node.addEventListener('pointerdown', (event) => {
      touch[key] = true;
      node.classList.add('held');
      event.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      node.addEventListener(type, () => {
        touch[key] = false;
        node.classList.remove('held');
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
    read: () => ({
      left: keys.left || touch.left,
      right: keys.right || touch.right,
      up: keys.up || touch.up,
      down: keys.down || touch.down,
      special: keys.special || touch.special,
    }),
    setTouchVisible(show, label = '') {
      const hidden = !(show && coarse);
      if (special.textContent !== label) special.textContent = label;
      if (layer.hidden === hidden) return;
      layer.hidden = hidden;
      if (hidden) {
        Object.assign(touch, none());
        for (const node of layer.querySelectorAll('.held')) node.classList.remove('held');
      }
    },
  };
}
