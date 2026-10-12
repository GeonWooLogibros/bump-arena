/** 상자가 왕복하는 방법입니다. 중심이 제자리에서 (dx, dy)만큼 떨어진 곳까지 갔다가 period초마다 제자리로 돌아옵니다. */
export interface Move {
  dx: number;
  dy: number;
  period: number;
}

/** 발판 도형입니다. 좌표는 미터이고 y는 아래쪽이 양수입니다. bouncy이면 닿은 공을 세게 튕겨 냅니다. */
export type Shape =
  /** x, y는 중심이고 angle은 라디안입니다. move가 있으면 움직이는 발판입니다. */
  | { kind: 'box'; x: number; y: number; w: number; h: number; angle?: number; bouncy?: boolean; move?: Move }
  | { kind: 'circle'; x: number; y: number; r: number; bouncy?: boolean }
  /** 볼록 다각형이며 꼭짓점 방향은 상관없습니다. */
  | { kind: 'poly'; points: readonly (readonly [number, number])[]; bouncy?: boolean };

/** 맵 하나입니다. spawns는 항상 6개입니다. */
export interface GameMap {
  id: string;
  name: string;
  shapes: readonly Shape[];
  spawns: readonly (readonly [number, number])[];
  /** mapAt이 움직이는 발판을 옮겨 만든 맵이면, 발판이 제자리에 있는 원래 맵입니다. */
  base?: GameMap;
}

/** 원 위의 시작 위치입니다. 표면에서 0.6m 위에 놓습니다. */
function onCircle(x: number): readonly [number, number] {
  return [x, 19 - Math.sqrt(81 - (x - 16) ** 2) - 0.6];
}

/** 중심이 (cx, cy)이고 반지름이 r인 원 위의 시작 위치입니다. 표면에서 0.6m 위에 놓습니다. */
function onArc(cx: number, cy: number, r: number, x: number): readonly [number, number] {
  return [x, cy - Math.sqrt(r * r - (x - cx) ** 2) - 0.6];
}

/** 골짜기 맵의 비탈 위 시작 위치입니다. 비탈은 x 3과 29에서 y 10이고 가운데(x 16)에서 y 13입니다. */
function onValley(x: number): readonly [number, number] {
  return [x, 10 + (3 * (13 - Math.abs(x - 16))) / 13 - 0.65];
}

/**
 * 맵 목록입니다. 평지, 두 섬, 계단, 그릇, 기둥, 언덕, 다리, 선반, 구멍, 골짜기, 징검다리, 쌍봉, 방방, 나룻배, 승강기, 시소 순서입니다.
 * 움직이는 발판은 다른 발판과 1.2m 이상 떨어져 다니게 해서 그 사이에 공이 끼지 않게 합니다.
 */
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
      { kind: 'box', x: 7.9, y: 13.15, w: 5.5, h: 1, angle: 0.3 },
      { kind: 'box', x: 24.1, y: 13.15, w: 5.5, h: 1, angle: -0.3 },
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
  {
    id: 'bridge',
    name: '다리',
    shapes: [
      { kind: 'box', x: 6, y: 14.5, w: 4, h: 5 },
      { kind: 'box', x: 26, y: 14.5, w: 4, h: 5 },
      {
        kind: 'poly',
        points: [
          [8, 12],
          [12, 10.5],
          [12, 10.9],
          [8, 12.4],
        ],
      },
      { kind: 'box', x: 16, y: 10.7, w: 8, h: 0.4 },
      {
        kind: 'poly',
        points: [
          [20, 10.5],
          [24, 12],
          [24, 12.4],
          [20, 10.9],
        ],
      },
    ],
    spawns: [
      [5, 11.4],
      [7, 11.4],
      [14.5, 9.9],
      [17.5, 9.9],
      [25, 11.4],
      [27, 11.4],
    ],
  },
  {
    id: 'shelves',
    name: '선반',
    shapes: [
      { kind: 'box', x: 22.5, y: 14.2, w: 10, h: 0.4 },
      { kind: 'box', x: 9.5, y: 13, w: 10, h: 0.4 },
      { kind: 'box', x: 22.5, y: 10.8, w: 10, h: 0.4 },
      { kind: 'box', x: 9.5, y: 9.6, w: 10, h: 0.4 },
    ],
    spawns: [
      [20, 13.4],
      [25, 13.4],
      [7, 12.2],
      [12, 12.2],
      [22.5, 10],
      [9.5, 8.8],
    ],
  },
  {
    id: 'pit',
    name: '구멍',
    shapes: [
      { kind: 'box', x: 8, y: 14.5, w: 11, h: 4 },
      { kind: 'box', x: 24, y: 14.5, w: 11, h: 4 },
      { kind: 'box', x: 16, y: 14.15, w: 2.6, h: 0.5, bouncy: true },
    ],
    spawns: [4.5, 7.5, 10.5, 21.5, 24.5, 27.5].map((x) => [x, 11.9] as const),
  },
  {
    id: 'valley',
    name: '골짜기',
    shapes: [
      {
        kind: 'poly',
        points: [
          [3, 10],
          [16, 13],
          [16, 14.5],
          [3, 11.5],
        ],
      },
      {
        kind: 'poly',
        points: [
          [16, 13],
          [29, 10],
          [29, 11.5],
          [16, 14.5],
        ],
      },
    ],
    spawns: [6, 10, 14, 18, 22, 26].map(onValley),
  },
  {
    id: 'stones',
    name: '징검다리',
    shapes: [
      { kind: 'box', x: 4.5, y: 13.25, w: 3.5, h: 0.5 },
      { kind: 'box', x: 10.25, y: 12.05, w: 3.5, h: 0.5 },
      { kind: 'box', x: 16, y: 13.25, w: 3.5, h: 0.5 },
      { kind: 'box', x: 21.75, y: 12.05, w: 3.5, h: 0.5 },
      { kind: 'box', x: 27.5, y: 13.25, w: 3.5, h: 0.5 },
    ],
    spawns: [
      [4.5, 12.4],
      [10.25, 11.2],
      [15.1, 12.4],
      [16.9, 12.4],
      [21.75, 11.2],
      [27.5, 12.4],
    ],
  },
  {
    id: 'twins',
    name: '쌍봉',
    shapes: [
      { kind: 'circle', x: 11.5, y: 17, r: 6.5 },
      { kind: 'circle', x: 20.5, y: 17, r: 6.5 },
    ],
    spawns: [
      ...[9.7, 11.5, 13.3].map((x) => onArc(11.5, 17, 6.5, x)),
      ...[18.7, 20.5, 22.3].map((x) => onArc(20.5, 17, 6.5, x)),
    ],
  },
  {
    id: 'trampoline',
    name: '방방',
    shapes: [
      { kind: 'box', x: 6.5, y: 13.5, w: 7, h: 1 },
      { kind: 'box', x: 12.25, y: 13.5, w: 4.5, h: 1, bouncy: true },
      { kind: 'box', x: 16, y: 13.5, w: 3, h: 1 },
      { kind: 'box', x: 19.75, y: 13.5, w: 4.5, h: 1, bouncy: true },
      { kind: 'box', x: 25.5, y: 13.5, w: 7, h: 1 },
    ],
    spawns: [4.5, 7.5, 15.2, 16.8, 24.5, 27.5].map((x) => [x, 12.4] as const),
  },
  {
    id: 'ferry',
    name: '나룻배',
    shapes: [
      { kind: 'box', x: 5.75, y: 14.5, w: 7.5, h: 4 },
      { kind: 'box', x: 26.25, y: 14.5, w: 7.5, h: 4 },
      { kind: 'box', x: 13.2, y: 12.75, w: 5, h: 0.5, move: { dx: 5.6, dy: 0, period: 8 } },
    ],
    spawns: [3.5, 5.75, 8, 24, 26.25, 28.5].map((x) => [x, 11.9] as const),
  },
  {
    id: 'lift',
    name: '승강기',
    shapes: [
      { kind: 'box', x: 7, y: 15, w: 9, h: 2 },
      { kind: 'box', x: 25, y: 9.3, w: 9, h: 0.6 },
      { kind: 'box', x: 16, y: 14.25, w: 6, h: 0.5, move: { dx: 0, dy: -5, period: 8 } },
    ],
    spawns: [
      [4.5, 13.4],
      [7, 13.4],
      [9.5, 13.4],
      [22.5, 8.4],
      [25, 8.4],
      [27.5, 8.4],
    ],
  },
  {
    id: 'seesaw',
    name: '시소',
    shapes: [
      { kind: 'box', x: 4.75, y: 14.5, w: 5.5, h: 4 },
      { kind: 'box', x: 27.25, y: 14.5, w: 5.5, h: 4 },
      { kind: 'box', x: 11.9, y: 14.15, w: 5.8, h: 0.5, move: { dx: 0, dy: -2.8, period: 8 } },
      { kind: 'box', x: 20.1, y: 11.35, w: 5.8, h: 0.5, move: { dx: 0, dy: 2.8, period: 8 } },
    ],
    spawns: [3, 4.75, 6.5, 25.5, 27.25, 29].map((x) => [x, 11.9] as const),
  },
];

/** 맵 설정에서 '무작위'를 뜻하는 값입니다. */
export const RANDOM_MAP = -1;

/** 참가 순서 index인 사람이 round번째 라운드에 쓰는 시작 위치 번호입니다. */
export function spawnSlot(index: number, round: number): number {
  return (index + round) % 6;
}

/** setting이 RANDOM_MAP이면 previous와 다른 맵을, 아니면 setting을 돌려줍니다. previous가 맵 번호가 아니면(첫 라운드) 모든 맵이 후보입니다. */
export function nextMap(setting: number, previous: number, random: () => number): number {
  if (setting !== RANDOM_MAP) return setting;
  if (previous < 0 || previous >= MAPS.length) return Math.floor(random() * MAPS.length);
  const pick = Math.floor(random() * (MAPS.length - 1));
  return pick >= previous ? pick + 1 : pick;
}

/**
 * play 단계가 시작된 뒤 time초가 지났을 때 움직이는 발판이 제자리에서 벗어난 거리입니다.
 * 시간만으로 정해지므로 같은 시간이면 어느 브라우저에서나 같은 값입니다. 처음에는 제자리에 멈춰 있다가 부드럽게 오갑니다.
 */
export function moveOffset(move: Move, time: number): readonly [number, number] {
  const s = (1 - Math.cos((2 * Math.PI * Math.max(0, time)) / move.period)) / 2;
  return [move.dx * s, move.dy * s];
}

/** 맵마다 마지막으로 만든 mapAt 결과입니다. 같은 시간을 여러 곳에서 물어도 한 번만 만듭니다. */
const moved = new WeakMap<GameMap, { time: number; map: GameMap }>();

/** play 단계가 시작된 뒤 time초가 지났을 때의 맵입니다. 움직이는 발판이 없으면 받은 맵 그대로입니다. */
export function mapAt(map: GameMap, time: number): GameMap {
  if (!map.shapes.some((s) => s.kind === 'box' && s.move)) return map;
  const last = moved.get(map);
  if (last?.time === time) return last.map;
  const shapes = map.shapes.map((s) => {
    if (s.kind !== 'box' || !s.move) return s;
    const [dx, dy] = moveOffset(s.move, time);
    return { ...s, x: s.x + dx, y: s.y + dy };
  });
  const at = { ...map, shapes, base: map };
  moved.set(map, { time, map: at });
  return at;
}
