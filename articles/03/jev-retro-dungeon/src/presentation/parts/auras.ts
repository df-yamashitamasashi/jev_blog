/**
 * Generative Monster Auras (8 types)
 * Clean Architecture - Presentation Layer
 *
 * 全レイヤーの一番下（背景）に描くソフトな魔力エフェクト。
 * pulse(0..2)でアニメーションの明滅・拡縮フェーズを受け取る。
 */

import { PixelBuffer, PX, circlePoints, diamondPoints, paintFlat } from "../pixelBuffer";
import { BodyAnchors } from "./types";

function drawNone(): void {
  /* 何も描画しない */
}

function center(a: BodyAnchors): { x: number; y: number } {
  return { x: a.centerX, y: Math.round((a.headTop + a.groundLine) / 2) };
}

/**
 * オーラ半径の上限。体格（torsoHalfWidth）に単純比例させるとキャンバス全体を
 * 覆ってシルエットを飲み込んでしまうため、シルエットの少し外側をなぞる
 * 「薄い後光」程度に収める。
 */
const AURA_MAX_RADIUS = 13;
function auraRadius(a: BodyAnchors, pad: number): number {
  return Math.min(AURA_MAX_RADIUS, a.torsoHalfWidth + pad);
}

/** drawType 1: 紅蓮の業火オーラ（揺らめく炎の粒） */
function drawFlame(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 2) + (pulse === 1 ? 1 : 0);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  const flicks: { x: number; y: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + pulse * 0.4;
    flicks.push({ x: Math.round(c.x + Math.cos(ang) * r * 0.8), y: Math.round(c.y + Math.sin(ang) * r * 0.8) });
  }
  paintFlat(buffer, flicks, PX.ACCENT);
}

/** drawType 2: 氷結の霧オーラ（結晶片） */
function drawFrost(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 2);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  const shards: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const rr = r * (0.7 + 0.15 * ((i + pulse) % 2));
    shards.push(...diamondPoints(Math.round(c.x + Math.cos(ang) * rr), Math.round(c.y + Math.sin(ang) * rr), 1));
  }
  paintFlat(buffer, shards, PX.ACCENT_LIGHT);
}

/** drawType 3: 放電するプラズマオーラ（稲妻の弧） */
function drawThunder(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 2);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  if (pulse !== 1) {
    const bolt = [
      { x: c.x - r, y: c.y - r + 2 },
      { x: c.x - r + 2, y: c.y - 1 },
      { x: c.x + r - 2, y: c.y + 1 },
      { x: c.x + r, y: c.y + r - 2 },
    ];
    paintFlat(buffer, bolt, PX.ACCENT_LIGHT);
  }
}

/** drawType 4: 虚空の渦オーラ（螺旋の粒子） */
function drawShadowAura(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 2);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  const spiral: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 4 + pulse * 0.6;
    const rr = (i / 10) * r;
    spiral.push({ x: Math.round(c.x + Math.cos(ang) * rr), y: Math.round(c.y + Math.sin(ang) * rr) });
  }
  paintFlat(buffer, spiral, PX.ACCENT_DEEP);
}

/** drawType 5: 聖なる光条オーラ */
function drawHoly(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 3);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  const rays: { x: number; y: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + (pulse === 2 ? 0.2 : 0);
    for (let d = r - 4; d < r + 2; d++) {
      rays.push({ x: Math.round(c.x + Math.cos(ang) * d), y: Math.round(c.y + Math.sin(ang) * d) });
    }
  }
  paintFlat(buffer, rays, PX.ACCENT_LIGHT);
}

/** drawType 6: 瘴気の雲オーラ（泡状） */
function drawPoison(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 2);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  const bubbles: { x: number; y: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + pulse * 0.3;
    bubbles.push(...circlePoints(Math.round(c.x + Math.cos(ang) * r * 0.75), Math.round(c.y + Math.sin(ang) * r * 0.75), 1));
  }
  paintFlat(buffer, bubbles, PX.ACCENT);
}

/** drawType 7: 星雲のコズミックオーラ（星屑） */
function drawCosmic(buffer: PixelBuffer, a: BodyAnchors, pulse: number): void {
  const c = center(a);
  const r = auraRadius(a, 3);
  paintFlat(buffer, circlePoints(c.x, c.y, r), PX.GLOW);
  const stars: { x: number; y: number }[] = [];
  const seedCount = 9;
  for (let i = 0; i < seedCount; i++) {
    const ang = (i * 2.399) + pulse * 0.5; // 黄金角で疑似ランダムに散らす
    const rr = r * ((i % 5) / 5 + 0.2);
    stars.push({ x: Math.round(c.x + Math.cos(ang) * rr), y: Math.round(c.y + Math.sin(ang) * rr) });
  }
  paintFlat(buffer, stars, PX.ACCENT_LIGHT);
}

const AURA_DRAWERS: ((buffer: PixelBuffer, a: BodyAnchors, pulse: number) => void)[] = [
  drawNone,
  drawFlame,
  drawFrost,
  drawThunder,
  drawShadowAura,
  drawHoly,
  drawPoison,
  drawCosmic,
];

export function drawAura(buffer: PixelBuffer, a: BodyAnchors, drawType: number, pulse: number = 0): void {
  const drawer = AURA_DRAWERS[drawType] ?? drawNone;
  drawer(buffer, a, pulse);
}
