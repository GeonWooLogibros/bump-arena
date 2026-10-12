import { describe, expect, it } from 'vitest';
import { InputState } from '../src/input';

const NONE = { left: false, right: false, up: false, down: false, special: false };

describe('InputState 키보드', () => {
  it('방향키, WASD, X를 읽는다', () => {
    const state = new InputState();
    expect(state.read()).toEqual(NONE);
    for (const code of ['KeyA', 'ArrowRight', 'KeyW', 'ArrowDown', 'KeyX']) expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ left: true, right: true, up: true, down: true, special: true });
    state.keyUp('KeyX');
    expect(state.read().special).toBe(false);
  });

  it.each(['Space', 'ArrowUp', 'KeyW'])('%s는 뛰기다', (code) => {
    const state = new InputState();
    expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, up: true });
    state.keyUp(code);
    expect(state.read()).toEqual(NONE);
  });

  it.each(['KeyX', 'ShiftLeft', 'ShiftRight'])('%s는 특수 동작이다', (code) => {
    const state = new InputState();
    expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, special: true });
    state.keyUp(code);
    expect(state.read()).toEqual(NONE);
  });

  it('Shift를 누른 채로 방향키와 스페이스를 눌러도 모두 읽는다', () => {
    const state = new InputState();
    state.keyDown('ShiftLeft', false);
    expect(state.keyDown('ArrowLeft', false)).toBe(true);
    expect(state.keyDown('Space', false)).toBe(true);
    expect(state.read()).toEqual({ ...NONE, left: true, up: true, special: true });
  });

  it('Shift를 눌러도 누르고 있던 키가 떼어지지 않는다', () => {
    const state = new InputState();
    state.keyDown('ArrowRight', false);
    state.keyDown('Space', false);
    state.keyDown('ShiftRight', false);
    expect(state.read()).toEqual({ ...NONE, right: true, up: true, special: true });
    state.keyUp('ShiftRight');
    expect(state.read()).toEqual({ ...NONE, right: true, up: true });
  });

  it('양쪽 Shift 가운데 하나만 떼면 계속 누른 것으로 본다', () => {
    const state = new InputState();
    state.keyDown('ShiftLeft', false);
    state.keyDown('ShiftRight', false);
    state.keyUp('ShiftLeft');
    expect(state.read().special).toBe(true);
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
    state.reset();
    expect(state.read()).toEqual(NONE);
    expect(state.touching('special')).toBe(false);
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
