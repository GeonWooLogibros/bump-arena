/** 게임 방식입니다. */
export type Mode = 'classic' | 'grapple' | 'arrows';

/** 선택할 수 있는 게임 방식과 화면에 보여줄 설명입니다. */
export const MODES: readonly { id: Mode; name: string; summary: string }[] = [
  { id: 'classic', name: '클래식', summary: '특수 동작이 없습니다. 무거워지기로 버티면서 상대를 밀어냅니다.' },
  {
    id: 'grapple',
    name: '갈고리',
    summary: '특수 동작으로 발판에 줄을 걸어 매달립니다. 공 둘레의 충전량을 다 쓰면 잠시 줄을 쓸 수 없습니다.',
  },
  {
    id: 'arrows',
    name: '화살',
    summary: '특수 동작을 길게 누르면 힘이 모이고, 놓으면 화살이 날아갑니다. 화살에 맞은 공은 탈락합니다.',
  },
];

/** 저장된 값이나 주소 값을 게임 방식으로 바꿉니다. 모르는 값은 클래식으로 봅니다. */
export function readMode(value: unknown): Mode {
  return MODES.find((m) => m.id === value)?.id ?? 'classic';
}

/** 선택할 수 있는 승리 점수입니다. */
export const TARGETS = [3, 5, 7] as const;

/** 기본 승리 점수입니다. */
export const DEFAULT_TARGET = 5;

/**
 * 물리와 화면, 라운드 진행에 쓰는 수치입니다. 길이는 미터, 시간은 초(Ms가 붙은 것은 밀리초)입니다.
 * heavyFadeTime은 무거워지기를 누르고 있을 때 효과가 모두 사라지기까지의 시간이고, heavyRecoverTime은 뗀 뒤 모두 돌아오기까지의 시간입니다.
 * ropeDrainTime은 줄에 매달려 충전량을 다 쓰기까지의 시간, ropeFillTime은 0에서 가득 차기까지의 시간,
 * ropeLockTime은 충전량을 다 쓰거나 매달린 채 다른 공과 부딪친 뒤 줄을 쓸 수 없는 시간입니다.
 * arrowTurnSpeed는 화살을 모으는 동안 좌우 키로 방향을 돌리는 빠르기(라디안/초)입니다.
 */
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
  heavyFadeTime: 3,
  heavyRecoverTime: 3,
  ropeReach: 8,
  ropeDrainTime: 4,
  ropeFillTime: 3,
  ropeLockTime: 2.5,
  arrowMinCharge: 0.2,
  arrowMaxCharge: 1,
  arrowMinSpeed: 12,
  arrowMaxSpeed: 30,
  arrowStuckLife: 3,
  arrowLife: 5,
  arrowCooldown: 1,
  arrowTurnSpeed: 3.5,
  arrowRadius: 0.1,
  viewW: 32,
  viewH: 18,
  boundsMargin: 2,
  countdownMs: 3000,
  roundLimitMs: 90000,
  roundEndMs: 2000,
} as const;
