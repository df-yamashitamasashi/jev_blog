/**
 * Generative Monster Horns / Headwear (12 types)
 * Clean Architecture - Presentation Layer
 */

import {
  PixelBuffer,
  PX,
  circlePoints,
  ellipsePoints,
  mirrorX,
  paintFlat,
  paintShaded,
  rectPoints,
  trianglePoints,
  union,
} from "../pixelBuffer";
import { BodyAnchors } from "./types";

function drawNone(): void {
  /* 何も描画しない */
}

/** drawType 1: 悪魔の曲がった角 */
function drawDemonHorns(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = Math.max(2, Math.round(a.headHalfWidth * 0.6));
  const right = union(
    trianglePoints(a.centerX + off - 1, a.headTop + 4, a.centerX + off + 2, a.headTop + 4, a.centerX + off, a.headTop - 1),
    trianglePoints(a.centerX + off, a.headTop - 1, a.centerX + off + 3, a.headTop - 1, a.centerX + off + 1, a.headTop - 4)
  );
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 2: 一本の螺旋角 */
function drawUnicorn(buffer: PixelBuffer, a: BodyAnchors): void {
  const horn = trianglePoints(a.centerX - 1, a.headTop + 2, a.centerX + 1, a.headTop + 2, a.centerX, a.headTop - 8);
  paintShaded(buffer, horn, "accent");
}

/** drawType 3: 鹿角（枝分かれ） */
function drawAntler(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = Math.max(2, Math.round(a.headHalfWidth * 0.6));
  const right = union(
    rectPoints(a.centerX + off, a.headTop - 5, 1, 6),
    trianglePoints(a.centerX + off, a.headTop - 5, a.centerX + off + 3, a.headTop - 6, a.centerX + off + 3, a.headTop - 4),
    trianglePoints(a.centerX + off, a.headTop - 2, a.centerX + off + 3, a.headTop - 3, a.centerX + off + 3, a.headTop - 1)
  );
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 4: 骨の王冠 */
function drawCrown(buffer: PixelBuffer, a: BodyAnchors): void {
  const band = rectPoints(a.centerX - a.headHalfWidth, a.headTop - 1, a.headHalfWidth * 2, 2);
  const spikes: { x: number; y: number }[][] = [];
  for (let i = -2; i <= 2; i++) {
    spikes.push(trianglePoints(a.centerX + i * 3 - 1, a.headTop - 1, a.centerX + i * 3 + 1, a.headTop - 1, a.centerX + i * 3, a.headTop - 5));
  }
  paintShaded(buffer, union(band, ...spikes), "accent");
}

/** drawType 5: 猫のような尖った耳 */
function drawEarsCat(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = a.headHalfWidth - 1;
  const right = trianglePoints(a.centerX + off - 1, a.headTop + 3, a.centerX + off + 3, a.headTop + 3, a.centerX + off + 1, a.headTop - 2);
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 6: コウモリ状のレーダー耳 */
function drawEarsBat(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = a.headHalfWidth;
  const right = trianglePoints(a.centerX + off - 2, a.headTop + 4, a.centerX + off + 4, a.headTop + 1, a.centerX + off, a.headTop - 3);
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 7: 頭蓋の棘 */
function drawSpikes(buffer: PixelBuffer, a: BodyAnchors): void {
  const spikes: { x: number; y: number }[][] = [];
  for (let i = -1; i <= 1; i++) {
    spikes.push(trianglePoints(a.centerX + i * 4 - 1, a.headTop + 2, a.centerX + i * 4 + 1, a.headTop + 2, a.centerX + i * 4, a.headTop - 4));
  }
  paintShaded(buffer, union(...spikes), "accent");
}

/** drawType 8: 羽根の冠飾り */
function drawFeatherCrest(buffer: PixelBuffer, a: BodyAnchors): void {
  const feathers = union(
    trianglePoints(a.centerX - 1, a.headTop + 2, a.centerX + 1, a.headTop + 2, a.centerX - 2, a.headTop - 6),
    trianglePoints(a.centerX - 1, a.headTop + 2, a.centerX + 1, a.headTop + 2, a.centerX, a.headTop - 8),
    trianglePoints(a.centerX - 1, a.headTop + 2, a.centerX + 1, a.headTop + 2, a.centerX + 2, a.headTop - 6)
  );
  paintShaded(buffer, feathers, "accent");
}

/** drawType 9: バイキングの兜 */
function drawHelmet(buffer: PixelBuffer, a: BodyAnchors): void {
  const cap = ellipsePoints(a.centerX, a.headTop + 1, a.headHalfWidth + 1, 3);
  const off = a.headHalfWidth + 1;
  const right = trianglePoints(a.centerX + off - 2, a.headTop + 2, a.centerX + off + 3, a.headTop, a.centerX + off, a.headTop - 4);
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(cap, left, right), "accent");
}

/** drawType 10: 祝福の後光（頭上に浮くリング） */
function drawHalo(buffer: PixelBuffer, a: BodyAnchors): void {
  const outer = circlePoints(a.centerX, a.headTop - 4, a.headHalfWidth);
  const inner = circlePoints(a.centerX, a.headTop - 4, a.headHalfWidth - 1);
  const ring = outer.filter((p) => !inner.some((q) => q.x === p.x && q.y === p.y));
  paintFlat(buffer, ring, PX.ACCENT_LIGHT);
}

/** drawType 11: 破城槌のような一対の巨角 */
function drawRam(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = Math.max(2, Math.round(a.headHalfWidth * 0.7));
  const right = union(
    trianglePoints(a.centerX + off - 1, a.headTop + 5, a.centerX + off + 4, a.headTop + 3, a.centerX + off + 1, a.headTop - 1),
    trianglePoints(a.centerX + off + 1, a.headTop - 1, a.centerX + off + 5, a.headTop - 3, a.centerX + off + 2, a.headTop - 5)
  );
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

const HORN_DRAWERS: ((buffer: PixelBuffer, a: BodyAnchors) => void)[] = [
  drawNone,
  drawDemonHorns,
  drawUnicorn,
  drawAntler,
  drawCrown,
  drawEarsCat,
  drawEarsBat,
  drawSpikes,
  drawFeatherCrest,
  drawHelmet,
  drawHalo,
  drawRam,
];

export function drawHorns(buffer: PixelBuffer, a: BodyAnchors, drawType: number): void {
  const drawer = HORN_DRAWERS[drawType] ?? drawNone;
  drawer(buffer, a);
}
