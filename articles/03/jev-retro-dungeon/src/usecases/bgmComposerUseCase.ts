/**
 * Jev-Driven BGM Composer Use Case
 * Clean Architecture - Use Case Layer
 * 
 * Jev AI chooses musical scale, tempo, arpeggio patterns, basslines, and synth timbre
 * based on floor depth and environmental element.
 */

import { JevClient } from "../adapters/jevClient";
import { BgmTrack, ScaleType } from "../domain/bgmModels";
import { ElementType } from "../domain/models";

export class BgmComposerUseCase {
  constructor(private jevClient: JevClient) {}

  /**
   * Jevがフロア情報からBGMトラックを作曲
   */
  async composeFloorBgm(floorNumber: number, element: ElementType): Promise<BgmTrack> {
    try {
      // 1. スケール選定
      const scaleCandidates: ScaleType[] =
        element === "crimson"
          ? ["phrygian", "harmonic_minor"]
          : element === "frost"
          ? ["dorian", "whole_tone"]
          : element === "shadow"
          ? ["whole_tone", "phrygian", "harmonic_minor"]
          : floorNumber >= 5
          ? ["harmonic_minor", "phrygian"]
          : ["minor", "dorian", "pentatonic"];

      const { response } = await this.jevClient.systemOne({
        state: { floor: floorNumber, element, role: "bgm_composer" },
        questions: {
          scale: {
            type: "choice",
            instructions: "フロアの緊迫感と魔力属性に合致する音楽スケールを選択してください",
            criteria: {
              [scaleCandidates[0]]: "第1推奨スケール",
              [scaleCandidates[1]]: "第2推奨スケール",
            },
          },
        },
      });

      const ans = response.answers["scale"];
      const scale = (ans?.type === "choice" ? (ans.choice as ScaleType) : scaleCandidates[0]) || scaleCandidates[0];

      // 2. テンポ (BPM)
      const bpm = 110 + Math.min(floorNumber * 4, 32);

      // 3. ルート音 (A2=45, C3=48, D3=50, E3=52, F3=53)
      const rootNotes = [45, 48, 50, 52, 53];
      const rootNote = rootNotes[(floorNumber - 1) % rootNotes.length];

      // 4. Jevによるメロディ＆ベースライン生成
      const melodyPattern = this.generateMelodyPattern(scale, floorNumber);
      const bassPattern = this.generateBassPattern(floorNumber);

      const themeNames: Record<ElementType, string> = {
        normal: `Cave of Stone (Floor ${floorNumber})`,
        crimson: `Inferno Corridor (Floor ${floorNumber})`,
        frost: `Glacial Depths (Floor ${floorNumber})`,
        shadow: `Abyssal Void (Floor ${floorNumber})`,
        golden: `Sanctuary of Light (Floor ${floorNumber})`,
      };

      const drumStyle = floorNumber >= 4 ? "heavy" : floorNumber >= 2 ? "march" : "simple";

      return {
        floorNumber,
        themeName: themeNames[element] || `Dungeon Floor ${floorNumber}`,
        scale,
        rootNote,
        bpm,
        melodyPattern,
        bassPattern,
        pulseDuty: element === "crimson" ? 0.25 : element === "frost" ? 0.125 : 0.5,
        drumStyle,
      };
    } catch {
      // フォールバック
      return {
        floorNumber,
        themeName: `Retro Dungeon B${floorNumber}F`,
        scale: "minor",
        rootNote: 48,
        bpm: 120,
        melodyPattern: [0, 2, 3, 5, 4, 3, 2, 0, 7, 5, 4, 2, 3, 2, 1, 0],
        bassPattern: [0, 0, 3, 3, 4, 4, 2, 2],
        pulseDuty: 0.5,
        drumStyle: "march",
      };
    }
  }

  private generateMelodyPattern(scale: ScaleType, floor: number): number[] {
    const seed = floor * 7 + (scale === "phrygian" ? 3 : 1);
    const patterns: number[][] = [
      [0, 2, 3, 5, 4, 3, 2, 0, 7, 5, 4, 2, 3, 2, 1, 0],
      [0, 3, 5, 7, 8, 7, 5, 3, 2, 3, 5, 3, 2, 1, 2, 0],
      [0, 1, 3, 4, 3, 1, 0, -1, 0, 3, 4, 6, 4, 3, 1, 0],
      [0, 2, 4, 7, 5, 4, 2, 0, 3, 5, 7, 9, 7, 5, 3, 0],
    ];
    return patterns[seed % patterns.length];
  }

  private generateBassPattern(floor: number): number[] {
    const patterns: number[][] = [
      [0, 0, 0, 0, 3, 3, 2, 2],
      [0, 2, 3, 0, 4, 3, 2, 0],
      [0, 0, 4, 4, 5, 5, 2, 2],
      [0, -2, 0, 3, 0, -2, 2, 1],
    ];
    return patterns[(floor - 1) % patterns.length];
  }
}
