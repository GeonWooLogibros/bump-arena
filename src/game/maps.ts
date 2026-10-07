/** 발판 도형입니다. 좌표는 미터이고 y는 아래쪽이 양수입니다. */
export type Shape =
  /** x, y는 중심이고 angle은 라디안입니다. */
  | { kind: 'box'; x: number; y: number; w: number; h: number; angle?: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  /** 볼록 다각형이며 꼭짓점 방향은 상관없습니다. */
  | { kind: 'poly'; points: readonly (readonly [number, number])[] };

/** 맵 하나입니다. spawns는 항상 6개입니다. */
export interface GameMap {
  id: string;
  name: string;
  shapes: readonly Shape[];
  spawns: readonly (readonly [number, number])[];
}

/** 원 위의 시작 위치입니다. 표면에서 0.6m 위에 놓습니다. */
function onCircle(x: number): readonly [number, number] {
  return [x, 19 - Math.sqrt(81 - (x - 16) ** 2) - 0.6];
}

/** 맵 목록입니다. 평지, 두 섬, 계단, 그릇, 기둥, 언덕 순서입니다. */
export const MAPS: readonly GameMap[] = [
  {
    id: 'flat',
    name: '평지',
    shapes: [{ kind: 'box', x: 16, y: 13, w: 22, h: 1 }],
    spawns: [7, 10.6, 14.2, 17.8, 21.4, 25].map((x) => [x, 11.9] as const),
  },
  {
    id: 'islands',
    name: '두 섬',
    shapes: [
      { kind: 'box', x: 8, y: 12, w: 9, h: 1 },
      { kind: 'box', x: 24, y: 12, w: 9, h: 1 },
    ],
    spawns: [5.5, 8, 10.5, 21.5, 24, 26.5].map((x) => [x, 10.9] as const),
  },
  {
    id: 'steps',
    name: '계단',
    shapes: [
      { kind: 'box', x: 7, y: 14, w: 7, h: 1 },
      { kind: 'box', x: 16, y: 11, w: 7, h: 1 },
      { kind: 'box', x: 25, y: 8, w: 7, h: 1 },
    ],
    spawns: [
      [5, 12.9],
      [9, 12.9],
      [14, 9.9],
      [18, 9.9],
      [23, 6.9],
      [27, 6.9],
    ],
  },
  {
    id: 'bowl',
    name: '그릇',
    shapes: [
      { kind: 'box', x: 16, y: 14, w: 12, h: 1 },
      { kind: 'box', x: 7.5, y: 12.3, w: 7, h: 1, angle: 0.5 },
      { kind: 'box', x: 24.5, y: 12.3, w: 7, h: 1, angle: -0.5 },
    ],
    spawns: [11.5, 13.3, 15.1, 16.9, 18.7, 20.5].map((x) => [x, 12.9] as const),
  },
  {
    id: 'pillars',
    name: '기둥',
    shapes: [
      ...[5, 10.4, 16, 21.6, 27].map((x) => ({ kind: 'box', x, y: 13, w: 2.4, h: 6 }) as const),
      { kind: 'box', x: 16, y: 6, w: 5, h: 0.6 },
    ],
    spawns: [
      [5, 9.4],
      [10.4, 9.4],
      [16, 9.4],
      [21.6, 9.4],
      [27, 9.4],
      [16, 5.1],
    ],
  },
  {
    id: 'hill',
    name: '언덕',
    shapes: [
      { kind: 'circle', x: 16, y: 19, r: 9 },
      { kind: 'box', x: 5, y: 9, w: 4, h: 0.6 },
      { kind: 'box', x: 27, y: 9, w: 4, h: 0.6 },
    ],
    spawns: [onCircle(13), onCircle(16), onCircle(19), onCircle(14.5), [5, 8.1], [27, 8.1]],
  },
];

/** 맵 설정에서 '무작위'를 뜻하는 값입니다. */
export const RANDOM_MAP = -1;

/** 참가 순서 index인 사람이 round번째 라운드에 쓰는 시작 위치 번호입니다. */
export function spawnSlot(index: number, round: number): number {
  return (index + round) % 6;
}

/** setting이 RANDOM_MAP이면 previous와 다른 맵을, 아니면 setting을 돌려줍니다. */
export function nextMap(setting: number, previous: number, random: () => number): number {
  if (setting !== RANDOM_MAP) return setting;
  const pick = Math.floor(random() * (MAPS.length - 1));
  return pick >= previous ? pick + 1 : pick;
}
