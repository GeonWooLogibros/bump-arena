import { COLORS, NAME_LIMIT } from './game/lobby';

export type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 같은 주소의 저장 공간을 다른 게임이 함께 쓰므로, 이 키 외에는 읽거나 쓰지 않습니다. */
export const PROFILE_KEY = 'bonk-arena.profile.v1';

/** 처음 화면에 미리 채워 둘 이름과 색(COLORS의 번호)입니다. */
export interface Profile {
  name: string;
  color: number;
}

/** 브라우저의 저장 공간입니다. 쓸 수 없는 환경이면 null입니다. */
export function browserStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validColor(color: unknown): color is number {
  return typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < COLORS.length;
}

function clip(name: string): string {
  return Array.from(name).slice(0, NAME_LIMIT).join('');
}

/** 저장된 이름과 색을 불러옵니다. 없거나 깨진 값이면 빈 이름과 첫 번째 색을 돌려줍니다. */
export function loadProfile(store: Store | null): Profile {
  try {
    const value: unknown = JSON.parse(store?.getItem(PROFILE_KEY) ?? 'null');
    if (typeof value === 'object' && value !== null) {
      const { name, color } = value as Record<string, unknown>;
      if (typeof name === 'string' && validColor(color)) return { name: clip(name), color };
    }
  } catch {
    // 읽지 못하면 처음 온 사람으로 봅니다.
  }
  return { name: '', color: 0 };
}

/** 이름과 색을 저장합니다. 저장하지 못해도 오류를 내지 않습니다. */
export function saveProfile(store: Store | null, profile: Profile): void {
  try {
    const color = validColor(profile.color) ? profile.color : 0;
    store?.setItem(PROFILE_KEY, JSON.stringify({ name: clip(profile.name), color }));
  } catch {
    // 저장하지 못해도 이번 접속에서는 입력한 이름과 색을 씁니다.
  }
}
