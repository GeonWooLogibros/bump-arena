/** AI의 수준입니다. */
export type Difficulty = 'easy' | 'normal' | 'hard';

/** 선택할 수 있는 AI 수준과 화면에 보여줄 이름입니다. */
export const DIFFICULTIES: readonly { id: Difficulty; name: string }[] = [
  { id: 'easy', name: '쉬움' },
  { id: 'normal', name: '보통' },
  { id: 'hard', name: '어려움' },
];

/** 기본 AI 수준입니다. */
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

/** 저장된 값이나 받은 값을 AI 수준으로 바꿉니다. 모르는 값은 보통으로 봅니다. */
export function readDifficulty(value: unknown): Difficulty {
  return DIFFICULTIES.find((d) => d.id === value)?.id ?? DEFAULT_DIFFICULTY;
}

/** 사람이 할 수 없는 조작을 하지 않도록, 어느 수준의 AI도 이보다 짧은 간격(초)으로는 생각하지 않습니다. */
export const THINK_FLOOR = 0.1;

/** 수준에 따라 달라지는 AI의 조절값입니다. 범위는 [최소, 최대]입니다. */
export interface BotSkill {
  /** 상황을 다시 보고 입력을 고르는 간격(초)입니다. */
  think: number;
  /** 다른 공들의 위치를 다시 살피는 간격(초)입니다. 그사이에는 지난번에 본 곳에 있다고 봅니다. 0이면 생각할 때마다 살핍니다. */
  notice: number;
  /** 자리 끝에서 이만큼 안쪽까지만 다닙니다(m). */
  edgeMargin: number;
  /** 상대에게 달려들 때의 최고 속력(m/s)입니다. */
  chargeSpeed: number;
  /** 달려드는 상대가 이 거리(m) 안에 있으면 자리 끝이 가까워도 속력을 줄이지 않고 들이받습니다. */
  ramRange: number;
  /** 부딪치기 직전에 때맞춰 무거워질 확률입니다. */
  heavyChance: number;
  /** 튕겨 나간 뒤 손을 놓고 있는 시간입니다. 튕겨 나가는 속력 1m/s마다 이 범위(초)에서 고른 값만큼 길어집니다. */
  stunRate: readonly [number, number];
  /** 자리 밖으로 밀려난 뒤 벽을 차거나 줄을 걸기 시작하기까지 걸리는 시간(초)의 범위입니다. */
  rescueDelay: readonly [number, number];
  /** 라운드가 시작된 뒤 처음 화살을 모으기까지 기다리는 시간(초)의 범위입니다. */
  firstShot: readonly [number, number];
  /** 쏜 뒤 다시 모으기까지 더 쉬는 시간(초)의 범위입니다. TUNING.arrowCooldown에 더합니다. */
  arrowRest: readonly [number, number];
  /** 화살이 상대 중심에서 이 거리(m) 안을 지나겠다 싶으면 쏩니다. 클수록 빗나가는 화살이 많습니다. */
  aimTolerance: number;
}

/** 수준별 조절값입니다. 보통은 수준을 나누기 전의 AI와 같은 값입니다. */
export const SKILLS: Readonly<Record<Difficulty, BotSkill>> = {
  easy: {
    think: 0.15,
    notice: 0.5,
    edgeMargin: 0.7,
    chargeSpeed: 9,
    ramRange: 0,
    heavyChance: 0.35,
    stunRate: [0.2, 0.3],
    rescueDelay: [0.3, 0.6],
    firstShot: [4, 6],
    arrowRest: [1, 2.5],
    aimTolerance: 0.9,
  },
  normal: {
    think: 0.15,
    notice: 0,
    edgeMargin: 0.45,
    chargeSpeed: 13,
    ramRange: 5,
    heavyChance: 0.7,
    stunRate: [0.08, 0.15],
    rescueDelay: [0.3, 0.6],
    firstShot: [2.5, 4],
    arrowRest: [0.2, 1],
    aimTolerance: 0.5,
  },
  hard: {
    think: THINK_FLOOR,
    notice: 0,
    edgeMargin: 0.45,
    chargeSpeed: 15,
    ramRange: 8,
    heavyChance: 0.95,
    stunRate: [0.04, 0.08],
    rescueDelay: [0.2, 0.35],
    firstShot: [2, 3],
    arrowRest: [0, 0.4],
    aimTolerance: 0.4,
  },
};
