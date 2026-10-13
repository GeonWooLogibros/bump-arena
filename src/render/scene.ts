/** 경기 화면 그리기. 받은 모습을 그대로 그리기만 하고 아무것도 바꾸지 않습니다. */
import { COLORS } from '../game/lobby';
import { MAPS, moveOffset } from '../game/maps';
import type { Shape } from '../game/maps';
import { MODES, TUNING } from '../game/modes';
import type { PlayerInfo } from '../multiplayer';
import { corners } from '../physics/geometry';
import type { ArrowView, BallView } from '../physics/world';
import type { SessionView } from '../session';
import { blinkPhase, edgeMark } from './edge';
import type { EdgeMark } from './edge';
import { SHARD_LIFE, SPARK_LIFE } from './effects';
import type { Effects } from './effects';
import { drawHints, hintOpacity, hintRows } from './hints';
import { ramp, squashAt, stretchOf } from './pose';
import type { BallPose, Poses } from './pose';

/** 화면 px = 세계 m × scale + offset 입니다. */
export interface ViewBox {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 공 하나에 쓰는 안쪽 색과 테두리 색입니다. */
export interface BallColors {
  fill: string;
  edge: string;
}

/** 점수표의 한 줄입니다. out은 이번 라운드에서 탈락했거나 참가하지 않았다는 뜻입니다. */
export interface ScoreRow {
  id: string;
  name: string;
  colors: BallColors;
  score: number;
  out: boolean;
  me: boolean;
}

const BACKGROUND = '#1e2433';
const OUTSIDE = '#131722';
const PLATFORM = '#55627a';
const PLATFORM_TOP = '#7f8ea8';
/** 튕기는 발판의 색입니다. */
const BOUNCY = '#2b8a6e';
const BOUNCY_TOP = '#63e6be';
const ROPE = '#e8edf7';
const ARROW = '#f1f3f8';
const CHARGE = '#ffd43b';
const TEXT = '#ffffff';
const TEXT_DIM = '#c5cede';
const SHADE = 'rgba(19, 23, 34, 0.72)';
/** 방을 나가서 이름과 색을 알 수 없는 사람에게 쓰는 색과 이름입니다. */
const GONE_COLORS: BallColors = { fill: '#8a93a6', edge: '#5b6475' };
export const GONE_NAME = '나간 사람';
const FONT = "system-ui, 'Apple SD Gothic Neo', sans-serif";
const TAU = Math.PI * 2;
/** 화살의 길이(미터)입니다. */
const ARROW_LENGTH = 0.9;
/** 라운드 결과 문구를 쓰는 높이(미터)입니다. 점수표 아래, 화면 위쪽입니다. */
const BANNER_Y = 3.6;
/** 카운트다운 숫자를 쓰는 높이(미터)와 불투명도입니다. 공을 가리지 않게 화면 위쪽에 조금 비치게 씁니다. */
const COUNT_Y = 2.9;
const COUNT_ALPHA = 0.8;
/** 모으지 않을 때 마우스 쪽으로 그리는 조준 표시의 불투명도입니다. */
const AIM_GUIDE_ALPHA = 0.35;
/** 화면이 흔들리는 폭(미터)입니다. */
const SHAKE_REACH = 0.14;
/** 무거워진 공의 안쪽에 덧칠하는 어두운 색입니다. */
const HEAVY_SHADE = 'rgba(10, 12, 20, 0.4)';
/** 무거워진 공의 둘레에 그리는 고리가 공에서 떨어진 거리(미터)입니다. */
const HEAVY_RING = 0.15;
/** 공이 이 속력(m/s)부터 잔상을 남기고, TRAIL_FULL에서 가장 진합니다. */
const TRAIL_FROM = 11;
const TRAIL_FULL = 22;
/** 잔상의 수, 잔상 사이의 시간 간격(초), 가장 진한 잔상의 불투명도입니다. */
const TRAIL_COUNT = 4;
const TRAIL_GAP = 0.014;
const TRAIL_ALPHA = 0.3;
/** 화면 밖으로 나간 공을 알리는 화살표의 크기(미터)입니다. 내 공은 크게, 다른 공은 작게 그립니다. */
const MARK_MINE = 0.5;
const MARK_OTHER = 0.3;
/** 충돌 불꽃의 색입니다. 공끼리, 발판, 튕기는 발판 순서입니다. */
export const SPARK_COLORS = { ball: '#ffffff', ground: '#c5cede', bouncy: BOUNCY_TOP } as const;

/** 창 크기에 16:9로 맞춥니다. 남는 쪽은 가운데에 둡니다. */
export function fitView(width: number, height: number): ViewBox {
  const scale = Math.min(width / TUNING.viewW, height / TUNING.viewH);
  return {
    scale,
    offsetX: (width - TUNING.viewW * scale) / 2,
    offsetY: (height - TUNING.viewH * scale) / 2,
  };
}

/** 화면 위치(px)를 세계 위치(m)로 바꿉니다. 화면에 그릴 자리가 없으면 null입니다. */
export function toWorld(box: ViewBox, x: number, y: number): [number, number] | null {
  if (!(box.scale > 0)) return null;
  return [(x - box.offsetX) / box.scale, (y - box.offsetY) / box.scale];
}

/** 참가자의 색입니다. 방을 나가서 정보가 없으면 회색입니다. */
export function ballColors(players: readonly PlayerInfo[], id: string): BallColors {
  const info = players.find((p) => p.id === id);
  return (info && COLORS[info.color]) || GONE_COLORS;
}

/**
 * 점수표에 보여 줄 사람들입니다. 이번 라운드 참가자를 시작 순서대로 놓고, 구경 중인 사람을 뒤에 붙입니다.
 * 방을 나가서 참가자 명단에도 없는 사람의 점수는 보여 주지 않습니다.
 */
export function scoreRows(view: SessionView, players: readonly PlayerInfo[]): ScoreRow[] {
  const { roster, scores } = view.match;
  const ids = [...roster, ...players.filter((p) => !roster.includes(p.id)).map((p) => p.id)];
  return ids.map((id) => {
    const info = players.find((p) => p.id === id);
    return {
      id,
      name: info?.name ?? GONE_NAME,
      colors: ballColors(players, id),
      score: scores[id] ?? 0,
      out: !view.balls.some((b) => b.id === id && b.alive),
      me: id === view.me,
    };
  });
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, line: number): void {
  ctx.fillStyle = shape.bouncy ? BOUNCY : PLATFORM;
  ctx.strokeStyle = shape.bouncy ? BOUNCY_TOP : PLATFORM_TOP;
  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  if (shape.kind === 'circle') {
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, shape.r, 0, TAU);
    ctx.fill();
    // 위쪽 반원만 강조합니다.
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, shape.r - line / 2, Math.PI, TAU);
    ctx.stroke();
    return;
  }
  const points = corners(shape) ?? [];
  if (points.length < 3) return;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
  // 바깥쪽이 위를 향하는 변만 강조합니다.
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  ctx.beginPath();
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    let nx = b[1] - a[1];
    let ny = a[0] - b[0];
    const length = Math.hypot(nx, ny);
    if (length === 0) return;
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (ny / length > -0.5) return;
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  });
  ctx.stroke();
}

/**
 * 발판들을 그립니다. shapes는 발판이 제자리에 있을 때의 도형이고, 움직이는 발판은 time초의 위치로 옮겨 그립니다.
 * 공이 방금 튕긴 발판은 눌린 만큼 밀어서 그립니다.
 */
function drawShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[], px: number, time = 0, poses?: Poses): void {
  shapes.forEach((shape, i) => {
    let dx = 0;
    let dy = 0;
    if (shape.kind === 'box' && shape.move) [dx, dy] = moveOffset(shape.move, time);
    const dent = poses?.pad(i);
    if (dent) {
      const depth = squashAt(dent.amount, dent.age);
      dx += dent.nx * depth;
      dy += dent.ny * depth;
    }
    if (dx === 0 && dy === 0) {
      drawShape(ctx, shape, 4 * px);
      return;
    }
    ctx.save();
    ctx.translate(dx, dy);
    drawShape(ctx, shape, 4 * px);
    ctx.restore();
  });
}

function drawRope(ctx: CanvasRenderingContext2D, pose: BallPose, px: number): void {
  if (!pose.ball.rope) return;
  const ax = pose.ropeX;
  const ay = pose.ropeY;
  ctx.strokeStyle = ROPE;
  ctx.lineWidth = 2.5 * px;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pose.x, pose.y);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  ctx.fillStyle = ROPE;
  ctx.beginPath();
  ctx.arc(ax, ay, 4 * px, 0, TAU);
  ctx.fill();
}

/** 지금의 좌표계를 단위 벡터 (ux, uy) 방향으로 k배, 그 옆 방향으로 1/k배 합니다. 넓이는 그대로입니다. */
function deform(ctx: CanvasRenderingContext2D, ux: number, uy: number, k: number): void {
  const inv = 1 / k;
  const skew = (k - inv) * ux * uy;
  ctx.transform(k * ux * ux + inv * uy * uy, skew, skew, k * uy * uy + inv * ux * ux, 0, 0);
}

/** 빠르게 날아가는 공의 뒤에 흐린 원을 몇 개 남깁니다. */
function drawTrail(ctx: CanvasRenderingContext2D, pose: BallPose, colors: BallColors): void {
  const strength = ramp(Math.hypot(pose.vx, pose.vy), TRAIL_FROM, TRAIL_FULL);
  if (strength <= 0) return;
  ctx.fillStyle = colors.fill;
  for (let k = TRAIL_COUNT; k >= 1; k--) {
    ctx.globalAlpha = strength * TRAIL_ALPHA * (1 - (k - 1) / TRAIL_COUNT);
    ctx.beginPath();
    ctx.arc(pose.x - pose.vx * TRAIL_GAP * k, pose.y - pose.vy * TRAIL_GAP * k, TUNING.radius * (1 - 0.12 * k), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBall(ctx: CanvasRenderingContext2D, pose: BallPose, colors: BallColors, px: number): void {
  const r = TUNING.radius;
  const { heavy } = pose.ball;
  const edge = (heavy ? 5 : 2) * px;
  ctx.save();
  // 눌린 만큼 부딪친 쪽으로 다가가서, 닿은 면이 떨어져 보이지 않게 합니다.
  ctx.translate(pose.x + pose.nx * r * pose.squash, pose.y + pose.ny * r * pose.squash);
  const speed = Math.hypot(pose.vx, pose.vy);
  const stretch = stretchOf(speed);
  if (stretch > 0) deform(ctx, pose.vx / speed, pose.vy / speed, 1 + stretch);
  if (pose.squash !== 0) deform(ctx, pose.nx, pose.ny, 1 - pose.squash);
  ctx.lineCap = 'round';
  // 무거워진 공은 안쪽이 어둡고 테두리가 굵으며, 둘레에 고리가 하나 더 있습니다.
  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = heavy ? colors.fill : colors.edge;
  // 테두리가 굵어져도 공의 크기는 그대로 보이게 안쪽으로 긋습니다.
  ctx.lineWidth = edge;
  ctx.beginPath();
  ctx.arc(0, 0, r - edge / 2, 0, TAU);
  ctx.fill();
  if (heavy) {
    ctx.fillStyle = HEAVY_SHADE;
    ctx.fill();
  }
  ctx.stroke();
  ctx.lineWidth = 2 * px;
  const core = heavy ? r * 0.3 : 0;
  if (heavy) {
    ctx.fillStyle = colors.fill;
    ctx.beginPath();
    ctx.arc(0, 0, core, 0, TAU);
    ctx.fill();
    ctx.globalAlpha *= 0.65;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.arc(0, 0, r + HEAVY_RING, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 2 * px;
  }
  // 굴러가는 방향을 알 수 있는 반지름 선입니다.
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  ctx.beginPath();
  ctx.moveTo(cos * core, sin * core);
  ctx.lineTo(cos * (r - edge), sin * (r - edge));
  ctx.stroke();
  ctx.restore();
}

/** 공에서 (x, y)를 향하는 단위 벡터입니다. 공의 중심과 겹치면 null입니다. */
function toward(ball: BallPose, x: number, y: number): [number, number] | null {
  const dx = x - ball.x;
  const dy = y - ball.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-3 ? [dx / length, dy / length] : null;
}

/** 모으지 않을 때 마우스로 겨누는 방향을 옅은 선으로 그립니다. */
function drawAimGuide(ctx: CanvasRenderingContext2D, ball: BallPose, dir: readonly [number, number], px: number): void {
  const near = TUNING.radius + 0.3;
  const far = near + 0.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ARROW;
  ctx.lineWidth = 2.5 * px;
  ctx.globalAlpha = AIM_GUIDE_ALPHA;
  ctx.beginPath();
  ctx.moveTo(ball.x + dir[0] * near, ball.y + dir[1] * near);
  ctx.lineTo(ball.x + dir[0] * far, ball.y + dir[1] * far);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * 화살을 모으는 동안 겨누는 방향의 선과 모인 힘만큼 채워지는 호를 그립니다.
 * dir을 주면 받은 방향 대신 그 방향으로 그립니다. 마우스로 겨누는 내 공은 step을 기다리지 않고 마우스를 바로 따라갑니다.
 */
function drawAim(ctx: CanvasRenderingContext2D, ball: BallPose, px: number, dir: readonly [number, number] | null = null): void {
  const aim = ball.ball.aim;
  if (!aim) return;
  const [dx, dy] = dir ?? [aim.dx, aim.dy];
  const r = TUNING.radius;
  const charge = Math.max(0, Math.min(1, aim.charge));
  const near = r + 0.3;
  const far = near + 0.5 + charge * 1.3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ARROW;
  ctx.lineWidth = 2.5 * px;
  ctx.beginPath();
  ctx.moveTo(ball.x + dx * near, ball.y + dy * near);
  ctx.lineTo(ball.x + dx * far, ball.y + dy * far);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 4 * px;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r + 0.16, 0, TAU);
  ctx.stroke();
  if (charge <= 0) return;
  ctx.strokeStyle = CHARGE;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r + 0.16, -Math.PI / 2, -Math.PI / 2 + TAU * charge);
  ctx.stroke();
}

/** 화살 하나를 그립니다. (x, y)가 촉의 위치이고 몸통은 날아온 쪽으로 뻗습니다. */
function drawArrow(ctx: CanvasRenderingContext2D, arrow: ArrowView, x: number, y: number, color: string, px: number): void {
  const cos = Math.cos(arrow.angle);
  const sin = Math.sin(arrow.angle);
  const head = 0.24;
  ctx.lineCap = 'round';
  ctx.strokeStyle = ARROW;
  ctx.lineWidth = 3 * px;
  ctx.beginPath();
  ctx.moveTo(x - cos * ARROW_LENGTH, y - sin * ARROW_LENGTH);
  ctx.lineTo(x - cos * head * 0.5, y - sin * head * 0.5);
  ctx.stroke();
  // 촉은 쏜 사람의 색으로 칠합니다.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - cos * head + sin * head * 0.5, y - sin * head - cos * head * 0.5);
  ctx.lineTo(x - cos * head - sin * head * 0.5, y - sin * head + cos * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

function drawEffects(ctx: CanvasRenderingContext2D, effects: Effects, px: number): void {
  for (const ring of effects.rings) {
    const t = 1 - ring.life / SHARD_LIFE;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 4 * px;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, 0.4 + t * 2.2, 0, TAU);
    ctx.stroke();
  }
  for (const shard of effects.shards) {
    const left = Math.max(0, shard.life / SHARD_LIFE);
    ctx.globalAlpha = left;
    ctx.fillStyle = shard.color;
    ctx.beginPath();
    ctx.arc(shard.x, shard.y, 0.07 + 0.11 * left, 0, TAU);
    ctx.fill();
  }
  // 불꽃은 날아가는 방향으로 짧게 긋습니다.
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.5 * px;
  for (const spark of effects.sparks) {
    ctx.globalAlpha = Math.max(0, spark.life / SPARK_LIFE);
    ctx.strokeStyle = spark.color;
    ctx.beginPath();
    ctx.moveTo(spark.x, spark.y);
    ctx.lineTo(spark.x - spark.vx * 0.025, spark.y - spark.vy * 0.025);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const MARK: EdgeMark = { x: 0, y: 0, angle: 0, danger: 0 };
/** 내 공의 표시가 깜빡이는 위상과, 그 위상을 마지막으로 진행한 시각(밀리초)입니다. */
let markPhase = 0;
let markAt = 0;

/**
 * 화면 밖으로 나간 공마다 가장자리에 그 공이 있는 쪽을 가리키는 화살표를 그립니다.
 * 내 공의 화살표는 크고, 탈락 경계에 가까울수록 더 커지며 빠르게 깜빡입니다.
 */
function drawEdgeMarks(
  ctx: CanvasRenderingContext2D,
  poses: Poses,
  me: string,
  players: readonly PlayerInfo[],
  time: number,
  px: number,
): void {
  for (const pose of poses.balls) {
    if (!pose.ball.alive || !edgeMark(pose.x, pose.y, MARK)) continue;
    const mine = pose.ball.id === me;
    const colors = ballColors(players, pose.ball.id);
    const size = mine ? MARK_MINE * (1 + 0.3 * MARK.danger) : MARK_OTHER;
    if (mine) {
      markPhase = blinkPhase(markPhase, time - markAt, MARK.danger);
      markAt = time;
    }
    ctx.save();
    ctx.translate(MARK.x, MARK.y);
    ctx.rotate(MARK.angle);
    ctx.globalAlpha = mine ? 0.7 + 0.3 * Math.sin(markPhase) : 0.85;
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = mine ? TEXT : colors.edge;
    ctx.lineWidth = (mine ? 3 : 2) * px;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, -size * 0.7);
    ctx.lineTo(-size * 0.6, size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

const BACKDROP_BALL: BallView = { id: '', x: 0, y: 0, angle: 0, alive: true, heavy: false, rope: null, aim: null };
const BACKDROP: BallPose = { ball: BACKDROP_BALL, x: 0, y: 0, angle: 0, ropeX: 0, ropeY: 0, vx: 0, vy: 0, nx: 0, ny: 0, squash: 0 };

/** 경기가 없을 때 메뉴 뒤에 보이는 그림입니다. 평지 위에서 공 여섯 개가 통통 뜁니다. */
function drawBackdrop(ctx: CanvasRenderingContext2D, time: number, px: number): void {
  const map = MAPS[0];
  ctx.globalAlpha = 0.55;
  drawShapes(ctx, map.shapes, px);
  map.spawns.forEach(([x], i) => {
    const hop = Math.abs(Math.sin(time / 420 + i * 1.3));
    BACKDROP.x = x;
    BACKDROP.y = 12.5 - TUNING.radius - hop * (1.2 + (i % 3) * 0.5);
    BACKDROP.angle = time / 600 + i;
    drawBall(ctx, BACKDROP, COLORS[i % COLORS.length], px);
  });
  ctx.globalAlpha = 1;
}

/** 글자 뒤에 어두운 테두리를 둘러 어떤 배경 위에서도 읽히게 합니다. */
function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, line: number): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SHADE;
  ctx.lineWidth = line;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** 공 위에 이름을 씁니다. 내 공은 흰색 굵은 글씨에 작은 삼각형을 붙입니다. */
function drawName(ctx: CanvasRenderingContext2D, x: number, top: number, name: string, mine: boolean, u: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${mine ? 800 : 500} ${Math.round(13 * u)}px ${FONT}`;
  let y = top - 5 * u;
  if (mine) {
    const half = 5 * u;
    ctx.fillStyle = TEXT;
    ctx.beginPath();
    ctx.moveTo(x - half, y - half * 1.2);
    ctx.lineTo(x + half, y - half * 1.2);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    y -= half * 1.2 + 4 * u;
  }
  outlined(ctx, name, x, y, mine ? TEXT : TEXT_DIM, 3 * u);
}

/** 위쪽 가운데의 점수표입니다. 색 원과 점수, 목표 점수를 보여 주고 탈락한 사람은 흐리게 그립니다. */
function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  rows: readonly ScoreRow[],
  target: number,
  centerX: number,
  top: number,
  u: number,
): void {
  const radius = 10 * u;
  const cell = 46 * u;
  const height = 34 * u;
  const pad = 12 * u;
  const goal = `목표 ${target}점`;
  ctx.font = `600 ${Math.round(13 * u)}px ${FONT}`;
  const goalWidth = ctx.measureText(goal).width;
  const width = pad + rows.length * cell + goalWidth + pad;
  const left = centerX - width / 2;
  const middle = top + height / 2;

  ctx.fillStyle = SHADE;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, height / 2);
  ctx.fill();

  ctx.textBaseline = 'middle';
  rows.forEach((row, i) => {
    const x = left + pad + i * cell + radius;
    ctx.globalAlpha = row.out ? 0.35 : 1;
    ctx.fillStyle = row.colors.fill;
    ctx.strokeStyle = row.me ? TEXT : row.colors.edge;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(x, middle, radius - u, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    ctx.font = `800 ${Math.round(16 * u)}px ${FONT}`;
    ctx.fillText(String(row.score), x + radius + 5 * u, middle + u);
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = TEXT_DIM;
  ctx.textAlign = 'right';
  ctx.font = `600 ${Math.round(13 * u)}px ${FONT}`;
  ctx.fillText(goal, left + width - pad, middle + u);
}

/** 큰 문구입니다. y는 글자 가운데의 높이(미터)입니다. 공과 발판을 가리지 않게 글자에 테두리만 두릅니다. */
function drawBanner(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  box: ViewBox,
  y: number,
  size: number,
): void {
  const { scale, offsetX, offsetY } = box;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(size)}px ${FONT}`;
  outlined(ctx, text, offsetX + (TUNING.viewW / 2) * scale, offsetY + y * scale, color, Math.max(3, size * 0.14));
}

/** 카운트다운, 라운드 결과, 구경 안내를 그립니다. */
function drawMessages(ctx: CanvasRenderingContext2D, view: SessionView, rows: readonly ScoreRow[], box: ViewBox, u: number): void {
  const { phase, ms, winner } = view.match;
  const { scale, offsetX, offsetY } = box;
  if (phase === 'countdown') {
    const left = Math.max(1, TUNING.countdownMs - ms);
    const count = Math.min(3, Math.ceil(left / 1000));
    // 숫자가 바뀔 때 크게 나타났다가 줄어듭니다.
    const fresh = (left % 1000) / 1000;
    ctx.globalAlpha = COUNT_ALPHA;
    drawBanner(ctx, String(count), TEXT, box, COUNT_Y, scale * (1.3 + 0.5 * fresh));
    ctx.globalAlpha = 1;
  } else if (phase === 'roundEnd') {
    const row = rows.find((r) => r.id === winner);
    // 남은 공을 끝까지 볼 수 있게 화면 위쪽에 씁니다.
    drawBanner(ctx, row ? `${row.name} 승리` : '무승부', row ? row.colors.fill : TEXT, box, BANNER_Y, scale * 1.3);
  }
  if (view.watching && phase !== 'matchEnd') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${Math.round(15 * u)}px ${FONT}`;
    const x = offsetX + (TUNING.viewW / 2) * scale;
    outlined(ctx, '다음 라운드부터 참가합니다.', x, offsetY + (TUNING.viewH - 0.8) * scale, TEXT, 4 * u);
  }
}

/** 한 프레임을 그립니다. width와 height는 CSS px 단위의 화면 크기입니다. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  s: {
    width: number;
    height: number;
    view: SessionView | null;
    players: PlayerInfo[];
    effects: Effects;
    /** 이번 프레임에 그릴 공과 화살의 모습입니다. */
    poses: Poses;
    time: number;
    /** 키보드 조작 안내를 그릴지 여부. 터치 버튼을 보여 주는 기기에서는 false입니다. */
    hints?: boolean;
    /** 마우스로 겨누는 위치(세계 좌표)입니다. 키보드로 겨누면 null입니다. */
    aim?: readonly [number, number] | null;
  },
): void {
  const box = fitView(s.width, s.height);
  const { scale, offsetX, offsetY } = box;
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, s.width, s.height);
  if (!(scale > 0)) return;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(offsetX, offsetY, TUNING.viewW * scale, TUNING.viewH * scale);

  // 화면이 작아도 선과 글자가 너무 가늘어지지 않게 합니다.
  const u = Math.max(0.62, Math.min(1.3, scale / 50));
  /** 세계 좌표에서 화면 1px(작은 화면에서는 보정한 굵기)에 해당하는 길이입니다. */
  const px = u / scale;
  const shake = s.effects.shake * SHAKE_REACH;
  const shakeX = Math.sin(s.time * 0.09) * shake;
  const shakeY = Math.cos(s.time * 0.12) * shake;

  ctx.save();
  ctx.translate(offsetX + shakeX * scale, offsetY + shakeY * scale);
  ctx.scale(scale, scale);
  const view = s.view;
  const map = view?.map ?? null;
  if (!view || !map) {
    drawBackdrop(ctx, s.time, px);
    ctx.restore();
    return;
  }
  const { poses } = s;
  drawShapes(ctx, map.shapes, px, poses.time, poses);
  for (const pose of poses.balls) if (pose.ball.alive) drawRope(ctx, pose, px);
  for (const pose of poses.arrows) {
    drawArrow(ctx, pose.arrow, pose.x, pose.y, ballColors(s.players, pose.arrow.owner).fill, px);
  }
  for (const pose of poses.balls) if (pose.ball.alive) drawTrail(ctx, pose, ballColors(s.players, pose.ball.id));
  for (const pose of poses.balls) if (pose.ball.alive) drawBall(ctx, pose, ballColors(s.players, pose.ball.id), px);
  const arrows = view.match.settings.mode === 'arrows' && view.match.phase === 'play';
  for (const pose of poses.balls) {
    if (!pose.ball.alive) continue;
    // 내 공은 화면이 흔들려도 마우스가 가리키는 곳을 향하게 합니다.
    const dir = s.aim && pose.ball.id === view.me ? toward(pose, s.aim[0] - shakeX, s.aim[1] - shakeY) : null;
    if (dir && arrows && !pose.ball.aim) drawAimGuide(ctx, pose, dir, px);
    drawAim(ctx, pose, px, dir);
  }
  drawEffects(ctx, s.effects, px);
  drawEdgeMarks(ctx, poses, view.me, s.players, s.time, px);
  ctx.restore();

  const rows = scoreRows(view, s.players);
  for (const pose of poses.balls) {
    if (!pose.ball.alive) continue;
    const row = rows.find((r) => r.id === pose.ball.id);
    const x = offsetX + (pose.x + shakeX) * scale;
    const top = offsetY + (pose.y + shakeY - TUNING.radius) * scale;
    drawName(ctx, x, top, row?.name ?? GONE_NAME, pose.ball.id === view.me, u);
  }

  const worldWidth = TUNING.viewW * scale;
  drawScoreboard(ctx, rows, view.match.settings.target, offsetX + worldWidth / 2, offsetY + 8 * u, u);
  const mode = MODES.find((m) => m.id === view.match.settings.mode)?.name ?? '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(13 * u)}px ${FONT}`;
  // 좁은 화면에서는 점수표와 겹치지 않게 한 줄 아래에 씁니다.
  const infoY = offsetY + (worldWidth >= 760 ? 25 : 58) * u;
  outlined(ctx, `${view.match.round} 라운드 · ${map.name} · ${mode}`, offsetX + 12 * u, infoY, TEXT_DIM, 3 * u);

  drawMessages(ctx, view, rows, box, u);
  if (s.hints && !view.watching) {
    drawHints(ctx, hintRows(view.match.settings.mode), {
      left: offsetX + 12 * u,
      bottom: offsetY + TUNING.viewH * scale - 10 * u,
      u,
      font: FONT,
      alpha: hintOpacity(view.match.phase, view.match.ms),
    });
  }
}
