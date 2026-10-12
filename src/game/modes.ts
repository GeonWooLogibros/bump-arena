/** 게임 방식입니다. */
export type Mode = 'classic' | 'grapple' | 'arrows';

/** 선택할 수 있는 게임 방식과 화면에 보여줄 설명입니다. */
export const MODES: readonly { id: Mode; name: string; summary: string }[] = [
  { id: 'classic', name: '클래식', summary: '버튼을 누르는 동안 무거워집니다. 무거운 공이 가벼운 공을 밀어냅니다.' },
  { id: 'grapple', name: '갈고리', summary: '가까운 발판에 줄을 걸어 매달립니다. 줄을 이용해 흔들리며 상대를 밀어냅니다.' },
  { id: 'arrows', name: '화살', summary: '버튼을 길게 누르면 힘이 모입니다. 놓으면 화살이 날아가 상대를 맞힙니다.' },
];

/** 저장된 값이나 주소 값을 게임 방식으로 바꿉니다. 모르는 값은 클래식으로 봅니다. */
export function readMode(value: unknown): Mode {
  return MODES.find((m) => m.id === value)?.id ?? 'classic';
}

/** 선택할 수 있는 승리 점수입니다. */
export const TARGETS = [3, 5, 7] as const;

/** 기본 승리 점수입니다. */
export const DEFAULT_TARGET = 5;

/** 물리와 화면, 라운드 진행에 쓰는 수치입니다. 길이는 미터, 시간은 초(Ms가 붙은 것은 밀리초)입니다. */
export const TUNING = {
  step: 1 / 60,
  gravity: 20,
  radius: 0.5,
  restitution: 0.5,
  bouncyRestitution: 1.25,
  bounceSpeedMax: 12,
  friction: 0.3,
  accel: 18,
  jumpSpeed: 9,
  jumpCooldown: 0.15,
  damping: 0.3,
  heavyMass: 3,
  ropeReach: 8,
  arrowMinCharge: 0.2,
  arrowMaxCharge: 1,
  arrowMinSpeed: 12,
  arrowMaxSpeed: 30,
  arrowStuckLife: 3,
  arrowLife: 5,
  arrowCooldown: 1,
  arrowRadius: 0.1,
  viewW: 32,
  viewH: 18,
  boundsMargin: 2,
  countdownMs: 3000,
  roundLimitMs: 90000,
  roundEndMs: 2000,
} as const;
