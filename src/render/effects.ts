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

/** 조각이 보이는 시간(초)입니다. */
export const SHARD_LIFE = 0.6;
/** 탈락할 때 나오는 조각 수입니다. */
export const SHARD_COUNT = 12;
/** 센 충돌에 화면이 흔들리는 시간(초)입니다. */
export const SHAKE_TIME = 0.15;
/** 충돌 세기가 이보다 클 때만 화면을 흔듭니다. */
export const SHAKE_MIN = 0.6;

/** 탈락 조각과 화면 흔들림. 겉모습에만 쓰며 경기 결과에는 영향을 주지 않습니다. */
export class Effects {
  shards: Shard[] = [];
  rings: Ring[] = [];
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
    if (strength > SHAKE_MIN) this.shakeLeft = SHAKE_TIME;
  }

  /** 흔들림이 남은 정도(0~1)입니다. */
  get shake(): number {
    return this.shakeLeft / SHAKE_TIME;
  }

  update(seconds: number): void {
    for (const s of this.shards) {
      s.x += s.vx * seconds;
      s.y += s.vy * seconds;
      s.vy += TUNING.gravity * 0.5 * seconds;
      s.life -= seconds;
    }
    for (const r of this.rings) r.life -= seconds;
    this.shards = this.shards.filter((s) => s.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
    this.shakeLeft = Math.max(0, this.shakeLeft - seconds);
  }

  clear(): void {
    this.shards = [];
    this.rings = [];
    this.shakeLeft = 0;
  }
}
