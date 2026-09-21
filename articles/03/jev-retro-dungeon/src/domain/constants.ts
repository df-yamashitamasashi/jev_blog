/**
 * Classic Retro RPG Constants & Color Palette
 * Clean Architecture - Domain Layer
 */

import { ElementType } from "./models";

export const CANVAS_WIDTH = 640;
export const CANVAS_HEIGHT = 530;
export const TILE_SIZE = 32;
export const MAP_COLS = 20;
export const MAP_ROWS = 15;

// Classic 8-bit Retro RPG Palette
export const RETRO_PALETTE = {
  black: "#000000",
  windowBorder: "#ffffff",
  windowBg: "#000000",
  textWhite: "#ffffff",
  textGold: "#fcd800",
  textCyan: "#00e8d8",
  textRed: "#e40058",
  wallStone: "#6c6c6c",
  wallStoneDark: "#3c3c3c",
  floorStone: "#887000",
  floorStoneDark: "#504000",
  stairsBlue: "#0078f8",
  chestGold: "#f8b800",
  torchGlow: "rgba(248, 184, 0, 0.15)",
} as const;

// Backward-compatible alias
export const DQ_PALETTE = RETRO_PALETTE;

export const ELEMENT_PALETTES: Record<
  ElementType,
  {
    primary: string;
    secondary: string;
    glow: string;
    nameJa: string;
  }
> = {
  normal: {
    primary: "#0078f8",
    secondary: "#38b8f8",
    glow: "rgba(0, 120, 248, 0.4)",
    nameJa: "通常",
  },
  crimson: {
    primary: "#f83800",
    secondary: "#f87858",
    glow: "rgba(248, 56, 0, 0.5)",
    nameJa: "紅蓮",
  },
  frost: {
    primary: "#00e8d8",
    secondary: "#b8f8f8",
    glow: "rgba(0, 232, 216, 0.5)",
    nameJa: "氷結",
  },
  shadow: {
    primary: "#940088",
    secondary: "#d800cc",
    glow: "rgba(148, 0, 136, 0.5)",
    nameJa: "虚無",
  },
  golden: {
    primary: "#fcd800",
    secondary: "#f8f878",
    glow: "rgba(252, 216, 0, 0.6)",
    nameJa: "黄金",
  },
};

export const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_JEV_MODEL = "jev-latest";
