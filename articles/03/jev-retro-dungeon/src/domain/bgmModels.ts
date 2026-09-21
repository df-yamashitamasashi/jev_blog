/**
 * BGM Models for Jev-Driven Procedural Chiptune Synthesizer
 * Clean Architecture - Domain Layer
 */

export type ScaleType =
  | "minor"          // 自然短調 (Aeolian)
  | "dorian"         // ドリアン旋法 (冒険・古代)
  | "phrygian"       // フリジアン旋法 (溶岩・邪悪)
  | "pentatonic"     // ペンタトニック (東洋・ダンジョン)
  | "whole_tone"     // 全音音階 (虚無・浮遊感)
  | "harmonic_minor" // 和声的短調 (決戦・緊張感)
  | "major";         // 長調 (勝利・凱旋)

export interface BgmTrack {
  readonly floorNumber: number;
  readonly themeName: string;
  readonly scale: ScaleType;
  readonly rootNote: number;   // MIDI note (e.g. 48 = C3, 57 = A3)
  readonly bpm: number;        // テンポ (e.g. 110 - 150)
  readonly melodyPattern: number[]; // 各拍の音階インデックス配列 (0〜7)
  readonly bassPattern: number[];   // ベースラインの音階インデックス配列
  readonly pulseDuty: number;       // 矩形波デューティ比 (0.125, 0.25, 0.5)
  readonly drumStyle: "none" | "simple" | "march" | "heavy";
}
