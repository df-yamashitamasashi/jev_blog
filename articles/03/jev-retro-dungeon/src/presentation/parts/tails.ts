/**
 * Generative Monster Tails (10 types)
 * Clean Architecture - Presentation Layer
 */

import { PixelBuffer, PX, paintFlat, paintShaded, trianglePoints, union } from "../pixelBuffer";
import { BodyAnchors } from "./types";

function drawNone(): void {
  /* 何も描画しない */
}

/** drawType 1: 悪魔のスペード尾 */
function drawSpade(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const shaft = trianglePoints(tx, ty, tx + 5, ty - 2, tx + 3, ty + 3);
  const tip = union(
    trianglePoints(tx + 5, ty - 5, tx + 8, ty - 2, tx + 5, ty + 1),
    trianglePoints(tx + 5, ty - 1, tx + 8, ty - 2, tx + 6, ty + 2)
  );
  paintShaded(buffer, union(shaft, tip), "accent");
}

/** drawType 2: しなやかな鞭尾 */
function drawWhip(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const seg = trianglePoints(tx, ty - 2, tx + 8, ty + 2, tx + 2, ty + 5);
  paintShaded(buffer, seg, "accent");
}

/** drawType 3: 毒針の尾 */
function drawScorp(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const curve = trianglePoints(tx, ty, tx + 4, ty - 4, tx + 2, ty + 2);
  const stinger = trianglePoints(tx + 4, ty - 6, tx + 4, ty - 2, tx + 7, ty - 4);
  paintShaded(buffer, union(curve, stinger), "accent");
  paintFlat(buffer, [{ x: tx + 6, y: ty - 4 }], PX.WHITE);
}

/** drawType 4: 羽毛の尾 */
function drawFeather(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const plumes = union(
    trianglePoints(tx, ty, tx + 7, ty - 2, tx + 2, ty + 1),
    trianglePoints(tx, ty + 1, tx + 8, ty + 1, tx + 2, ty + 3),
    trianglePoints(tx, ty + 2, tx + 6, ty + 5, tx + 1, ty + 5)
  );
  paintFlat(buffer, plumes, PX.ACCENT_LIGHT);
}

/** drawType 5: アンキロサウルスの棍棒尾 */
function drawClub(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const handle = trianglePoints(tx, ty - 1, tx + 5, ty, tx + 3, ty + 3);
  const knob = union(
    trianglePoints(tx + 5, ty - 3, tx + 9, ty - 1, tx + 5, ty + 2),
    trianglePoints(tx + 5, ty - 1, tx + 9, ty + 1, tx + 5, ty + 4)
  );
  paintShaded(buffer, union(handle, knob), "accent");
}

/** drawType 6: 蛇のような魚のひれ尾 */
function drawFish(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const fin = union(
    trianglePoints(tx, ty - 3, tx + 6, ty, tx, ty + 1),
    trianglePoints(tx, ty + 1, tx + 6, ty, tx, ty + 5)
  );
  paintShaded(buffer, fin, "accent");
}

/** drawType 7: 九尾のふさふさ尾 */
function drawFluffy(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const tails = union(
    trianglePoints(tx, ty, tx + 8, ty - 3, tx + 3, ty + 2),
    trianglePoints(tx, ty + 1, tx + 8, ty + 1, tx + 3, ty + 4),
    trianglePoints(tx, ty + 2, tx + 7, ty + 5, tx + 3, ty + 6)
  );
  paintShaded(buffer, tails, "accent");
}

/** drawType 8: 双子の触手尾 */
function drawTwin(buffer: PixelBuffer, a: BodyAnchors): void {
  const tx = a.tailMount.x;
  const ty = a.tailMount.y;
  const t1 = trianglePoints(tx, ty - 2, tx + 6, ty - 3, tx + 2, ty + 1);
  const t2 = trianglePoints(tx, ty + 2, tx + 6, ty + 4, tx + 2, ty + 6);
  paintShaded(buffer, union(t1, t2), "accent");
}

/** drawType 9: 燃え盛る炎の尾 */
function drawFlame(buffer: PixelBuffer, a: BodyAnchors, flicker: number): void {
  const tx = a.tailMount.x;
  const dy = flicker ? -1 : 0;
  const ty = a.tailMount.y + dy;
  const body = trianglePoints(tx, ty - 2, tx + 7, ty, tx + 2, ty + 3);
  paintFlat(buffer, body, PX.ACCENT);
  paintFlat(buffer, [{ x: tx + 5, y: ty }], PX.ACCENT_LIGHT);
}

const TAIL_DRAWERS: ((buffer: PixelBuffer, a: BodyAnchors, flicker: number) => void)[] = [
  drawNone,
  drawSpade,
  drawWhip,
  drawScorp,
  drawFeather,
  drawClub,
  drawFish,
  drawFluffy,
  drawTwin,
  drawFlame,
];

export function drawTail(buffer: PixelBuffer, a: BodyAnchors, drawType: number, flicker: number = 0): void {
  const drawer = TAIL_DRAWERS[drawType] ?? drawNone;
  drawer(buffer, a, flicker);
}
