import { TUNING } from '../game/modes';

/** 탈락할 때 퍼지는 조각 하나입니다. 좌표는 미터입니다. */
export interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

/** 탈락 지점에서 퍼지는 고리 하나입니다. */
export interface Ring {
  x: number;
  y: number;
  life: number;
  color: string;
}

/** 충돌 지점에서 튀는 불꽃 하나입니다. */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

/** 조각이 보이는 시간(초)입니다. */
export const SHARD_LIFE = 0.6;
/** 탈락할 때 나오는 조각 수입니다. */
export const SHARD_COUNT = 12;
/** 센 충돌에 화면이 흔들리는 시간(초)입니다. */
export const SHAKE_TIME = 0.15;
/** 충돌 세기가 이보다 클 때만 화면을 흔듭니다. */
export const SHAKE_MIN = 0.6;

/** 불꽃이 보이는 시간(초)입니다. */
export const SPARK_LIFE = 0.26;
/** 한꺼번에 보이는 불꽃 수의 상한입니다. 넘으면 새 불꽃을 만들지 않습니다. */
export const SPARK_MAX = 72;
/** 충돌 세기가 이보다 클 때만 불꽃이 튑니다. */
export const SPARK_MIN = 0.25;
/** 세기 1인 충돌 한 번에 튀는 불꽃 수입니다. */
export const SPARK_COUNT = 10;

/** 그 세기의 충돌 한 번에 튀는 불꽃 수입니다. */
export function sparkCount(strength: number): number {
  if (!(strength > SPARK_MIN)) return 0;
  return Math.round(2 + (SPARK_COUNT - 2) * Math.min(1, strength));
}

/** 탈락 조각, 충돌 불꽃, 화면 흔들림. 겉모습에만 쓰며 경기 결과에는 영향을 주지 않습니다. */
export class Effects {
  shards: Shard[] = [];
  rings: Ring[] = [];
  sparks: Spark[] = [];
  /** 움직임 줄이기 설정입니다. 켜져 있으면 화면을 흔들지 않습니다. */
  reduced = false;
  private shakeLeft = 0;

  /** 탈락 지점에 그 공 색의 조각을 퍼뜨립니다. 화면 밖에서 탈락했으면 가장 가까운 화면 안쪽에 둡니다. */
  out(x: number, y: number, color: string): void {
    const cx = Math.max(0.5, Math.min(TUNING.viewW - 0.5, x));
    const cy = Math.max(0.5, Math.min(TUNING.viewH - 0.5, y));
    for (let i = 0; i < SHARD_COUNT; i++) {
      // 겉모습에만 쓰는 값이라 Math.random을 그대로 씁니다.
      const angle = (Math.PI * 2 * i) / SHARD_COUNT + Math.random() * 0.4;
      const speed = 4 + Math.random() * 5;
      this.shards.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: SHARD_LIFE,
        color,
      });
    }
    this.rings.push({ x: cx, y: cy, life: SHARD_LIFE, color });
  }

  /** 충돌이 셌으면 화면을 잠깐 흔듭니다. */
  hit(strength: number): void {
    if (strength > SHAKE_MIN && !this.reduced) this.shakeLeft = SHAKE_TIME;
  }

  /**
   * 충돌 지점 (x, y)에서 불꽃을 튀깁니다. (nx, ny)는 부딪친 방향이고, 불꽃은 그 옆쪽으로 퍼집니다.
   * 수와 빠르기는 세기(0~1)에 비례합니다.
   */
  spark(x: number, y: number, nx: number, ny: number, strength: number, color: string): void {
    const count = Math.min(sparkCount(strength), SPARK_MAX - this.sparks.length);
    const across = Math.atan2(ny, nx) + Math.PI / 2;
    for (let i = 0; i < count; i++) {
      const angle = across + (i % 2) * Math.PI + (Math.random() - 0.5) * 1.5;
      const speed = (3 + Math.random() * 6) * (0.5 + strength);
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: SPARK_LIFE, color });
    }
  }

  /** 흔들림이 남은 정도(0~1)입니다. */
  get shake(): number {
    return this.reduced ? 0 : this.shakeLeft / SHAKE_TIME;
  }

  update(seconds: number): void {
    for (const s of this.shards) {
      s.x += s.vx * seconds;
      s.y += s.vy * seconds;
      s.vy += TUNING.gravity * 0.5 * seconds;
      s.life -= seconds;
    }
    for (const r of this.rings) r.life -= seconds;
    // 불꽃은 자주 생기므로 배열을 새로 만들지 않고 끝난 것의 자리를 마지막 것으로 메웁니다.
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx * seconds;
      s.y += s.vy * seconds;
      s.vy += TUNING.gravity * 0.5 * seconds;
      s.life -= seconds;
      if (s.life > 0) continue;
      this.sparks[i] = this.sparks[this.sparks.length - 1];
      this.sparks.pop();
    }
    this.shards = this.shards.filter((s) => s.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
    this.shakeLeft = Math.max(0, this.shakeLeft - seconds);
  }

  clear(): void {
    this.shards = [];
    this.rings = [];
    this.sparks.length = 0;
    this.shakeLeft = 0;
  }
}
