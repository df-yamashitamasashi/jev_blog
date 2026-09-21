/**
 * Retro Rogue Style Collectable Card Renderer (with DNA Hash & Generative Art)
 * Clean Architecture - Presentation Layer
 */

import { CardData } from "../domain/models";
import { readGenome, sumGenomeModifiers } from "../domain/dnaModels";
import { RETRO_PALETTE, ELEMENT_PALETTES } from "../domain/constants";
import { GenerativeMonsterRenderer } from "./generativeRenderer";
import { I18nManager } from "./i18nManager";

export class CardRenderer {
  /**
   * カードの論理レイアウトサイズ。実際のcanvasはこの CARD_SCALE 倍で確保し、
   * 描画自体は論理座標のまま行う（＝2倍のスーパーサンプリング）。
   * 等倍で描くと共有時に文字が潰れて読めないため、書き出し解像度を上げている。
   */
  private static readonly CARD_W = 400;
  private static readonly CARD_H = 620;
  private static readonly CARD_SCALE = 2;

  /**
   * CardDataからHTML5 Canvasを使ってレトロRPG風モンスター討伐カード画像を生成
   */
  static renderCardToCanvas(
    card: CardData,
    targetCanvas?: HTMLCanvasElement,
    i18n?: I18nManager
  ): HTMLCanvasElement {
    const width = CardRenderer.CARD_W;
    const height = CardRenderer.CARD_H;
    const scale = CardRenderer.CARD_SCALE;

    const canvas = targetCanvas || document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context for card");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const pal = ELEMENT_PALETTES[card.element] || ELEMENT_PALETTES.normal;
    const t = (k: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>) =>
      i18n ? i18n.t(k, params) : String(k);

    /** 黒背景で沈む暗い属性色は白にフォールバックさせる */
    const readable = (hex: string): string => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) return RETRO_PALETTE.textWhite;
      const v = parseInt(m[1], 16);
      const lum = 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
      return lum < 90 ? RETRO_PALETTE.textWhite : hex;
    };

    const accent = readable(pal.secondary);

    // カードもゲーム画面と同じく、可読性優先で Noto Sans 系を使う
    const font = (size: number, isBold: boolean) =>
      `${isBold || size <= 12 ? 700 : 500} ${size}px 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans KR', 'Noto Sans Devanagari', sans-serif`;

    const drawText = (
      text: string,
      x: number,
      y: number,
      color: string,
      size: number = 13,
      isBold: boolean = false
    ) => {
      ctx.font = font(size, isBold);
      ctx.fillStyle = "#000000";
      ctx.fillText(text, x + 1, y + 1);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };

    /**
     * maxWidthに収まるまでフォントを段階的に縮めて描画する。
     * ラベル語長は言語ごとに大きく変わる（例: 討伐難度 / Schwierigkeit）ため、
     * 固定サイズだと枠外にはみ出して文字が欠ける。
     */
    const drawFitted = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      color: string,
      size: number,
      isBold: boolean = false
    ) => {
      let fitted = size;
      while (fitted > 8) {
        ctx.font = font(fitted, isBold);
        if (ctx.measureText(text).width <= maxWidth) break;
        fitted -= 1;
      }
      drawText(text, x, y, color, fitted, isBold);
    };

    /** 右端揃えで描画する（数値カラムを揃えるため）。maxWidthを渡すと収まるまで縮小する */
    const drawRight = (
      text: string,
      right: number,
      y: number,
      color: string,
      size: number,
      isBold = false,
      maxWidth = Infinity
    ) => {
      let fitted = size;
      while (fitted > 8) {
        ctx.font = font(fitted, isBold);
        if (ctx.measureText(text).width <= maxWidth) break;
        fitted -= 1;
      }
      ctx.font = font(fitted, isBold);
      drawText(text, right - ctx.measureText(text).width, y, color, fitted, isBold);
    };

    /** 指定フォントでのテキスト幅（左右の要素が衝突しないかの判定に使う） */
    const textWidth = (text: string, size: number, isBold = false) => {
      ctx.font = font(size, isBold);
      return ctx.measureText(text).width;
    };

    const isHighTier = card.rarity === "Legendary" || card.rarity === "Epic";
    const frameColor = isHighTier ? RETRO_PALETTE.textGold : RETRO_PALETTE.windowBorder;

    // 1. カード外枠・ベース背景
    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, width - 12, height - 12);
    ctx.strokeStyle = isHighTier ? RETRO_PALETTE.chestGold : RETRO_PALETTE.wallStone;
    ctx.lineWidth = 2;
    ctx.strokeRect(13, 13, width - 26, height - 26);

    const padL = 30;
    const padR = width - 30;
    const colR = 216;

    // 2. ヘッダー（レアリティバッジ・称号・DNA ID）
    const headY = 20;
    const headH = 66;
    ctx.fillStyle = isHighTier ? "rgba(252, 216, 0, 0.14)" : "rgba(28, 28, 40, 0.9)";
    ctx.fillRect(20, headY, width - 40, headH);

    // レアリティは塗りつぶしバッジにして一目で分かるようにする
    const rarityLabel = card.rarity.toUpperCase();
    ctx.font = font(12, true);
    const badgeW = ctx.measureText(rarityLabel).width + 18;
    ctx.fillStyle = isHighTier ? RETRO_PALETTE.textGold : RETRO_PALETTE.textCyan;
    ctx.fillRect(padL, headY + 10, badgeW, 20);
    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillText(rarityLabel, padL + 9, headY + 24);

    drawFitted(card.subtitle, padL + badgeW + 12, headY + 24, padR - padL - badgeW - 12, RETRO_PALETTE.textWhite, 13);
    drawFitted(card.title, padL, headY + 52, padR - padL, RETRO_PALETTE.textWhite, 21, true);

    // 3. 中央イラスト枠（ジェネラティブ・モンスター）
    const artX = 26;
    const artY = 96;
    const artW = width - 52;
    const artH = 180;

    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillRect(artX, artY, artW, artH);

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
    ctx.fillRect(artX, artY, artW, artH);

    ctx.strokeStyle = pal.primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(artX, artY, artW, artH);

    if (card.dna) {
      // 32pxグリッドのドット絵を枠いっぱいまで拡大する
      GenerativeMonsterRenderer.renderMonster(ctx, artX + artW / 2, artY + artH / 2, card.dna, 4.4);
    }

    // 4. ステータス枠（2列 x 4行のグリッド。ラベル語長が言語で変わるため固定配置）
    const statY = 284;
    const statH = 104;
    ctx.fillStyle = "#101018";
    ctx.fillRect(20, statY, width - 40, statH);
    ctx.strokeStyle = RETRO_PALETTE.wallStone;
    ctx.lineWidth = 1;
    ctx.strokeRect(20, statY, width - 40, statH);

    const statRows = [26, 50, 73, 95];
    const statRow = (r: number) => statY + statRows[r];

    drawText(`${t("card_hp")} ${card.stats.maxHp}`, padL, statRow(0), RETRO_PALETTE.textGreen, 16, true);
    drawText(`${t("card_atk")} ${card.stats.attack}`, colR, statRow(0), RETRO_PALETTE.textRed, 16, true);
    drawText(`${t("card_def")} ${card.stats.defense}`, padL, statRow(1), RETRO_PALETTE.textCyan, 16, true);
    drawText(
      `${t("card_spd")} ${card.stats.agility} (${card.stats.speed})`,
      colR,
      statRow(1),
      RETRO_PALETTE.textGold,
      16,
      true
    );

    const elementText = `${t("card_element")}: ${t(`elem_${card.element}` as Parameters<I18nManager["t"]>[0])}`;
    drawFitted(elementText, padL, statRow(2), 140, accent, 14);

    // 難度ラベルは言語によってかなり長い（Schwierigkeit 等）ので、
    // 左の属性表示と重ならない幅に収まるまで縮めて右端に寄せる
    const elementRight = padL + Math.min(textWidth(elementText, 14), 140);
    drawRight(
      `${t("card_difficulty")}: ★${card.stats.dangerScore.toFixed(1)}/4.0`,
      padR,
      statRow(2),
      RETRO_PALETTE.textWhite,
      13,
      false,
      padR - elementRight - 12
    );

    drawFitted(
      `${t("card_reward")}: ${card.rewards.exp} ${t("exp")} / ${card.rewards.gold} ${t("gold")}`,
      padL,
      statRow(3),
      padR - padL - 100,
      RETRO_PALETTE.textDim,
      13
    );
    drawRight(`JEV ${Math.round(card.jevConfidence * 100)}%`, padR, statRow(3), RETRO_PALETTE.textDim, 13, false, 90);

    // 5. 遺伝子情報欄（8スロット = 2列 x 4行。各セルはスロット名 / 遺伝子コード / 補正の3段）
    const geneY = 394;
    const geneH = 156;
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(20, geneY, width - 40, geneH);
    ctx.strokeStyle = isHighTier ? "rgba(252, 216, 0, 0.5)" : "rgba(120, 120, 165, 0.5)";
    ctx.strokeRect(20, geneY, width - 40, geneH);

    const genome = card.dna ? readGenome(card.dna) : [];
    const bonus = card.dna ? sumGenomeModifiers(card.dna) : { hp: 0, atk: 0, def: 0, agi: 0 };

    const genomeTitle = t("card_genome");
    drawFitted(genomeTitle, padL, geneY + 22, 110, accent, 14, true);
    const genomeTitleRight = padL + Math.min(textWidth(genomeTitle, 14, true), 110);
    drawRight(
      `${t("card_gene_bonus")} HP+${bonus.hp} A+${bonus.atk} D+${bonus.def} S+${bonus.agi}`,
      padR,
      geneY + 22,
      RETRO_PALETTE.textGold,
      12,
      false,
      padR - genomeTitleRight - 12
    );

    ctx.strokeStyle = "rgba(120, 120, 165, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, geneY + 30);
    ctx.lineTo(padR, geneY + 30);
    ctx.stroke();

    const slotLabelKeys: Record<string, Parameters<I18nManager["t"]>[0]> = {
      body: "card_gene_body",
      eyes: "card_gene_eyes",
      mouth: "card_gene_mouth",
      horns: "card_gene_horns",
      wings: "card_gene_wings",
      tail: "card_gene_tail",
      aura: "card_gene_aura",
      palette: "card_gene_palette",
    };

    genome.forEach((gene, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const gx = padL + col * 176;
      const gy = geneY + 52 + row * 28;

      drawFitted(t(slotLabelKeys[gene.slot]), gx, gy, 62, RETRO_PALETTE.textDim, 11);
      drawFitted(gene.code, gx + 66, gy, 104, RETRO_PALETTE.textWhite, 14, true);

      const m = gene.statModifiers;
      if (m) {
        const parts: string[] = [];
        if (m.hp) parts.push(`H${m.hp > 0 ? "+" : ""}${m.hp}`);
        if (m.atk) parts.push(`A${m.atk > 0 ? "+" : ""}${m.atk}`);
        if (m.def) parts.push(`D${m.def > 0 ? "+" : ""}${m.def}`);
        if (m.agi) parts.push(`S${m.agi > 0 ? "+" : ""}${m.agi}`);
        if (parts.length) {
          drawFitted(parts.join(" "), gx + 66, gy + 13, 104, RETRO_PALETTE.textCyan, 11);
        }
      }
    });

    // 6. フッター（討伐者・討伐階層・ハッシュタグ）
    drawFitted(
      `${t("card_slayer")}: ${card.slayerName} (B${card.floor}F)`,
      padL,
      geneY + geneH + 18,
      padR - padL,
      RETRO_PALETTE.textDim,
      12
    );
    drawFitted(
      "#JevDungeon #GenerativeMonster",
      padL,
      geneY + geneH + 38,
      padR - padL,
      RETRO_PALETTE.textGold,
      12,
      true
    );

    return canvas;
  }


  /**
   * 生成されたカード画像をPNGファイルとしてダウンロード保存
   *
   * card.titleはDNAハッシュ由来のID（例: "#0x7F2AC9B1"）であり、"#" など
   * ファイル名に使えない文字を含むため、英数字・ハイフン以外を "_" に置換して安全化する。
   *
   * 保存経路は環境差が大きいため3段構えにしている:
   *  1. File System Access API (showSaveFilePicker)
   *     `blob:` URL のパスはUUIDのみで構成されるため、Electron組み込みブラウザや
   *     一部のWebView環境では `<a download>` の指定が無視され、
   *     "eb79996a-a76e-..." のような拡張子なしUUIDで保存されてしまう。
   *     保存ダイアログへファイル名を直接渡せるこのAPIを最優先で使う。
   *  2. `<a download>` + `blob:` URL (Firefox / Safari など上記API非対応ブラウザ)
   *  3. `<a download>` + data: URL (canvas.toBlob 非対応の旧環境)
   */
  static downloadCardImage(canvas: HTMLCanvasElement, title: string): void {
    const safeTitle = title.replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
    const filename = `JevMonster_${safeTitle || "card"}.png`;

    canvas.toBlob((blob) => {
      if (!blob) {
        // (3) toBlob非対応の古い環境向けフォールバック
        CardRenderer.triggerAnchorDownload(canvas.toDataURL("image/png"), filename);
        return;
      }

      void CardRenderer.savePngBlob(blob, filename);
    }, "image/png");
  }

  /**
   * (1) → (2) の順でPNG Blobを保存する
   */
  private static async savePngBlob(blob: Blob, filename: string): Promise<void> {
    const picker = (
      window as unknown as {
        showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;

    if (typeof picker === "function") {
      try {
        const handle = await picker.call(window, {
          suggestedName: filename,
          types: [{ description: "PNG Image", accept: { "image/png": [".png"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        // ユーザーがダイアログをキャンセルした場合は保存しない（フォールバックもしない）
        if ((err as DOMException | undefined)?.name === "AbortError") return;
        // 非対応・権限エラー時のみ <a download> にフォールバック
      }
    }

    // (2) オブジェクトURLはダウンロード完了後に解放（早すぎると一部ブラウザで保存前に失効する）
    const url = URL.createObjectURL(blob);
    CardRenderer.triggerAnchorDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * `<a download>` を一時生成してクリックし、ダウンロードを発火させる
   */
  private static triggerAnchorDownload(href: string, filename: string): void {
    const link = document.createElement("a");
    link.download = filename;
    link.href = href;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * X (Twitter) への討伐カード共有URLを生成
   */
  static async shareCard(
    _canvas: HTMLCanvasElement,
    card: CardData,
    i18n?: I18nManager
  ): Promise<string> {
    const t = (k: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>) =>
      i18n ? i18n.t(k, params) : String(k);
    const text = t("card_share_text", {
      floor: card.floor,
      title: card.title,
      rarity: card.rarity,
      dnaHash: card.dna?.dnaHash || "N/A",
    });
    const url = "https://typesafe.ai";
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(twitterUrl, "_blank", "noopener,noreferrer");
    return t("card_share_opened");
  }
}
