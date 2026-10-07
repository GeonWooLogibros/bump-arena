import { describe, expect, it } from 'vitest';
import { PROFILE_KEY, loadProfile, saveProfile } from '../src/storage';
import type { Store } from '../src/storage';

/** 읽고 쓴 키를 모두 기록하는 가짜 저장 공간입니다. */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const touched: string[] = [];
  const store: Store = {
    getItem: (key) => {
      touched.push(key);
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      touched.push(key);
      data.set(key, value);
    },
  };
  return { store, data, touched };
}

describe('프로필 저장', () => {
  it('저장한 이름과 색을 그대로 불러온다', () => {
    const { store } = fakeStore();
    saveProfile(store, { name: '통통이', color: 3 });
    expect(loadProfile(store)).toEqual({ name: '통통이', color: 3 });
  });

  it('저장한 적이 없으면 기본값을 돌려준다', () => {
    expect(loadProfile(fakeStore().store)).toEqual({ name: '', color: 0 });
  });

  it('깨진 JSON이면 기본값을 돌려준다', () => {
    const { store } = fakeStore({ [PROFILE_KEY]: '{"name":"통통' });
    expect(loadProfile(store)).toEqual({ name: '', color: 0 });
  });

  it.each([
    ['null', 'null'],
    ['배열', '[]'],
    ['숫자', '7'],
    ['이름이 글자가 아님', '{"name":5,"color":1}'],
    ['색이 범위를 벗어남', '{"name":"통통이","color":6}'],
    ['색이 음수', '{"name":"통통이","color":-1}'],
    ['색이 정수가 아님', '{"name":"통통이","color":1.5}'],
    ['색이 글자', '{"name":"통통이","color":"2"}'],
  ])('잘못된 값(%s)이면 기본값을 돌려준다', (_label, raw) => {
    const { store } = fakeStore({ [PROFILE_KEY]: raw });
    expect(loadProfile(store)).toEqual({ name: '', color: 0 });
  });

  it('이름은 12글자까지만 저장하고 불러온다', () => {
    const { store } = fakeStore();
    saveProfile(store, { name: '가나다라마바사아자차카타파하', color: 1 });
    expect(loadProfile(store)).toEqual({ name: '가나다라마바사아자차카타', color: 1 });
  });

  it('잘못된 색은 저장할 때 0으로 바꾼다', () => {
    const { store } = fakeStore();
    saveProfile(store, { name: '통통이', color: 9 });
    expect(loadProfile(store)).toEqual({ name: '통통이', color: 0 });
  });

  it('PROFILE_KEY 외의 키는 읽거나 쓰지 않는다', () => {
    const { store, data, touched } = fakeStore({ 'other-game.save': '소중한 저장' });
    saveProfile(store, { name: '통통이', color: 2 });
    loadProfile(store);
    expect(PROFILE_KEY).toBe('bonk-arena.profile.v1');
    expect(new Set(touched)).toEqual(new Set([PROFILE_KEY]));
    expect(data.get('other-game.save')).toBe('소중한 저장');
    expect([...data.keys()].sort()).toEqual([PROFILE_KEY, 'other-game.save'].sort());
  });

  it('store가 null이어도 오류 없이 기본값을 돌려준다', () => {
    expect(() => saveProfile(null, { name: '통통이', color: 2 })).not.toThrow();
    expect(loadProfile(null)).toEqual({ name: '', color: 0 });
  });

  it('store가 예외를 던져도 오류 없이 기본값을 돌려준다', () => {
    const broken: Store = {
      getItem: () => {
        throw new Error('막힘');
      },
      setItem: () => {
        throw new Error('막힘');
      },
    };
    expect(() => saveProfile(broken, { name: '통통이', color: 2 })).not.toThrow();
    expect(loadProfile(broken)).toEqual({ name: '', color: 0 });
  });
});
