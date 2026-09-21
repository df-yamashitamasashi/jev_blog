/**
 * SNES-Style Color Ramp Generator
 * Clean Architecture - Presentation Layer
 *
 * DNAカタログのパレット(primary/secondary)から、16bit機（SNES）風の
 * 多段階トーンランプを決定論的に導出する。手打ちの色数を増やさず、
 * 一貫した陰影ルールを全パーツに適用するためのユーティリティ。
 */

export interface ColorRamp {
  readonly shadowDeep: string;
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly highlight: string;
  readonly accentDeep: string;
  readonly accent: string;
  readonly accentLight: string;
  readonly outline: string;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return [r, g, b];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => clamp255(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 0=完全に黒に寄せる, 1=元の色のまま */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = 1 - amount;
  return rgbToHex(r * t, g * t, b * t);
}

/** 0=元の色のまま, 1=完全に白に寄せる */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

export function mix(hexA: string, hexB: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/**
 * primary/secondaryの2色から、SNES風スプライトに必要な9段階のトーンを合成する。
 * - shadowDeep〜highlight: ボディ本体用の5段グラデーション（primary基調）
 * - accentDeep〜accentLight: 付属肢（角・翼・尾など）用の3段グラデーション（secondary基調）
 * - outline: シルエット輪郭用のほぼ黒（完全な黒だと浮くのでprimaryを微量混ぜる）
 */
export function buildRamp(primary: string, secondary: string): ColorRamp {
  return {
    shadowDeep: darken(primary, 0.68),
    shadow: darken(primary, 0.4),
    base: primary,
    light: mix(primary, secondary, 0.45),
    highlight: lighten(mix(primary, secondary, 0.6), 0.35),
    accentDeep: darken(secondary, 0.45),
    accent: secondary,
    accentLight: lighten(secondary, 0.4),
    outline: darken(mix(primary, "#000000", 0.3), 0.82),
  };
}

const rampCache = new Map<string, ColorRamp>();

/** primary+secondaryをキーにメモ化。同一パレットの再計算を避ける。 */
export function getRamp(primary: string, secondary: string): ColorRamp {
  const key = `${primary}|${secondary}`;
  let ramp = rampCache.get(key);
  if (!ramp) {
    ramp = buildRamp(primary, secondary);
    rampCache.set(key, ramp);
  }
  return ramp;
}
