/** 화면 밖으로 나간 공이 어느 쪽에 있는지 가장자리에 알려 주는 표시입니다. */
import { TUNING } from '../game/modes';

/** 표시 하나입니다. (x, y)는 화면 안쪽의 위치(m)이고 angle은 공이 있는 쪽입니다. */
export interface EdgeMark {
  x: number;
  y: number;
  angle: number;
  /** 탈락 경계에 가까운 정도(0~1)입니다. 위쪽으로 나간 공은 탈락하지 않으므로 0입니다. */
  danger: number;
}

/** 표시를 화면 가장자리에서 이만큼(m) 안쪽에 둡니다. */
export const EDGE_INSET = 0.7;

/**
 * 공의 중심 (x, y)가 화면 밖이면 out에 표시를 채우고 true를 돌려줍니다. 화면 안이면 false입니다.
 * 프레임마다 부르므로 결과를 새로 만들지 않고 받은 객체에 씁니다.
 */
export function edgeMark(x: number, y: number, out: EdgeMark): boolean {
  const { viewW, viewH, boundsMargin } = TUNING;
  if (x >= 0 && x <= viewW && y >= 0 && y <= viewH) return false;
  out.x = Math.max(EDGE_INSET, Math.min(viewW - EDGE_INSET, x));
  out.y = Math.max(EDGE_INSET, Math.min(viewH - EDGE_INSET, y));
  out.angle = Math.atan2(y - out.y, x - out.x);
  const past = Math.max(-x, x - viewW, y - viewH, 0);
  out.danger = Math.min(1, past / boundsMargin);
  return true;
}
