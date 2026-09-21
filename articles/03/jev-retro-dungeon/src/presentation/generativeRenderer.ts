/**
 * Generative Monster Pixel Art Renderer (CryptoKitties / CryptoPunks Layering)
 * Clean Architecture - Presentation Layer
 */

import { MonsterDNA, DNA_CATALOG } from "../domain/dnaModels";

export class GenerativeMonsterRenderer {
  /**
   * 8スロットのDNAからレイヤー順に重ね合わせてモンスター像をCanvasに描画
   */
  static renderMonster(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    dna: MonsterDNA,
    scale = 2.4
  ): void {
    const palette =
      DNA_CATALOG.palettes.find((p) => p.id === dna.paletteGene) || DNA_CATALOG.palettes[0];
    const body = DNA_CATALOG.bodies.find((b) => b.id === dna.bodyGene) || DNA_CATALOG.bodies[0];
    const eyes = DNA_CATALOG.eyes.find((e) => e.id === dna.eyesGene) || DNA_CATALOG.eyes[0];
    const mouth = DNA_CATALOG.mouths.find((m) => m.id === dna.mouthGene) || DNA_CATALOG.mouths[0];
    const horns = DNA_CATALOG.horns.find((h) => h.id === dna.hornsGene) || DNA_CATALOG.horns[0];
    const wings = DNA_CATALOG.wings.find((w) => w.id === dna.wingsGene) || DNA_CATALOG.wings[0];
    const tail = DNA_CATALOG.tails.find((t) => t.id === dna.tailGene) || DNA_CATALOG.tails[0];
    const aura = DNA_CATALOG.auras.find((a) => a.id === dna.auraGene) || DNA_CATALOG.auras[0];

    ctx.save();
    ctx.scale(scale, scale);
    const mx = cx / scale;
    const my = cy / scale;

    // 1. Layer: Aura / Background Magic Effect
    if (aura.id !== "a_none") {
      ctx.fillStyle = palette.glow;
      ctx.beginPath();
      ctx.arc(mx, my, 28, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Layer: Wings / Back Appendages
    if (wings.id !== "w_none") {
      ctx.fillStyle = palette.secondary;
      // 左右の翼
      ctx.fillRect(mx - 24, my - 12, 10, 16);
      ctx.fillRect(mx + 14, my - 12, 10, 16);
      // 先端の爪
      ctx.fillStyle = palette.primary;
      ctx.fillRect(mx - 26, my - 16, 4, 6);
      ctx.fillRect(mx + 22, my - 16, 4, 6);
    }

    // 3. Layer: Tail / Lower Appendages
    if (tail.id !== "t_none") {
      ctx.fillStyle = palette.primary;
      ctx.fillRect(mx + 8, my + 10, 12, 5);
      ctx.fillRect(mx + 16, my + 6, 6, 6);
      // 尾先
      ctx.fillStyle = palette.secondary;
      ctx.fillRect(mx + 20, my + 4, 4, 4);
    }

    // 4. Layer: Base Body
    ctx.fillStyle = palette.primary;
    switch (body.drawType) {
      case 0: // スライム型
        ctx.beginPath();
        ctx.arc(mx, my, 16, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 6: // ゴーレム型（角ばり）
        ctx.fillRect(mx - 16, my - 16, 32, 32);
        break;
      case 11: // ドラゴン型（大柄）
        ctx.fillRect(mx - 18, my - 18, 36, 36);
        break;
      default: // 標準獣型・人型
        ctx.beginPath();
        ctx.arc(mx, my - 4, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(mx - 12, my - 4, 24, 20);
        break;
    }

    // ボディの陰影・ハイライト
    ctx.fillStyle = palette.secondary;
    ctx.fillRect(mx - 8, my - 10, 16, 4);

    // 5. Layer: Horns / Headwear
    if (horns.id !== "h_none") {
      ctx.fillStyle = palette.secondary;
      if (horns.drawType === 2) {
        // 一本角（ユニコーン）
        ctx.fillRect(mx - 2, my - 24, 4, 10);
      } else {
        // 左右の角
        ctx.fillRect(mx - 14, my - 22, 6, 10);
        ctx.fillRect(mx + 8, my - 22, 6, 10);
      }
    }

    // 6. Layer: Mouth / Fangs
    ctx.fillStyle = "#ffffff";
    if (mouth.drawType === 1) {
      // 牙
      ctx.fillRect(mx - 6, my + 4, 3, 4);
      ctx.fillRect(mx + 3, my + 4, 3, 4);
    } else {
      ctx.fillRect(mx - 5, my + 3, 10, 2);
    }

    // 7. Layer: Eyes / Expression
    ctx.fillStyle = "#ffffff";
    const pupilColor = eyes.drawType === 4 || eyes.drawType === 8 ? "#ff2222" : eyes.drawType === 10 ? "#ffd700" : "#000000";
    if (eyes.drawType === 2) {
      // 単眼（サイクロプス）
      ctx.fillRect(mx - 4, my - 5, 8, 6);
      ctx.fillStyle = pupilColor;
      ctx.fillRect(mx - 2, my - 4, 4, 4);
    } else {
      // 複眼 / 通常2眼
      ctx.fillRect(mx - 7, my - 4, 4, 5);
      ctx.fillRect(mx + 3, my - 4, 4, 5);
      ctx.fillStyle = pupilColor;
      ctx.fillRect(mx - 5, my - 3, 2, 3);
      ctx.fillRect(mx + 5, my - 3, 2, 3);
    }

    ctx.restore();
  }
}
