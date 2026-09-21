/**
 * Generative Monster Mouths (10 types)
 * Clean Architecture - Presentation Layer
 */

import { PixelBuffer, PX, mirrorX, paintFlat, rectPoints, trianglePoints, union } from "../pixelBuffer";
import { BodyAnchors } from "./types";

/** drawType 0: 鋭い三日月の笑み */
function drawSmile(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(3, Math.round(a.headHalfWidth * 0.7));
  paintFlat(buffer, rectPoints(a.centerX - w, a.mouthLine, w * 2, 1), PX.BLACK);
  paintFlat(buffer, [
    { x: a.centerX - w, y: a.mouthLine + 1 },
    { x: a.centerX + w - 1, y: a.mouthLine + 1 },
  ], PX.BLACK);
}

/** drawType 1: 吸血牙 */
function drawFangs(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(2, Math.round(a.headHalfWidth * 0.5));
  paintFlat(buffer, rectPoints(a.centerX - w, a.mouthLine, w * 2, 1), PX.BLACK);
  const fangR = trianglePoints(a.centerX + w - 2, a.mouthLine, a.centerX + w, a.mouthLine, a.centerX + w - 1, a.mouthLine + 3);
  const fangL = mirrorX(fangR, a.centerX);
  paintFlat(buffer, union(fangL, fangR), PX.WHITE);
}

/** drawType 2: 甲殻の顎（左右非対称に開く大顎） */
function drawMandible(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(3, Math.round(a.headHalfWidth * 0.7));
  const right = trianglePoints(a.centerX, a.mouthLine, a.centerX + w, a.mouthLine - 1, a.centerX + w, a.mouthLine + 2);
  const left = mirrorX(right, a.centerX);
  paintFlat(buffer, union(left, right), PX.ACCENT);
}

/** drawType 3: 捕食者のくちばし */
function drawBeak(buffer: PixelBuffer, a: BodyAnchors): void {
  const beak = trianglePoints(a.centerX - 3, a.mouthLine - 1, a.centerX + 3, a.mouthLine - 1, a.centerX, a.mouthLine + 3);
  paintFlat(buffer, beak, PX.ACCENT);
}

/** drawType 4: 深淵の大顎（3本の牙付き） */
function drawMaw(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(4, Math.round(a.headHalfWidth * 0.85));
  paintFlat(buffer, rectPoints(a.centerX - w, a.mouthLine, w * 2, 3), PX.BLACK);
  const fangs: { x: number; y: number }[] = [];
  for (let i = -1; i <= 1; i++) {
    fangs.push({ x: a.centerX + i * Math.round(w * 0.7), y: a.mouthLine + 1 });
    fangs.push({ x: a.centerX + i * Math.round(w * 0.7), y: a.mouthLine + 2 });
  }
  paintFlat(buffer, fangs, PX.WHITE);
}

/** drawType 5: 毒の舌（口の外まで垂れる） */
function drawTongue(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(2, Math.round(a.headHalfWidth * 0.5));
  paintFlat(buffer, rectPoints(a.centerX - w, a.mouthLine, w * 2, 1), PX.BLACK);
  paintFlat(buffer, rectPoints(a.centerX - 1, a.mouthLine + 1, 1, 4), PX.ACCENT_LIGHT);
}

/** drawType 6: 鉄格子の口 */
function drawIron(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(3, Math.round(a.headHalfWidth * 0.7));
  const bars: { x: number; y: number }[] = [];
  for (let x = a.centerX - w; x <= a.centerX + w; x += 2) {
    bars.push({ x, y: a.mouthLine }, { x, y: a.mouthLine + 1 }, { x, y: a.mouthLine + 2 });
  }
  paintFlat(buffer, bars, PX.ACCENT_DEEP);
}

/** drawType 7: 触手の口（放射状に伸びる小触手） */
function drawTentacle(buffer: PixelBuffer, a: BodyAnchors): void {
  const stubs: { x: number; y: number }[] = [];
  for (let i = -2; i <= 2; i++) {
    stubs.push({ x: a.centerX + i * 2, y: a.mouthLine });
    stubs.push({ x: a.centerX + i * 2, y: a.mouthLine + 1 });
  }
  paintFlat(buffer, stubs, PX.ACCENT);
}

/** drawType 8: 灼熱のブレス口 */
function drawFlame(buffer: PixelBuffer, a: BodyAnchors): void {
  const glow = trianglePoints(a.centerX - 3, a.mouthLine, a.centerX + 3, a.mouthLine, a.centerX, a.mouthLine + 3);
  paintFlat(buffer, glow, PX.ACCENT_LIGHT);
  paintFlat(buffer, rectPoints(a.centerX - 3, a.mouthLine - 1, 6, 1), PX.BLACK);
}

/** drawType 9: マンモスの牙 */
function drawTusk(buffer: PixelBuffer, a: BodyAnchors): void {
  const w = Math.max(3, Math.round(a.headHalfWidth * 0.6));
  paintFlat(buffer, rectPoints(a.centerX - w, a.mouthLine, w * 2, 1), PX.BLACK);
  const tuskR = trianglePoints(a.centerX + w - 1, a.mouthLine, a.centerX + w + 3, a.mouthLine + 1, a.centerX + w, a.mouthLine + 4);
  const tuskL = mirrorX(tuskR, a.centerX);
  paintFlat(buffer, union(tuskL, tuskR), PX.WHITE);
}

const MOUTH_DRAWERS: ((buffer: PixelBuffer, a: BodyAnchors) => void)[] = [
  drawSmile,
  drawFangs,
  drawMandible,
  drawBeak,
  drawMaw,
  drawTongue,
  drawIron,
  drawTentacle,
  drawFlame,
  drawTusk,
];

export function drawMouth(buffer: PixelBuffer, a: BodyAnchors, drawType: number): void {
  const drawer = MOUTH_DRAWERS[drawType] ?? drawSmile;
  drawer(buffer, a);
}
