/**
 * Generative Monster Body Silhouettes (12 types)
 * Clean Architecture - Presentation Layer
 */

import { PixelBuffer, Point, ellipsePoints, paintShaded, trianglePoints, union } from "../pixelBuffer";
import { BodyAnchors, CENTER_X } from "./types";

/** 上辺wTop・下辺wBottomの台形ブロック（正の差=下すぼみ、負の差=下広がり） */
function taperedBlock(cx: number, yTop: number, yBottom: number, wTop: number, wBottom: number): Point[] {
  const pts: Point[] = [];
  const h = Math.max(1, yBottom - yTop);
  for (let y = yTop; y <= yBottom; y++) {
    const t = (y - yTop) / h;
    const w = wTop + (wBottom - wTop) * t;
    const xL = Math.round(cx - w);
    const xR = Math.round(cx + w);
    for (let x = xL; x <= xR; x++) pts.push({ x, y });
  }
  return pts;
}

function legs(cx: number, yTop: number, yBottom: number, spread: number, legWidth: number): Point[] {
  return union(
    taperedBlock(cx - spread, yTop, yBottom, legWidth, legWidth),
    taperedBlock(cx + spread, yTop, yBottom, legWidth, legWidth)
  );
}

function paintBody(buffer: PixelBuffer, ...groups: Point[][]): void {
  paintShaded(buffer, union(...groups), "primary");
}

const cx = CENTER_X;

/** drawType 0: スライム型 — まん丸で下部がどっしり太る雫シルエット */
function drawSlime(buffer: PixelBuffer): BodyAnchors {
  const body = union(ellipsePoints(cx, 19, 10, 7), taperedBlock(cx, 19, 26, 10, 8));
  paintBody(buffer, body);
  return {
    centerX: cx,
    headCenterY: 17,
    headHalfWidth: 10,
    headTop: 12,
    eyeLine: 17,
    mouthLine: 21,
    backMountL: { x: cx - 9, y: 15 },
    backMountR: { x: cx + 9, y: 15 },
    tailMount: { x: cx + 8, y: 23 },
    groundLine: 27,
    torsoHalfWidth: 10,
  };
}

/** drawType 1: 標準獣型 — 丸い頭＋肩幅のある胴＋二足 */
function drawBeast(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 9, 5, 5);
  const torso = taperedBlock(cx, 13, 23, 7, 6);
  const legPts = legs(cx, 23, 29, 3, 3);
  paintBody(buffer, head, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 9,
    headHalfWidth: 5,
    headTop: 4,
    eyeLine: 9,
    mouthLine: 12,
    backMountL: { x: cx - 7, y: 15 },
    backMountR: { x: cx + 7, y: 15 },
    tailMount: { x: cx + 6, y: 22 },
    groundLine: 29,
    torsoHalfWidth: 7,
  };
}

/** drawType 2: 爬虫類型 — 前に突き出た鼻先と低い姿勢 */
function drawReptile(buffer: PixelBuffer): BodyAnchors {
  const head = union(ellipsePoints(cx, 11, 5, 4), trianglePoints(cx - 2, 9, cx + 7, 11, cx - 2, 13));
  const torso = taperedBlock(cx, 15, 24, 8, 6);
  const legPts = legs(cx, 24, 29, 4, 3);
  paintBody(buffer, head, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 11,
    headHalfWidth: 6,
    headTop: 6,
    eyeLine: 10,
    mouthLine: 13,
    backMountL: { x: cx - 8, y: 17 },
    backMountR: { x: cx + 8, y: 17 },
    tailMount: { x: cx + 7, y: 23 },
    groundLine: 29,
    torsoHalfWidth: 8,
  };
}

/** drawType 3: 怪鳥型 — 小さな頭・しずく型の胴・細い脚 */
function drawAvian(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 8, 4, 4);
  const torso = union(ellipsePoints(cx, 16, 6, 7), taperedBlock(cx, 16, 25, 6, 3));
  const legPts = legs(cx, 25, 29, 2, 2);
  paintBody(buffer, head, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 8,
    headHalfWidth: 4,
    headTop: 4,
    eyeLine: 8,
    mouthLine: 10,
    backMountL: { x: cx - 6, y: 13 },
    backMountR: { x: cx + 6, y: 13 },
    tailMount: { x: cx, y: 23 },
    groundLine: 29,
    torsoHalfWidth: 6,
  };
}

/** drawType 4: アンデッド型 — 痩せ細った肋のようなシルエット */
function drawUndead(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 9, 4, 5);
  const torso = taperedBlock(cx, 14, 23, 5, 4);
  const legPts = legs(cx, 23, 29, 2, 2);
  paintBody(buffer, head, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 9,
    headHalfWidth: 4,
    headTop: 4,
    eyeLine: 9,
    mouthLine: 12,
    backMountL: { x: cx - 5, y: 16 },
    backMountR: { x: cx + 5, y: 16 },
    tailMount: { x: cx + 4, y: 22 },
    groundLine: 29,
    torsoHalfWidth: 5,
  };
}

/** drawType 5: 甲虫型 — 頭・胸・腹の3節構成 */
function drawInsect(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 9, 4, 3);
  const thorax = ellipsePoints(cx, 15, 5, 4);
  const abdomen = ellipsePoints(cx, 22, 6, 6);
  const legPts = legs(cx, 24, 28, 5, 2);
  paintBody(buffer, head, thorax, abdomen, legPts);
  return {
    centerX: cx,
    headCenterY: 9,
    headHalfWidth: 4,
    headTop: 5,
    eyeLine: 9,
    mouthLine: 11,
    backMountL: { x: cx - 5, y: 14 },
    backMountR: { x: cx + 5, y: 14 },
    tailMount: { x: cx, y: 27 },
    groundLine: 28,
    torsoHalfWidth: 6,
  };
}

/** drawType 6: ゴーレム型 — 角ばった大ブロック */
function drawGolem(buffer: PixelBuffer): BodyAnchors {
  const head = taperedBlock(cx, 6, 11, 4, 4);
  const torso = taperedBlock(cx, 11, 24, 11, 10);
  const legPts = legs(cx, 24, 29, 5, 4);
  paintBody(buffer, head, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 8,
    headHalfWidth: 4,
    headTop: 5,
    eyeLine: 8,
    mouthLine: 11,
    backMountL: { x: cx - 11, y: 14 },
    backMountR: { x: cx + 11, y: 14 },
    tailMount: { x: cx + 9, y: 22 },
    groundLine: 29,
    torsoHalfWidth: 11,
  };
}

/** drawType 7: 悪魔型 — 逆三角の広い肩、引き締まった腰 */
function drawDemon(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 8, 4, 4);
  const torso = taperedBlock(cx, 13, 23, 9, 5);
  const legPts = legs(cx, 23, 29, 3, 3);
  paintBody(buffer, head, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 8,
    headHalfWidth: 4,
    headTop: 4,
    eyeLine: 8,
    mouthLine: 11,
    backMountL: { x: cx - 9, y: 14 },
    backMountR: { x: cx + 9, y: 14 },
    tailMount: { x: cx + 5, y: 22 },
    groundLine: 29,
    torsoHalfWidth: 9,
  };
}

/** drawType 8: 水棲型 — なめらかで下部が尾ひれ状にすぼまる */
function drawAquatic(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 11, 6, 5);
  const torso = taperedBlock(cx, 15, 25, 7, 2);
  const fin = trianglePoints(cx - 2, 25, cx + 2, 25, cx, 29);
  paintBody(buffer, head, torso, fin);
  return {
    centerX: cx,
    headCenterY: 11,
    headHalfWidth: 6,
    headTop: 6,
    eyeLine: 10,
    mouthLine: 14,
    backMountL: { x: cx - 8, y: 16 },
    backMountR: { x: cx + 8, y: 16 },
    tailMount: { x: cx, y: 26 },
    groundLine: 29,
    torsoHalfWidth: 8,
  };
}

/** drawType 9: 植物型 — 蕾のような丸い頭部と太い幹 */
function drawPlant(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 12, 8, 6);
  const trunk = taperedBlock(cx, 17, 27, 5, 7);
  paintBody(buffer, head, trunk);
  return {
    centerX: cx,
    headCenterY: 12,
    headHalfWidth: 8,
    headTop: 6,
    eyeLine: 12,
    mouthLine: 15,
    backMountL: { x: cx - 8, y: 12 },
    backMountR: { x: cx + 8, y: 12 },
    tailMount: { x: cx + 6, y: 24 },
    groundLine: 29,
    torsoHalfWidth: 8,
  };
}

/** drawType 10: 亡霊型 — 脚がなく裾が広がって浮遊する */
function drawSpecter(buffer: PixelBuffer): BodyAnchors {
  const head = ellipsePoints(cx, 12, 6, 6);
  const robe = taperedBlock(cx, 16, 25, 6, 10);
  const wisp1 = trianglePoints(cx - 10, 23, cx - 6, 23, cx - 8, 28);
  const wisp2 = trianglePoints(cx + 6, 23, cx + 10, 23, cx + 8, 28);
  const wisp3 = trianglePoints(cx - 2, 25, cx + 2, 25, cx, 29);
  paintBody(buffer, head, robe, wisp1, wisp2, wisp3);
  return {
    centerX: cx,
    headCenterY: 12,
    headHalfWidth: 6,
    headTop: 6,
    eyeLine: 12,
    mouthLine: 15,
    backMountL: { x: cx - 8, y: 15 },
    backMountR: { x: cx + 8, y: 15 },
    tailMount: { x: cx + 8, y: 22 },
    groundLine: 27,
    torsoHalfWidth: 10,
  };
}

/** drawType 11: 竜王型 — 最大級・長い首と力強い四肢 */
function drawDragon(buffer: PixelBuffer): BodyAnchors {
  const head = union(ellipsePoints(cx, 8, 5, 4), trianglePoints(cx - 3, 6, cx + 8, 8, cx - 3, 10));
  const neck = taperedBlock(cx, 10, 14, 4, 6);
  const torso = taperedBlock(cx, 14, 25, 12, 9);
  const legPts = legs(cx, 25, 30, 6, 4);
  paintBody(buffer, head, neck, torso, legPts);
  return {
    centerX: cx,
    headCenterY: 8,
    headHalfWidth: 5,
    headTop: 3,
    eyeLine: 8,
    mouthLine: 9,
    backMountL: { x: cx - 12, y: 16 },
    backMountR: { x: cx + 12, y: 16 },
    tailMount: { x: cx + 10, y: 23 },
    groundLine: 30,
    torsoHalfWidth: 12,
  };
}

const BODY_DRAWERS: ((buffer: PixelBuffer) => BodyAnchors)[] = [
  drawSlime,
  drawBeast,
  drawReptile,
  drawAvian,
  drawUndead,
  drawInsect,
  drawGolem,
  drawDemon,
  drawAquatic,
  drawPlant,
  drawSpecter,
  drawDragon,
];

export function drawBody(buffer: PixelBuffer, drawType: number): BodyAnchors {
  const drawer = BODY_DRAWERS[drawType] ?? drawBeast;
  return drawer(buffer);
}
