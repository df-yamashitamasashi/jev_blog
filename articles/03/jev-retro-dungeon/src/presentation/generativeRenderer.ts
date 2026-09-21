/**
 * Generative Monster Pixel Art Renderer (SNES-style Layered Sprite Composer)
 * Clean Architecture - Presentation Layer
 *
 * DNAの8遺伝子スロットを、32x32のインデックスカラーバッファへレイヤー順に
 * 合成し（アンカー接続・自動陰影・自動輪郭線付き）、最後にCanvasへ焼き込む。
 * 合成結果（PixelBuffer）はスプライトキャッシュに保存し、アニメーション
 * フレームごとの再計算コストを抑える。
 */

import { MonsterDNA, DNA_CATALOG } from "../domain/dnaModels";
import { getRamp, ColorRamp } from "./colorRamp";
import { applyAutoOutline, PixelBuffer, PX } from "./pixelBuffer";
import { GRID_SIZE } from "./parts/types";
import { drawBody } from "./parts/bodies";
import { drawEyes, pupilColorFor } from "./parts/eyes";
import { drawMouth } from "./parts/mouths";
import { drawHorns } from "./parts/horns";
import { drawWings } from "./parts/wings";
import { drawTail } from "./parts/tails";
import { drawAura } from "./parts/auras";

export interface MonsterAnimState {
  readonly bob: 0 | 1;
  readonly flap: 0 | 1;
  readonly pulse: 0 | 1 | 2;
}

export function animStateForFrame(frame: number): MonsterAnimState {
  return {
    bob: (Math.floor(frame / 8) % 2) as 0 | 1,
    flap: (Math.floor(frame / 6) % 2) as 0 | 1,
    pulse: (Math.floor(frame / 10) % 3) as 0 | 1 | 2,
  };
}

function partIndex<T extends { id: string }>(catalog: readonly T[], geneId: string): number {
  const idx = catalog.findIndex((p) => p.id === geneId);
  return idx >= 0 ? idx : 0;
}

/**
 * DNAからピクセルバッファを合成する（DOM非依存・純粋関数）。
 * gallery/testからも直接呼べるようexportする。
 */
export function composeMonsterBuffer(dna: MonsterDNA, anim: MonsterAnimState = { bob: 0, flap: 0, pulse: 0 }): PixelBuffer {
  const buffer = new PixelBuffer(GRID_SIZE);

  const bodyType = partIndex(DNA_CATALOG.bodies, dna.bodyGene);
  const eyesType = partIndex(DNA_CATALOG.eyes, dna.eyesGene);
  const mouthType = partIndex(DNA_CATALOG.mouths, dna.mouthGene);
  const hornsType = partIndex(DNA_CATALOG.horns, dna.hornsGene);
  const wingsType = partIndex(DNA_CATALOG.wings, dna.wingsGene);
  const tailType = partIndex(DNA_CATALOG.tails, dna.tailGene);
  const auraType = partIndex(DNA_CATALOG.auras, dna.auraGene);

  // 1. 背景オーラ（最背面）
  const anchorsProbe = drawBody(new PixelBuffer(GRID_SIZE), bodyType); // アンカー先読み用の使い捨てバッファ
  drawAura(buffer, anchorsProbe, auraType, anim.pulse);

  // 2. 翼（体の後ろ側になる分だけ先に敷く）
  drawWings(buffer, anchorsProbe, wingsType, anim.flap);

  // 3. 本体（実際にシルエットを確定させる）
  const anchors = drawBody(buffer, bodyType);

  // 4. 尾
  drawTail(buffer, anchors, tailType, anim.flap);

  // 5. 角・頭部装飾
  drawHorns(buffer, anchors, hornsType);

  // 6. 口
  drawMouth(buffer, anchors, mouthType);

  // 7. 目（最前面の表情要素）
  drawEyes(buffer, anchors, eyesType);

  // 8. 全レイヤー確定後に輪郭線を自動生成
  applyAutoOutline(buffer);

  return buffer;
}

function resolveColor(code: number, ramp: ColorRamp, pupilColor: string, glowColor: string): string | null {
  switch (code) {
    case PX.EMPTY:
      return null;
    case PX.OUTLINE:
      return ramp.outline;
    case PX.SHADOW_DEEP:
      return ramp.shadowDeep;
    case PX.SHADOW:
      return ramp.shadow;
    case PX.BASE:
      return ramp.base;
    case PX.LIGHT:
      return ramp.light;
    case PX.HIGHLIGHT:
      return ramp.highlight;
    case PX.ACCENT_DEEP:
      return ramp.accentDeep;
    case PX.ACCENT:
      return ramp.accent;
    case PX.ACCENT_LIGHT:
      return ramp.accentLight;
    case PX.WHITE:
      return "#f8f8f8";
    case PX.BLACK:
      return "#0a0a0a";
    case PX.PUPIL:
      return pupilColor;
    case PX.GLOW:
      return glowColor;
    default:
      return null;
  }
}

interface CacheEntry {
  canvas: HTMLCanvasElement;
  lastUsed: number;
}

const SPRITE_CACHE_LIMIT = 96;
const spriteCache = new Map<string, CacheEntry>();
let tick = 0;

function evictOldestIfNeeded(): void {
  if (spriteCache.size <= SPRITE_CACHE_LIMIT) return;
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of spriteCache) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) spriteCache.delete(oldestKey);
}

function buildSpriteCanvas(dna: MonsterDNA, anim: MonsterAnimState): HTMLCanvasElement {
  const buffer = composeMonsterBuffer(dna, anim);
  const palette = DNA_CATALOG.palettes.find((p) => p.id === dna.paletteGene) || DNA_CATALOG.palettes[0];
  const ramp = getRamp(palette.primary, palette.secondary);
  const eyesType = partIndex(DNA_CATALOG.eyes, dna.eyesGene);
  const pupilColor = pupilColorFor(eyesType, ramp);

  const canvas = document.createElement("canvas");
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const cells = buffer.toArray();
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const code = cells[y * GRID_SIZE + x];
      const color = resolveColor(code, ramp, pupilColor, palette.glow);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

function getSprite(dna: MonsterDNA, anim: MonsterAnimState): HTMLCanvasElement {
  const key = `${dna.dnaHash}_${anim.flap}_${anim.pulse}`;
  tick += 1;
  const cached = spriteCache.get(key);
  if (cached) {
    cached.lastUsed = tick;
    return cached.canvas;
  }
  const canvas = buildSpriteCanvas(dna, anim);
  spriteCache.set(key, { canvas, lastUsed: tick });
  evictOldestIfNeeded();
  return canvas;
}

export class GenerativeMonsterRenderer {
  /**
   * 8スロットのDNAから合成したモンスターのドット絵をCanvasへ描画する。
   * frameを渡すと呼吸・羽ばたき・オーラ明滅のアイドルアニメーションが再生される。
   */
  static renderMonster(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    dna: MonsterDNA,
    scale = 2.4,
    frame = 0
  ): void {
    const anim = animStateForFrame(frame);
    const sprite = getSprite(dna, anim);

    const drawSize = GRID_SIZE * scale;
    const bobPx = anim.bob ? scale : 0;
    const dx = cx - drawSize / 2;
    const dy = cy - drawSize / 2 - bobPx;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, 0, 0, GRID_SIZE, GRID_SIZE, dx, dy, drawSize, drawSize);
    ctx.restore();
  }

  /** スプライトキャッシュを破棄する（主にテスト・ギャラリー用） */
  static clearCache(): void {
    spriteCache.clear();
  }
}
