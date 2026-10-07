import { describe, expect, it } from 'vitest';
import { InputState } from '../src/input';

const NONE = { left: false, right: false, up: false, down: false, special: false };

describe('InputState 키보드', () => {
  it('방향키, WASD, X, 스페이스를 읽는다', () => {
    const state = new InputState();
    expect(state.read()).toEqual(NONE);
    for (const code of ['KeyA', 'ArrowRight', 'KeyW', 'ArrowDown', 'Space']) expect(state.keyDown(code, false)).toBe(true);
    expect(state.read()).toEqual({ left: true, right: true, up: true, down: true, special: true });
    state.keyUp('Space');
    expect(state.read().special).toBe(false);
    state.keyDown('KeyX', false);
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

  it('Cmd, Ctrl, Alt와 함께 누르면 누르고 있던 키를 모두 뗀다', () => {
    const state = new InputState();
    state.keyDown('ArrowLeft', false);
    state.keyDown('Space', false);
    expect(state.keyDown('KeyA', true)).toBe(false);
    expect(state.read()).toEqual(NONE);
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
