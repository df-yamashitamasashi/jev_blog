/**
 * Shared types for generative monster part drawers.
 * Clean Architecture - Presentation Layer
 */

import { Point } from "../pixelBuffer";

/**
 * ボディパーツが返す接続点。以降のパーツ（目・口・角・翼・尾・オーラ）は
 * すべてこのアンカーを基準に配置されるため、どのDNAの組み合わせでも
 * パーツ同士が浮いたり位置がズレたりしない。
 */
export interface BodyAnchors {
  readonly centerX: number;
  readonly headCenterY: number;
  readonly headHalfWidth: number;
  readonly headTop: number;
  readonly eyeLine: number;
  readonly mouthLine: number;
  readonly backMountL: Point;
  readonly backMountR: Point;
  readonly tailMount: Point;
  readonly groundLine: number;
  readonly torsoHalfWidth: number;
}

export const GRID_SIZE = 32;
export const CENTER_X = 16;
