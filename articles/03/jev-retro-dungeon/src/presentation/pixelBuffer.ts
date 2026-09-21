/**
 * Indexed-Color Pixel Buffer for Generative Monster Sprites
 * Clean Architecture - Presentation Layer
 *
 * DOMに依存しない純粋なピクセルグリッド。合成ロジック（コード配置・自動陰影・
 * 自動輪郭線）はここで完結させ、実際のCanvasへの転写はblitBufferToCanvas側に分離する。
 * これにより組成ロジックはCanvas無しの環境（vitest）でも単体テストできる。
 */

/** 1ピクセルに書き込む論理カラーコード（SNES風スプライトの限定パレット） */
export const PX = {
  EMPTY: 0,
  OUTLINE: 1,
  SHADOW_DEEP: 2,
  SHADOW: 3,
  BASE: 4,
  LIGHT: 5,
  HIGHLIGHT: 6,
  ACCENT_DEEP: 7,
  ACCENT: 8,
  ACCENT_LIGHT: 9,
  WHITE: 10,
  BLACK: 11,
  PUPIL: 12,
  GLOW: 13,
} as const;

export type PixelCode = (typeof PX)[keyof typeof PX];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export class PixelBuffer {
  readonly size: number;
  private readonly cells: Uint8Array;

  constructor(size: number) {
    this.size = size;
    this.cells = new Uint8Array(size * size);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return PX.EMPTY;
    return this.cells[y * this.size + x];
  }

  /** 1ドット書き込み。範囲外は無視（安全な座標計算ミスの吸収） */
  set(x: number, y: number, code: PixelCode): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!this.inBounds(ix, iy)) return;
    this.cells[iy * this.size + ix] = code;
  }

  /** 指定コード（および透明）以外のセルは上書きしない、という重ね塗り */
  setIfEmpty(x: number, y: number, code: PixelCode): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!this.inBounds(ix, iy)) return;
    const idx = iy * this.size + ix;
    if (this.cells[idx] === PX.EMPTY) this.cells[idx] = code;
  }

  toArray(): Uint8Array {
    return this.cells;
  }
}

// ---- 図形ジェネレータ（座標リストを返すだけの純粋関数） ----

export function rectPoints(x: number, y: number, w: number, h: number): Point[] {
  const pts: Point[] = [];
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      pts.push({ x: xx, y: yy });
    }
  }
  return pts;
}

/** 塗りつぶし楕円（中心cx,cy 半径rx,ry） */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Point[] {
  const pts: Point[] = [];
  const minY = Math.floor(cy - ry);
  const maxY = Math.ceil(cy + ry);
  for (let yy = minY; yy <= maxY; yy++) {
    const dy = (yy - cy) / ry;
    const t = 1 - dy * dy;
    if (t < 0) continue;
    const dx = rx * Math.sqrt(t);
    const minX = Math.round(cx - dx);
    const maxX = Math.round(cx + dx);
    for (let xx = minX; xx <= maxX; xx++) {
      pts.push({ x: xx, y: yy });
    }
  }
  return pts;
}

export function circlePoints(cx: number, cy: number, r: number): Point[] {
  return ellipsePoints(cx, cy, r, r);
}

/** 塗りつぶし三角形（スキャンライン法） */
export function trianglePoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): Point[] {
  const pts: Point[] = [];
  const minY = Math.floor(Math.min(y1, y2, y3));
  const maxY = Math.ceil(Math.max(y1, y2, y3));
  const edges: [number, number, number, number][] = [
    [x1, y1, x2, y2],
    [x2, y2, x3, y3],
    [x3, y3, x1, y1],
  ];
  for (let yy = minY; yy <= maxY; yy++) {
    const xs: number[] = [];
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (ey1 === ey2) continue;
      const lo = Math.min(ey1, ey2);
      const hi = Math.max(ey1, ey2);
      if (yy < lo || yy > hi) continue;
      const t = (yy - ey1) / (ey2 - ey1);
      xs.push(ex1 + (ex2 - ex1) * t);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const minX = Math.round(Math.min(...xs));
    const maxX = Math.round(Math.max(...xs));
    for (let xx = minX; xx <= maxX; xx++) pts.push({ x: xx, y: yy });
  }
  return pts;
}

export function diamondPoints(cx: number, cy: number, r: number): Point[] {
  const pts: Point[] = [];
  for (let yy = cy - r; yy <= cy + r; yy++) {
    const span = r - Math.abs(yy - cy);
    for (let xx = cx - span; xx <= cx + span; xx++) {
      pts.push({ x: xx, y: yy });
    }
  }
  return pts;
}

/** Bresenham直線（細いストローク：ひげ・棘・触角向け） */
export function linePoints(x1: number, y1: number, x2: number, y2: number): Point[] {
  const pts: Point[] = [];
  let cx = Math.round(x1);
  let cy = Math.round(y1);
  const ex = Math.round(x2);
  const ey = Math.round(y2);
  const dx = Math.abs(ex - cx);
  const dy = -Math.abs(ey - cy);
  const sx = cx < ex ? 1 : -1;
  const sy = cy < ey ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 200; i++) {
    pts.push({ x: cx, y: cy });
    if (cx === ex && cy === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
  return pts;
}

/** X軸(axisX)を中心に点群を左右反転コピーして合成する */
export function mirrorX(points: Point[], axisX: number): Point[] {
  return points.map((p) => ({ x: Math.round(2 * axisX - p.x), y: p.y }));
}

export function union(...groups: Point[][]): Point[] {
  return groups.flat();
}

// ---- 自動陰影・自動輪郭線 ----

export type ShadeBand = "primary" | "accent";

/**
 * 与えられた点群の輪郭（外側に隣接するセル）にOUTLINEを刻む。
 * パーツごとにこれを呼んでおくことで、後から重なる別パーツ（体の上の翼、
 * 頭の上の角など）が同系色でも境界線で分離され、シルエットが溶け合わない。
 * 隠れた部分（後続レイヤーに覆われる位置）は自然に上書きされ、
 * 露出した部分にだけ輪郭が残る。
 */
function stampSelfOutline(buffer: PixelBuffer, points: Point[]): void {
  const inShape = new Set<string>();
  for (const p of points) inShape.add(`${p.x},${p.y}`);
  const neighbors: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const p of points) {
    for (const [dx, dy] of neighbors) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!inShape.has(`${nx},${ny}`)) {
        buffer.set(nx, ny, PX.OUTLINE);
      }
    }
  }
}

/**
 * 点群のバウンディングボックスに対し、左上を光源とみなした方向勾配で
 * 自動的に5段階（またはaccent系は3段階）の階調バンドへ割り振って塗る。
 * どんな形状（体型・角・翼…）でも一貫した陰影ルールが適用される。
 * 塗る前に自己輪郭線（stampSelfOutline）を刻むため、隣接する別パーツとの
 * 境界が常に1ドットのラインで区切られる。
 */
export function paintShaded(buffer: PixelBuffer, points: Point[], band: ShadeBand = "primary"): void {
  if (points.length === 0) return;
  stampSelfOutline(buffer, points);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const primaryLevels: PixelCode[] = [PX.SHADOW_DEEP, PX.SHADOW, PX.BASE, PX.LIGHT, PX.HIGHLIGHT];
  const accentLevels: PixelCode[] = [PX.ACCENT_DEEP, PX.ACCENT, PX.ACCENT_LIGHT];
  const levels = band === "primary" ? primaryLevels : accentLevels;

  for (const p of points) {
    const u = (p.x - minX) / w; // 0=左, 1=右
    const v = (p.y - minY) / h; // 0=上, 1=下
    // 左上を光源とする（u,vが小さいほど明るい）
    const lightness = 1 - (u * 0.55 + v * 0.45);
    let idx = Math.floor(lightness * levels.length);
    idx = Math.max(0, Math.min(levels.length - 1, idx));
    buffer.set(p.x, p.y, levels[levels.length - 1 - idx]);
  }
}

/** 単色べた塗り（陰影不要な部位：瞳・牙・アクセントラインなど） */
export function paintFlat(buffer: PixelBuffer, points: Point[], code: PixelCode): void {
  for (const p of points) buffer.set(p.x, p.y, code);
}

/**
 * 不透明な全レイヤーを描き終えた後に最後に1回呼ぶ。
 * シルエットの外周1ドットにOUTLINEを自動生成し、パーツ間の輪郭を統一する。
 * GLOW（背景オーラ）はソフトな表現を保つため輪郭生成の対象から除外する。
 */
export function applyAutoOutline(buffer: PixelBuffer): void {
  const size = buffer.size;
  const solidAt = (x: number, y: number): boolean => {
    const c = buffer.get(x, y);
    return c !== PX.EMPTY && c !== PX.GLOW;
  };
  const toOutline: Point[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = buffer.get(x, y);
      if (c !== PX.EMPTY) continue;
      if (
        solidAt(x - 1, y) ||
        solidAt(x + 1, y) ||
        solidAt(x, y - 1) ||
        solidAt(x, y + 1)
      ) {
        toOutline.push({ x, y });
      }
    }
  }
  for (const p of toOutline) buffer.set(p.x, p.y, PX.OUTLINE);
}
