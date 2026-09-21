/**
 * Generative Monster Eyes (12 types)
 * Clean Architecture - Presentation Layer
 */

import {
  PixelBuffer,
  PX,
  diamondPoints,
  ellipsePoints,
  mirrorX,
  paintFlat,
  rectPoints,
  trianglePoints,
  union,
} from "../pixelBuffer";
import { BodyAnchors } from "./types";

function eyeOffset(a: BodyAnchors): number {
  return Math.max(2, Math.round(a.headHalfWidth * 0.5));
}

/** drawType 0: まる目（標準） */
function drawNormal(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const white = union(
    ellipsePoints(a.centerX - off, a.eyeLine, 2, 2),
    ellipsePoints(a.centerX + off, a.eyeLine, 2, 2)
  );
  paintFlat(buffer, white, PX.WHITE);
  paintFlat(buffer, [
    { x: a.centerX - off, y: a.eyeLine },
    { x: a.centerX + off, y: a.eyeLine },
  ], PX.PUPIL);
}

/** drawType 1: 鋭い吊り目 */
function drawGlare(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const right = trianglePoints(a.centerX + off - 2, a.eyeLine + 1, a.centerX + off + 3, a.eyeLine - 1, a.centerX + off + 3, a.eyeLine + 1);
  const left = mirrorX(right, a.centerX);
  paintFlat(buffer, union(left, right), PX.PUPIL);
}

/** drawType 2: サイクロプス（単眼、中央巨大） */
function drawCyclops(buffer: PixelBuffer, a: BodyAnchors): void {
  const white = ellipsePoints(a.centerX, a.eyeLine, 4, 3);
  paintFlat(buffer, white, PX.WHITE);
  paintFlat(buffer, ellipsePoints(a.centerX, a.eyeLine, 2, 2), PX.PUPIL);
}

/** drawType 3: 目隠し（横一文字の帯） */
function drawBlind(buffer: PixelBuffer, a: BodyAnchors): void {
  const band = rectPoints(a.centerX - a.headHalfWidth + 1, a.eyeLine - 1, (a.headHalfWidth - 1) * 2, 2);
  paintFlat(buffer, band, PX.BLACK);
}

/** drawType 4: 光るルビー（発光する小さな瞳） */
function drawLaser(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const glow = union(
    diamondPoints(a.centerX - off, a.eyeLine, 2),
    diamondPoints(a.centerX + off, a.eyeLine, 2)
  );
  paintFlat(buffer, glow, PX.ACCENT_LIGHT);
  paintFlat(buffer, [
    { x: a.centerX - off, y: a.eyeLine },
    { x: a.centerX + off, y: a.eyeLine },
  ], PX.PUPIL);
}

/** drawType 5: 虚ろな眼窩（白目なし・黒のみ） */
function drawVoid(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const sockets = union(
    ellipsePoints(a.centerX - off, a.eyeLine, 2, 2),
    ellipsePoints(a.centerX + off, a.eyeLine, 2, 2)
  );
  paintFlat(buffer, sockets, PX.BLACK);
}

/** drawType 6: 蜘蛛の複眼（小さな粒が集合） */
function drawMulti(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const cluster: { x: number; y: number }[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      cluster.push({ x: a.centerX + side * (off + (i % 2)), y: a.eyeLine - 1 + i });
    }
  }
  paintFlat(buffer, cluster, PX.PUPIL);
}

/** drawType 7: 猫の縦スリット瞳孔 */
function drawCat(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const white = union(
    ellipsePoints(a.centerX - off, a.eyeLine, 2, 2),
    ellipsePoints(a.centerX + off, a.eyeLine, 2, 2)
  );
  paintFlat(buffer, white, PX.WHITE);
  paintFlat(buffer, [
    { x: a.centerX - off, y: a.eyeLine - 1 },
    { x: a.centerX - off, y: a.eyeLine },
    { x: a.centerX - off, y: a.eyeLine + 1 },
    { x: a.centerX + off, y: a.eyeLine - 1 },
    { x: a.centerX + off, y: a.eyeLine },
    { x: a.centerX + off, y: a.eyeLine + 1 },
  ], PX.PUPIL);
}

/** drawType 8: 燃え盛る眼（雫型の炎） */
function drawFiery(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const flame = union(
    trianglePoints(a.centerX - off - 2, a.eyeLine + 2, a.centerX - off + 2, a.eyeLine + 2, a.centerX - off, a.eyeLine - 2),
    trianglePoints(a.centerX + off - 2, a.eyeLine + 2, a.centerX + off + 2, a.eyeLine + 2, a.centerX + off, a.eyeLine - 2)
  );
  paintFlat(buffer, flame, PX.ACCENT_LIGHT);
  paintFlat(buffer, [
    { x: a.centerX - off, y: a.eyeLine },
    { x: a.centerX + off, y: a.eyeLine },
  ], PX.PUPIL);
}

/** drawType 9: 氷結晶（ひし形の結晶） */
function drawFrost(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const crystals = union(
    diamondPoints(a.centerX - off, a.eyeLine, 2),
    diamondPoints(a.centerX + off, a.eyeLine, 2)
  );
  paintFlat(buffer, crystals, PX.WHITE);
  paintFlat(buffer, [
    { x: a.centerX - off, y: a.eyeLine },
    { x: a.centerX + off, y: a.eyeLine },
  ], PX.ACCENT_LIGHT);
}

/** drawType 10: 黄金の神眼（大きく光条付き） */
function drawDivine(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const glow = union(
    diamondPoints(a.centerX - off, a.eyeLine, 3),
    diamondPoints(a.centerX + off, a.eyeLine, 3)
  );
  paintFlat(buffer, glow, PX.ACCENT_LIGHT);
  const core = union(
    ellipsePoints(a.centerX - off, a.eyeLine, 1, 1),
    ellipsePoints(a.centerX + off, a.eyeLine, 1, 1)
  );
  paintFlat(buffer, core, PX.PUPIL);
}

/** drawType 11: 深淵の火花（漆黒の中に一点の光） */
function drawShadow(buffer: PixelBuffer, a: BodyAnchors): void {
  const off = eyeOffset(a);
  const sockets = union(
    ellipsePoints(a.centerX - off, a.eyeLine, 2, 2),
    ellipsePoints(a.centerX + off, a.eyeLine, 2, 2)
  );
  paintFlat(buffer, sockets, PX.BLACK);
  paintFlat(buffer, [
    { x: a.centerX - off, y: a.eyeLine },
    { x: a.centerX + off, y: a.eyeLine },
  ], PX.PUPIL);
}

const EYE_DRAWERS: ((buffer: PixelBuffer, a: BodyAnchors) => void)[] = [
  drawNormal,
  drawGlare,
  drawCyclops,
  drawBlind,
  drawLaser,
  drawVoid,
  drawMulti,
  drawCat,
  drawFiery,
  drawFrost,
  drawDivine,
  drawShadow,
];

export function drawEyes(buffer: PixelBuffer, a: BodyAnchors, drawType: number): void {
  const drawer = EYE_DRAWERS[drawType] ?? drawNormal;
  drawer(buffer, a);
}

/** 瞳孔の発色（PX.PUPILの解決色）をdrawTypeごとに決める */
export function pupilColorFor(drawType: number, ramp: { accent: string; accentLight: string }): string {
  switch (drawType) {
    case 4: // laser (ruby)
      return "#ff2222";
    case 8: // fiery
      return "#ff6a1a";
    case 10: // divine
      return "#ffd700";
    case 9: // frost
      return ramp.accentLight;
    case 11: // shadow spark
      return "#e8e8ff";
    default:
      return "#0a0a0a";
  }
}
