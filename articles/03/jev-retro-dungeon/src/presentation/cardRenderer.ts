/**
 * Retro Rogue Style Collectable Card Renderer (with DNA Hash & Generative Art)
 * Clean Architecture - Presentation Layer
 */

import { CardData } from "../domain/models";
import { RETRO_PALETTE, ELEMENT_PALETTES } from "../domain/constants";
import { GenerativeMonsterRenderer } from "./generativeRenderer";
import { I18nManager } from "./i18nManager";

export class CardRenderer {
  /**
   * CardDataからHTML5 Canvasを使ってレトロRPG風モンスター討伐カード画像を生成
   */
  static renderCardToCanvas(
    card: CardData,
    targetCanvas?: HTMLCanvasElement,
    i18n?: I18nManager
  ): HTMLCanvasElement {
    const width = 360;
    const height = 520;
    const canvas = targetCanvas || document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context for card");
    ctx.imageSmoothingEnabled = false;

    const pal = ELEMENT_PALETTES[card.element] || ELEMENT_PALETTES.normal;
    const t = (k: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>) =>
      i18n ? i18n.t(k, params) : String(k);

    const drawShadowText = (
      text: string,
      x: number,
      y: number,
      color: string,
      size: number = 12,
      isBold: boolean = false
    ) => {
      ctx.font = `${isBold ? "bold " : ""}${size}px 'DotGothic16', 'Press Start 2P', monospace, sans-serif`;
      ctx.fillStyle = "#000000";
      ctx.fillText(text, x + 1, y + 1);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };

    // 1. カード外枠・ベース背景
    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillRect(0, 0, width, height);

    const isHighTier = card.rarity === "Legendary" || card.rarity === "Epic";
    ctx.strokeStyle = isHighTier ? RETRO_PALETTE.textGold : RETRO_PALETTE.windowBorder;
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, width - 12, height - 12);

    ctx.strokeStyle = isHighTier ? RETRO_PALETTE.chestGold : RETRO_PALETTE.wallStone;
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, width - 24, height - 24);

    // 2. ヘッダー部（レアリティ＆カード名）
    ctx.fillStyle = isHighTier ? "rgba(252, 216, 0, 0.15)" : "rgba(20, 20, 30, 0.8)";
    ctx.fillRect(16, 16, width - 32, 56);

    drawShadowText(`[ ${card.rarity.toUpperCase()} ]`, 24, 34, isHighTier ? RETRO_PALETTE.textGold : RETRO_PALETTE.textCyan, 12, true);
    drawShadowText(card.subtitle, 160, 34, RETRO_PALETTE.textWhite, 11, false);
    drawShadowText(card.title, 24, 58, pal.secondary, 16, true);

    // 3. 中央イラスト枠（ジェネラティブ・モンスター巨大ドット絵・属性背景）
    const artX = 24;
    const artY = 80;
    const artW = width - 48;
    const artH = 196;

    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillRect(artX, artY, artW, artH);
    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(artX, artY, artW, artH);

    // オーラバックグラウンド
    const grad = ctx.createRadialGradient(
      artX + artW / 2,
      artY + artH / 2,
      10,
      artX + artW / 2,
      artY + artH / 2,
      artW / 2
    );
    grad.addColorStop(0, pal.glow);
    grad.addColorStop(1, "rgba(0, 0, 0, 0.95)");
    ctx.fillStyle = grad;
    ctx.fillRect(artX + 2, artY + 2, artW - 4, artH - 4);

    // DNAに基づくジェネラティブ描画
    if (card.dna) {
      GenerativeMonsterRenderer.renderMonster(ctx, artX + artW / 2, artY + artH / 2, card.dna, 2.2);
    }

    // 4. ステータス・パラメータ枠
    const statY = 286;
    ctx.fillStyle = "#0c0c14";
    ctx.fillRect(20, statY, width - 40, 72);
    ctx.strokeStyle = RETRO_PALETTE.wallStone;
    ctx.lineWidth = 1;
    ctx.strokeRect(20, statY, width - 40, 72);

    drawShadowText(`${t("card_atk")} : ${card.stats.attack}`, 32, statY + 24, RETRO_PALETTE.textRed, 13, true);
    drawShadowText(`${t("card_def")} : ${card.stats.defense}`, 145, statY + 24, RETRO_PALETTE.textCyan, 13, true);
    drawShadowText(`${t("card_spd")} : ${card.stats.speed}`, 255, statY + 24, RETRO_PALETTE.textGold, 13, true);
    drawShadowText(`${t("card_difficulty")} : ★ ${card.stats.dangerScore} / 4.0`, 32, statY + 52, RETRO_PALETTE.textWhite, 12, false);

    // 5. フレーバーテキスト欄（叙事詩・図鑑説明）
    const loreY = 368;
    ctx.fillStyle = "#080810";
    ctx.fillRect(20, loreY, width - 40, 96);
    ctx.strokeStyle = isHighTier ? "rgba(252, 216, 0, 0.4)" : "rgba(100, 100, 140, 0.4)";
    ctx.strokeRect(20, loreY, width - 40, 96);

    ctx.font = "12px 'DotGothic16', 'Press Start 2P', monospace, sans-serif";
    ctx.fillStyle = "#e0e0f0";
    this.wrapText(ctx, `『 ${card.flavorText} 』`, 32, loreY + 24, width - 64, 20);

    // 6. フッター（DNAハッシュとスレイヤー）
    drawShadowText(`${t("card_slayer")}: ${card.slayerName} (B${card.floor}F)`, 24, 484, RETRO_PALETTE.wallStone, 11);
    drawShadowText(`DNA: ${card.dna ? card.dna.dnaHash : "N/A"}`, 24, 500, RETRO_PALETTE.wallStone, 10);
    drawShadowText("#JevDungeon #GenerativeMonster", 160, 500, RETRO_PALETTE.textGold, 10, true);

    return canvas;
  }

  private static wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ): void {
    const chars = text.split("");
    let line = "";
    let currentY = y;

    for (let n = 0; n < chars.length; n++) {
      const testLine = line + chars[n];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = chars[n];
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  /**
   * 生成されたカード画像をPNGファイルとしてダウンロード保存
   */
  static downloadCardImage(canvas: HTMLCanvasElement, title: string): void {
    const link = document.createElement("a");
    link.download = `JevMonster_${title.replace(/\s+/g, "_")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  /**
   * X (Twitter) への討伐カード共有URLを生成
   */
  static async shareCard(
    _canvas: HTMLCanvasElement,
    card: CardData
  ): Promise<string> {
    const text = `⚔️ JEV AI RETRO DUNGEON ⚔️\n地下${card.floor}階で【${card.title}】(${card.rarity})を討伐した！\nDNA: ${card.dna?.dnaHash || "N/A"}\n\n#JevDungeon #GenerativeMonster #TypeSafeAI`;
    const url = "https://typesafe.ai";
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(twitterUrl, "_blank", "noopener,noreferrer");
    return "X (Twitter) 共有ウィンドウを開きました！";
  }
}
