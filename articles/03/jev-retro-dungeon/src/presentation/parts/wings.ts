/**
 * Generative Monster Wings / Back Appendages (10 types)
 * Clean Architecture - Presentation Layer
 */

import { PixelBuffer, PX, mirrorX, paintFlat, paintShaded, trianglePoints, union } from "../pixelBuffer";
import { BodyAnchors } from "./types";

function drawNone(): void {
  /* 何も描画しない */
}

/** drawType 1: 革質のコウモリ翼（flap=1で羽ばたき上がる） */
function drawBat(buffer: PixelBuffer, a: BodyAnchors, flap: number): void {
  const lift = flap ? 2 : 0;
  const rightTip = { x: a.backMountR.x + 8, y: a.backMountR.y - 4 - lift };
  const right = union(
    trianglePoints(a.backMountR.x, a.backMountR.y - 2, a.backMountR.x + 2, a.backMountR.y + 6, rightTip.x, rightTip.y),
    trianglePoints(a.backMountR.x, a.backMountR.y + 2, a.backMountR.x + 2, a.backMountR.y + 6, rightTip.x - 2, rightTip.y + 4)
  );
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 2: 天使の羽根翼 */
function drawFeather(buffer: PixelBuffer, a: BodyAnchors, flap: number): void {
  const lift = flap ? 1 : 0;
  const right = union(
    trianglePoints(a.backMountR.x, a.backMountR.y - 3, a.backMountR.x + 6, a.backMountR.y - 1 - lift, a.backMountR.x + 2, a.backMountR.y + 5),
    trianglePoints(a.backMountR.x + 1, a.backMountR.y + 2, a.backMountR.x + 5, a.backMountR.y + 3 - lift, a.backMountR.x + 2, a.backMountR.y + 7)
  );
  const left = mirrorX(right, a.centerX);
  paintFlat(buffer, union(left, right), PX.WHITE);
}

/** drawType 3: ワイバーンの翼膜（骨の筋が見える） */
function drawDragonWing(buffer: PixelBuffer, a: BodyAnchors, flap: number): void {
  const lift = flap ? 3 : 0;
  const tip = { x: a.backMountR.x + 10, y: a.backMountR.y - 6 - lift };
  const right = trianglePoints(a.backMountR.x, a.backMountR.y - 2, a.backMountR.x + 2, a.backMountR.y + 7, tip.x, tip.y);
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
  const boneR = [
    { x: a.backMountR.x + 3, y: a.backMountR.y },
    { x: a.backMountR.x + 6, y: a.backMountR.y - 2 - lift },
    { x: tip.x, y: tip.y },
  ];
  paintFlat(buffer, union(boneR, mirrorX(boneR, a.centerX)), PX.ACCENT_DEEP);
}

/** drawType 4: 蜂の透明な小翅（高速振動＝常に薄い輪郭のみ） */
function drawInsectWing(buffer: PixelBuffer, a: BodyAnchors): void {
  const right = trianglePoints(a.backMountR.x, a.backMountR.y - 2, a.backMountR.x + 5, a.backMountR.y - 1, a.backMountR.x + 2, a.backMountR.y + 4);
  const left = mirrorX(right, a.centerX);
  paintFlat(buffer, union(left, right), PX.ACCENT_LIGHT);
}

/** drawType 5: 甲殻の盾（背に張り付く防御殻） */
function drawShell(buffer: PixelBuffer, a: BodyAnchors): void {
  const right = trianglePoints(a.backMountR.x - 2, a.backMountR.y - 4, a.backMountR.x + 4, a.backMountR.y, a.backMountR.x - 1, a.backMountR.y + 8);
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 6: 背棘（一列に並ぶ棘） */
function drawSpines(buffer: PixelBuffer, a: BodyAnchors): void {
  const spikes: { x: number; y: number }[][] = [];
  for (let i = 0; i < 3; i++) {
    const y = a.backMountR.y - 2 + i * 3;
    spikes.push(trianglePoints(a.centerX - 1, y, a.centerX + 1, y, a.centerX, y - 3));
  }
  paintShaded(buffer, union(...spikes), "accent");
}

/** drawType 7: 炎の翼（揺らめく炎形状） */
function drawFlame(buffer: PixelBuffer, a: BodyAnchors, flap: number): void {
  const flicker = flap ? 1 : 0;
  const right = union(
    trianglePoints(a.backMountR.x, a.backMountR.y - 1, a.backMountR.x + 6, a.backMountR.y - 3 - flicker, a.backMountR.x + 2, a.backMountR.y + 4),
    trianglePoints(a.backMountR.x + 1, a.backMountR.y + 1, a.backMountR.x + 4, a.backMountR.y - 1 + flicker, a.backMountR.x + 2, a.backMountR.y + 6)
  );
  const left = mirrorX(right, a.centerX);
  paintFlat(buffer, union(left, right), PX.ACCENT);
  const core = [
    { x: a.backMountR.x + 2, y: a.backMountR.y },
    { x: a.backMountL.x - 2, y: a.backMountL.y },
  ];
  paintFlat(buffer, core, PX.ACCENT_LIGHT);
}

/** drawType 8: 背後の触手 */
function drawTentacles(buffer: PixelBuffer, a: BodyAnchors, flap: number): void {
  const sway = flap ? 1 : -1;
  const right = trianglePoints(
    a.backMountR.x,
    a.backMountR.y - 1,
    a.backMountR.x + 5 + sway,
    a.backMountR.y + 2,
    a.backMountR.x + 2,
    a.backMountR.y + 6
  );
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

/** drawType 9: 影のマント */
function drawCape(buffer: PixelBuffer, a: BodyAnchors): void {
  const right = trianglePoints(a.backMountR.x - 3, a.backMountR.y - 2, a.backMountR.x + 3, a.backMountR.y - 1, a.backMountR.x + 1, a.groundLine - 1);
  const left = mirrorX(right, a.centerX);
  paintShaded(buffer, union(left, right), "accent");
}

const WING_DRAWERS: ((buffer: PixelBuffer, a: BodyAnchors, flap: number) => void)[] = [
  drawNone,
  drawBat,
  drawFeather,
  drawDragonWing,
  drawInsectWing,
  drawShell,
  drawSpines,
  drawFlame,
  drawTentacles,
  drawCape,
];

export function drawWings(buffer: PixelBuffer, a: BodyAnchors, drawType: number, flap: number = 0): void {
  const drawer = WING_DRAWERS[drawType] ?? drawNone;
  drawer(buffer, a, flap);
}
