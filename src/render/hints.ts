/** 경기 중에 화면 왼쪽 아래에 보여 주는 조작 안내입니다. */
import type { Mode } from '../game/modes';
import type { Phase } from '../game/round';

/** 안내 한 줄입니다. keys는 키 모양으로 그릴 글자들이고 label은 그 키가 하는 일입니다. */
export interface HintRow {
  keys: string[];
  label: string;
}

/** 경기가 시작된 뒤 안내를 또렷하게 두는 시간(밀리초)입니다. */
export const HINT_HOLD_MS = 4000;
/** 안내가 흐려지는 데 걸리는 시간(밀리초)입니다. */
export const HINT_FADE_MS = 1500;
/** 흐려진 뒤의 불투명도입니다. 눈에 덜 띄지만 찾으면 읽을 수 있는 정도입니다. */
export const HINT_DIM = 0.32;

const COMMON: readonly HintRow[] = [
  { keys: ['←', '→'], label: '이동' },
  { keys: ['스페이스'], label: '뛰기' },
];

/** 모드마다 다른 특수 동작의 안내입니다. 화살은 누르고 겨누고 떼는 순서를 알려 줍니다. */
const SPECIAL: Record<Mode, readonly HintRow[]> = {
  classic: [{ keys: ['X'], label: '무거워지기' }],
  grapple: [{ keys: ['X'], label: '줄 걸기' }],
  arrows: [
    { keys: ['X'], label: '누르는 동안 힘 모으기' },
    { keys: ['방향키'], label: '모으는 동안 겨누기' },
    { keys: ['X 떼기'], label: '화살 쏘기' },
  ],
};

/** 그 모드에서 보여 줄 안내 줄입니다. */
export function hintRows(mode: Mode): HintRow[] {
  return [...COMMON, ...SPECIAL[mode]].map((row) => ({ keys: [...row.keys], label: row.label }));
}

/** 안내의 불투명도입니다. 카운트다운에는 또렷하고, 경기가 시작되고 몇 초 뒤에 흐려집니다. 그 밖의 단계에서는 0입니다. */
export function hintOpacity(phase: Phase, ms: number): number {
  if (phase === 'countdown') return 1;
  if (phase !== 'play') return 0;
  const t = Math.max(0, Math.min(1, (ms - HINT_HOLD_MS) / HINT_FADE_MS));
  return 1 + (HINT_DIM - 1) * t;
}

/**
 * 안내를 그립니다. (left, bottom)은 안내의 왼쪽 아래 모서리(px)이고 u는 화면 크기에 맞춘 배율입니다.
 * 줄을 아래에서 위로 쌓으므로 줄이 많아도 화면 아래로 넘치지 않습니다.
 */
export function drawHints(
  ctx: CanvasRenderingContext2D,
  rows: readonly HintRow[],
  at: { left: number; bottom: number; u: number; font: string; alpha: number },
): void {
  const { left, bottom, u, font, alpha } = at;
  if (alpha <= 0) return;
  const rowHeight = 24 * u;
  const capHeight = 19 * u;
  const pad = 6 * u;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  rows.forEach((row, i) => {
    const middle = bottom - (rows.length - 1 - i) * rowHeight - rowHeight / 2;
    let x = left;
    ctx.font = `700 ${Math.round(12 * u)}px ${font}`;
    ctx.textAlign = 'center';
    for (const key of row.keys) {
      const width = Math.max(capHeight, ctx.measureText(key).width + pad * 2);
      ctx.fillStyle = 'rgba(30, 36, 51, 0.9)';
      ctx.strokeStyle = '#7f8ea8';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.roundRect(x, middle - capHeight / 2, width, capHeight, 4 * u);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(key, x + width / 2, middle + u * 0.5);
      x += width + 3 * u;
    }
    x += 4 * u;
    ctx.font = `600 ${Math.round(13 * u)}px ${font}`;
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(19, 23, 34, 0.72)';
    ctx.lineWidth = 3 * u;
    ctx.strokeText(row.label, x, middle + u * 0.5);
    ctx.fillStyle = '#c5cede';
    ctx.fillText(row.label, x, middle + u * 0.5);
  });
  ctx.restore();
}
