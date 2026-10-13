import { describe, expect, it } from 'vitest';
import { InputState } from '../src/input';

const NONE = { left: false, right: false, up: false, down: false, heavy: false, special: false };

describe('InputState 키보드', () => {
  it('방향키, WASD, X, Z를 읽는다', () => {
    const state = new InputState();
    expect(state.read()).toEqual(NONE);
    for (const code of ['KeyA', 'ArrowRight', 'KeyW', 'ArrowDown', 'KeyX', 'KeyZ']) {
      expect(state.keyDown(code, false)).toBe(true);
    }
    expect(state.read()).toEqual({ left: true, right: true, up: true, down: true, heavy: true, special: true });
    state.keyUp('KeyX');
    expect(state.read()).toMatchObject({ heavy: false, special: true });
    state.keyUp('KeyZ');
    expect(state.read().special).toBe(false);
  });

  it.each(['ArrowDown', 'KeyS'])('%s는 아래로 힘 주기다', (code) => {
    const state = new InputState();
    expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, down: true });
  });

  it.each(['Space', 'ArrowUp', 'KeyW'])('%s는 뛰기다', (code) => {
    const state = new InputState();
    expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, up: true });
    state.keyUp(code);
    expect(state.read()).toEqual(NONE);
  });

  it.each(['KeyX', 'ShiftLeft', 'ShiftRight'])('%s는 무거워지기다', (code) => {
    const state = new InputState();
    expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, heavy: true });
    state.keyUp(code);
    expect(state.read()).toEqual(NONE);
  });

  it('Z는 특수 동작이다', () => {
    const state = new InputState();
    expect(state.keyDown('KeyZ', false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, special: true });
    state.keyUp('KeyZ');
    expect(state.read()).toEqual(NONE);
  });

  it('Shift를 누른 채로 방향키와 스페이스를 눌러도 모두 읽는다', () => {
    const state = new InputState();
    state.keyDown('ShiftLeft', false);
    expect(state.keyDown('ArrowLeft', false)).toBe(true);
    expect(state.keyDown('Space', false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, left: true, up: true, heavy: true });
  });

  it('Shift를 눌러도 누르고 있던 키가 떼어지지 않는다', () => {
    const state = new InputState();
    state.keyDown('ArrowRight', false);
    state.keyDown('Space', false);
    state.keyDown('ShiftRight', false);
    expect(state.read()).toEqual({ ...NONE, right: true, up: true, heavy: true });
    state.keyUp('ShiftRight');
    expect(state.read()).toEqual({ ...NONE, right: true, up: true });
  });

  it('양쪽 Shift 가운데 하나만 떼면 계속 누른 것으로 본다', () => {
    const state = new InputState();
    state.keyDown('ShiftLeft', false);
    state.keyDown('ShiftRight', false);
    state.keyUp('ShiftLeft');
    expect(state.read().heavy).toBe(true);
  });

  it('게임에 쓰지 않는 키는 처리하지 않는다', () => {
    const state = new InputState();
    expect(state.keyDown('KeyQ', false)).toBe(false);
    expect(state.read()).toEqual(NONE);
  });

  it('같은 동작의 키 두 개 가운데 하나만 떼면 계속 누른 것으로 본다', () => {
    const state = new InputState();
    state.keyDown('ArrowLeft', false);
    state.keyDown('KeyA', false);
    state.keyUp('ArrowLeft');
    expect(state.read().left).toBe(true);
    state.keyUp('KeyA');
    expect(state.read().left).toBe(false);
  });

  it('Cmd와 함께 다른 키를 누르면 누르고 있던 키를 모두 뗀다', () => {
    const state = new InputState();
    state.keyDown('ArrowLeft', false);
    state.keyDown('Space', false);
    expect(state.keyDown('KeyA', true)).toBe(false);
    expect(state.read()).toEqual(NONE);
  });

  it('Cmd, Ctrl, Alt 키만 눌러서는 누르고 있던 키가 떼어지지 않는다', () => {
    const state = new InputState();
    state.keyDown('ArrowLeft', false);
    state.keyDown('Space', false);
    expect(state.keyDown('MetaLeft', true)).toBe(false);
    expect(state.keyDown('ControlLeft', false, true)).toBe(false);
    expect(state.keyDown('AltRight', false, true)).toBe(false);
    expect(state.read()).toEqual({ ...NONE, left: true, up: true });
  });

  it('Ctrl이나 Alt와 함께 누른 키는 게임이 쓰지 않고, 누르고 있던 키는 그대로다', () => {
    const state = new InputState();
    state.keyDown('ArrowLeft', false);
    expect(state.keyDown('KeyD', false, true)).toBe(false);
    expect(state.read()).toEqual({ ...NONE, left: true });
  });

  it('reset은 키와 터치를 모두 뗀다', () => {
    const state = new InputState();
    state.keyDown('ArrowUp', false);
    state.touchDown('special', 1);
    state.touchDown('heavy', 2);
    state.reset();
    expect(state.read()).toEqual(NONE);
    expect(state.touching('special')).toBe(false);
    expect(state.touching('heavy')).toBe(false);
  });
});

describe('InputState 터치', () => {
  it('한 버튼을 두 손가락으로 누르면 둘 다 뗄 때까지 누른 것으로 본다', () => {
    const state = new InputState();
    state.touchDown('special', 1);
    state.touchDown('special', 2);
    state.touchUp('special', 1);
    expect(state.read().special).toBe(true);
    expect(state.touching('special')).toBe(true);
    state.touchUp('special', 2);
    expect(state.read().special).toBe(false);
    expect(state.touching('special')).toBe(false);
  });

  it('무거워지기 버튼과 특수 동작 버튼을 따로 읽는다', () => {
    const state = new InputState();
    state.touchDown('heavy', 1);
    expect(state.read()).toEqual({ ...NONE, heavy: true });
    state.touchDown('special', 2);
    state.touchUp('heavy', 1);
    expect(state.read()).toEqual({ ...NONE, special: true });
  });

  it('같은 손가락의 뗌이 여러 번 와도 다른 버튼에 영향이 없다', () => {
    const state = new InputState();
    state.touchDown('left', 1);
    state.touchDown('up', 2);
    state.touchUp('left', 1);
    state.touchUp('left', 1);
    state.touchUp('left', 2);
    expect(state.read()).toEqual({ ...NONE, up: true });
  });

  it('키보드와 터치 가운데 하나라도 누르고 있으면 누른 것이다', () => {
    const state = new InputState();
    state.keyDown('ArrowRight', false);
    state.touchDown('right', 5);
    state.keyUp('ArrowRight');
    expect(state.read().right).toBe(true);
    state.resetTouch();
    expect(state.read().right).toBe(false);
  });
});

describe('InputState 마우스', () => {
  it('왼쪽 버튼은 특수 동작이다', () => {
    const state = new InputState();
    state.mouseDown(100, 50);
    expect(state.read()).toEqual({ ...NONE, special: true });
    state.mouseUp();
    expect(state.read()).toEqual(NONE);
  });

  it('오른쪽 버튼은 무거워지기다', () => {
    const state = new InputState();
    state.mouseHeavy(true);
    expect(state.read()).toEqual({ ...NONE, heavy: true });
    state.mouseDown(100, 50);
    expect(state.read()).toEqual({ ...NONE, heavy: true, special: true });
    state.mouseHeavy(false);
    expect(state.read()).toEqual({ ...NONE, special: true });
  });

  it('마우스를 움직이기 전에는 겨누는 위치가 없다', () => {
    const state = new InputState();
    expect(state.pointer()).toBeNull();
    state.keyDown('KeyZ', false);
    state.keyDown('ArrowLeft', false);
    expect(state.pointer()).toBeNull();
  });

  it('pressed로 물으면 왼쪽 버튼을 누르고 있을 때만 겨누는 위치를 돌려준다', () => {
    const state = new InputState();
    state.mouseMove(120, 80);
    expect(state.pointer(true)).toBeNull();
    state.keyDown('KeyZ', false);
    expect(state.pointer(true)).toBeNull();
    state.mouseDown(130, 80);
    expect(state.pointer(true)).toEqual([130, 80]);
    state.mouseUp();
    expect(state.pointer(true)).toBeNull();
    expect(state.pointer()).toEqual([130, 80]);
  });

  it('마우스를 움직이거나 누르면 그 위치로 겨눈다', () => {
    const state = new InputState();
    state.mouseMove(120, 80);
    expect(state.pointer()).toEqual([120, 80]);
    state.mouseDown(300, 40);
    expect(state.pointer()).toEqual([300, 40]);
  });

  it.each(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'])(
    'Z로 모으는 동안 %s를 누르면 키보드로 겨누고, 마우스를 움직이면 다시 마우스로 겨눈다',
    (code) => {
      const state = new InputState();
      state.mouseMove(120, 80);
      state.keyDown('KeyZ', false);
      expect(state.pointer()).toEqual([120, 80]);
      state.keyDown(code, false);
      expect(state.pointer()).toBeNull();
      state.mouseMove(121, 80);
      expect(state.pointer()).toEqual([121, 80]);
    },
  );

  it('Z로 모으는 동안 위아래 키와 무거워지기 키는 겨누는 장치를 바꾸지 않는다', () => {
    const state = new InputState();
    state.mouseMove(120, 80);
    state.keyDown('KeyZ', false);
    for (const code of ['ArrowUp', 'Space', 'ArrowDown', 'KeyS', 'KeyX', 'ShiftLeft']) state.keyDown(code, false);
    expect(state.pointer()).toEqual([120, 80]);
  });

  it('무거워지기 키를 누른 채로 좌우 키를 눌러도 마우스로 계속 겨눈다', () => {
    const state = new InputState();
    state.mouseMove(120, 80);
    state.keyDown('ShiftLeft', false);
    state.keyDown('ArrowLeft', false);
    expect(state.pointer()).toEqual([120, 80]);
  });

  it('모으지 않을 때의 방향키는 이동이므로 마우스로 계속 겨눈다', () => {
    const state = new InputState();
    state.mouseMove(120, 80);
    state.keyDown('ArrowLeft', false);
    state.keyDown('KeyD', false);
    state.keyDown('Space', false);
    expect(state.pointer()).toEqual([120, 80]);
  });

  it('마우스 버튼으로 모으는 동안에는 방향키를 눌러도 마우스로 겨눈다', () => {
    const state = new InputState();
    state.mouseDown(120, 80);
    state.keyDown('ArrowLeft', false);
    state.keyDown('KeyW', false);
    expect(state.pointer()).toEqual([120, 80]);
    expect(state.read()).toEqual({ ...NONE, left: true, up: true, special: true });
  });

  it('누르고 있던 방향키가 되풀이되어 들어와도 키보드 조준으로 바꾸지 않는다', () => {
    const state = new InputState();
    state.keyDown('KeyA', false);
    state.mouseMove(120, 80);
    state.keyDown('KeyZ', false);
    state.keyDown('KeyA', false);
    state.keyDown('KeyZ', false);
    expect(state.pointer()).toEqual([120, 80]);
  });

  it('마우스가 창을 벗어나면 키보드로 겨눈다. 버튼을 누르고 있으면 그대로 둔다', () => {
    const state = new InputState();
    state.mouseDown(120, 80);
    state.mouseLeave();
    expect(state.pointer()).toEqual([120, 80]);
    state.mouseUp();
    state.mouseLeave();
    expect(state.pointer()).toBeNull();
    state.mouseMove(10, 10);
    expect(state.pointer()).toEqual([10, 10]);
  });

  it('reset은 마우스 버튼을 떼고 겨누는 위치는 그대로 둔다', () => {
    const state = new InputState();
    state.mouseDown(120, 80);
    state.mouseHeavy(true);
    state.reset();
    expect(state.read()).toEqual(NONE);
    expect(state.pointer()).toEqual([120, 80]);
  });
});
