/**
 * Classic Retro RPG Canvas Renderer with Generative Monsters & Complete i18n
 * Clean Architecture - Presentation Layer
 */

import { Hero, DungeonFloor, BattleState, TileType, ElementType } from "../domain/models";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TILE_SIZE,
  RETRO_PALETTE,
  ELEMENT_PALETTES,
} from "../domain/constants";
import { BaseEquipment } from "../domain/equipmentModels";
import { GenerativeMonsterRenderer } from "./generativeRenderer";
import { I18nManager } from "./i18nManager";

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, private readonly i18n: I18nManager) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not get Canvas 2D context");
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * レトロゲーム特有のクリアで読みやすいシャドウ付きテキスト描画
   */
  private drawRetroText(
    text: string,
    x: number,
    y: number,
    color: string = RETRO_PALETTE.textWhite,
    size: number = 14,
    isBold: boolean = false
  ): void {
    const ctx = this.ctx;
    ctx.font = `${isBold ? "bold " : ""}${size}px 'DotGothic16', 'Press Start 2P', monospace, sans-serif`;
    ctx.textBaseline = "top";

    // 視認性を劇的に高めるドロップシャドウ（黒縁）
    ctx.fillStyle = "#000000";
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillText(text, x + 1, y);
    ctx.fillText(text, x, y + 1);

    // 前景テキスト
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /**
   * クラシックRPGスタイルの固定ウィンドウ枠を描画
   */
  drawRetroWindow(
    x: number,
    y: number,
    w: number,
    h: number,
    borderColor: string = RETRO_PALETTE.windowBorder
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = RETRO_PALETTE.windowBg;
    ctx.fillRect(x, y, w, h);

    // 外枠
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    // 内枠（レトロディテール）
    ctx.strokeStyle = RETRO_PALETTE.wallStoneDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  }

  /**
   * ダンジョン探索画面の描画
   */
  renderDungeon(
    hero: Hero,
    floor: DungeonFloor,
    jevStatus: { isThinking: boolean; lastLatencyMs: number; isSimulated: boolean }
  ): void {
    const ctx = this.ctx;

    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // タイルマップ描画（たいまつ視界エフェクト）
    for (let r = 0; r < floor.height; r++) {
      for (let c = 0; c < floor.width; c++) {
        const x = c * TILE_SIZE;
        const y = yOffset(r);
        const tile = floor.tiles[r][c];

        const dist = Math.hypot(hero.x - c, hero.y - r);
        if (dist > 5.5) {
          ctx.fillStyle = RETRO_PALETTE.black;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          continue;
        }

        this.renderTile(tile, x, y, floor.ambientElement);

        if (dist > 3.0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, (dist - 3.0) * 0.35)})`;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // 勇者の描画（グリッド位置）
    this.renderHero(hero.x * TILE_SIZE, yOffset(hero.y), hero.facing);

    // 上部ステータスウィンドウ（多言語対応・フロア名なし）
    this.renderDungeonHUD(hero, floor, jevStatus);
  }

  /**
   * コマンド戦闘画面の描画（ジェネラティブモンスター＆8言語対応）
   */
  renderBattle(
    hero: Hero,
    battle: BattleState,
    jevStatus: { isThinking: boolean; lastLatencyMs: number; isSimulated: boolean }
  ): void {
    const ctx = this.ctx;
    const t = (k: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>) =>
      this.i18n.t(k, params);

    ctx.fillStyle = RETRO_PALETTE.black;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. ジェネラティブ・モンスターのドット絵描画（DNAパーツ合成・中央）
    if (battle.monster.dna) {
      GenerativeMonsterRenderer.renderMonster(
        ctx,
        CANVAS_WIDTH / 2,
        145,
        battle.monster.dna,
        2.5
      );
    }

    // 2. 敵情報ウィンドウ（上部：多言語モンスター名、DNAハッシュ、HPバー）
    this.drawRetroWindow(100, 14, 440, 56);
    const monsterDisplayName = this.i18n.getMonsterName(
      battle.monster.dna,
      battle.monster.rarity
    );
    this.drawRetroText(monsterDisplayName, 116, 22, RETRO_PALETTE.textWhite, 15, true);

    // DNAハッシュバッジ
    if (battle.monster.dna) {
      this.drawRetroText(
        `DNA: ${battle.monster.dna.dnaHash}`,
        350,
        24,
        RETRO_PALETTE.textGold,
        11
      );
    }

    // 敵HPバー
    const enemyHpRatio = Math.max(0, battle.monster.currentHp / battle.monster.maxHp);
    ctx.fillStyle = RETRO_PALETTE.wallStoneDark;
    ctx.fillRect(116, 46, 408, 8);
    ctx.fillStyle = enemyHpRatio > 0.3 ? RETRO_PALETTE.textCyan : RETRO_PALETTE.textRed;
    ctx.fillRect(116, 46, Math.round(408 * enemyHpRatio), 8);

    // 3. 勇者ステータスウィンドウ（右上：固定サイズ 170x130）
    this.drawRetroWindow(450, 185, 170, 135);
    this.drawRetroText(`【${t("hero")}】`, 466, 196, RETRO_PALETTE.textGold, 14, true);
    this.drawRetroText(`${t("hp")}: ${hero.stats.currentHp}/${hero.stats.maxHp}`, 466, 220, RETRO_PALETTE.textWhite, 13);
    this.drawRetroText(`${t("mp")}: ${hero.stats.currentMp}/${hero.stats.maxMp}`, 466, 242, RETRO_PALETTE.textWhite, 13);
    this.drawRetroText(`${t("level")}: ${hero.stats.level}`, 466, 264, RETRO_PALETTE.textWhite, 13);
    this.drawRetroText(`やくそう: x${hero.herbs}`, 466, 286, RETRO_PALETTE.textCyan, 13);

    // 4. コマンドウィンドウ（左下：固定サイズ 190x135）
    this.drawRetroWindow(20, 185, 190, 135);
    const commands = [t("fight"), t("spell"), t("item"), t("run")];
    commands.forEach((cmd, idx) => {
      const cy = 196 + idx * 28;
      if (battle.phase === "command_select" && battle.cursorIndex === idx) {
        this.drawRetroText("▶", 30, cy, RETRO_PALETTE.textGold, 14, true);
        this.drawRetroText(cmd, 50, cy, RETRO_PALETTE.textGold, 14, true);
      } else {
        this.drawRetroText(cmd, 50, cy, RETRO_PALETTE.textWhite, 14);
      }
    });

    // じゅもんサブメニュー（選択時：固定サイズ 220x135）
    if (battle.phase === "spell_select") {
      this.drawRetroWindow(215, 185, 225, 135, RETRO_PALETTE.textCyan);
      hero.spells.forEach((sp, sIdx) => {
        const sy = 196 + sIdx * 32;
        const spKey = `spell_${sp.id}` as Parameters<I18nManager["t"]>[0];
        const spName = this.i18n.t(spKey) || sp.name;
        const isSelected = battle.selectedSpellIndex === sIdx;
        const spColor = isSelected ? RETRO_PALETTE.textCyan : RETRO_PALETTE.textWhite;

        if (isSelected) {
          this.drawRetroText("▶", 225, sy, RETRO_PALETTE.textCyan, 14, true);
        }
        this.drawRetroText(`${spName} (${t("mp")}:${sp.mpCost})`, 245, sy, spColor, 14, isSelected);
      });
    }

    // 5. 最下部メッセージウィンドウ（固定サイズ・横幅いっぱい）
    this.drawRetroWindow(20, 330, CANVAS_WIDTH - 40, 180);
    const currentMsg = battle.turnMessages[battle.currentMessageIndex] || "";
    this.drawRetroText(currentMsg, 38, 350, RETRO_PALETTE.textWhite, 15, false);

    if (battle.turnMessages.length > battle.currentMessageIndex + 1) {
      this.drawRetroText("▼", CANVAS_WIDTH - 50, 480, RETRO_PALETTE.textGold, 14);
    }

    // 6. Jev AI ステータスランプ
    this.renderJevLamp(jevStatus);
  }

  /**
   * 装備・インベントリ画面の描画（完全着脱対応 ＆ 抜群の読みやすさ）
   */
  renderEquipmentMenu(hero: Hero, selectedIndex: number = 0): void {
    const t = (k: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>) =>
      this.i18n.t(k, params);

    // 全体背景を薄暗く
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 外枠ウィンドウ（固定サイズ 590x480）
    this.drawRetroWindow(25, 20, 590, 490, RETRO_PALETTE.textGold);

    // タイトル
    this.drawRetroText(t("ui_inventory_title"), 45, 36, RETRO_PALETTE.textGold, 16, true);

    // --- 左側：現在の装備とステータス（横幅 260px） ---
    this.drawRetroWindow(40, 68, 255, 375);
    this.drawRetroText("【 現在の装備 】", 54, 80, RETRO_PALETTE.textCyan, 14, true);

    const weapon = hero.inventory.equipments.find((e) => e.id === hero.inventory.equippedWeaponId);
    const shield = hero.inventory.equipments.find((e) => e.id === hero.inventory.equippedShieldId);
    const armor = hero.inventory.equipments.find((e) => e.id === hero.inventory.equippedArmorId);
    const acc = hero.inventory.equipments.find((e) => e.id === hero.inventory.equippedAccessoryId);

    const wDisp = weapon ? this.i18n.getEquipmentName(weapon.nameKey) : hero.weapon.name;
    const sDisp = shield ? this.i18n.getEquipmentName(shield.nameKey) : hero.shield.name;
    const aDisp = armor ? this.i18n.getEquipmentName(armor.nameKey) : "-";
    const accDisp = acc ? this.i18n.getEquipmentName(acc.nameKey) : "-";

    this.drawRetroText(`${t("slot_weapon")}:`, 54, 110, RETRO_PALETTE.textGold, 13);
    this.drawRetroText(`${wDisp} (+${hero.weapon.attack})`, 70, 130, RETRO_PALETTE.textWhite, 13);

    this.drawRetroText(`${t("slot_shield")}:`, 54, 160, RETRO_PALETTE.textGold, 13);
    this.drawRetroText(`${sDisp} (+${hero.shield.defense})`, 70, 180, RETRO_PALETTE.textWhite, 13);

    this.drawRetroText(`${t("slot_armor")}:`, 54, 210, RETRO_PALETTE.textGold, 13);
    this.drawRetroText(`${aDisp} (+${armor?.defenseBonus || 0})`, 70, 230, RETRO_PALETTE.textWhite, 13);

    this.drawRetroText(`${t("slot_accessory")}:`, 54, 260, RETRO_PALETTE.textGold, 13);
    this.drawRetroText(`${accDisp} (+${acc?.attackBonus || 0})`, 70, 280, RETRO_PALETTE.textWhite, 13);

    // 総合能力値
    const totalAtk = hero.stats.attack + hero.weapon.attack + (acc?.attackBonus || 0);
    const totalDef = hero.stats.defense + hero.shield.defense + (armor?.defenseBonus || 0);
    this.drawRetroText("───────────────", 54, 310, RETRO_PALETTE.wallStone, 12);
    this.drawRetroText(`${t("attack")}: ${totalAtk}`, 54, 330, RETRO_PALETTE.textCyan, 14, true);
    this.drawRetroText(`${t("defense")}: ${totalDef}`, 150, 330, RETRO_PALETTE.textCyan, 14, true);
    this.drawRetroText(`やくそう所持: x${hero.herbs}`, 54, 360, RETRO_PALETTE.textGold, 14, true);
    this.drawRetroText(`HP: ${hero.stats.currentHp}/${hero.stats.maxHp}`, 54, 390, RETRO_PALETTE.textWhite, 13);

    // --- 右側：所持品一覧（道具 ＋ 装備品一覧、横幅 275px） ---
    this.drawRetroWindow(305, 68, 290, 375);
    this.drawRetroText("【 もちもの一覧 】", 320, 80, RETRO_PALETTE.textCyan, 14, true);

    // リスト構成: [0]: やくそう、[1..N]: 装備品
    const items: Array<{
      type: "herb" | "equip";
      name: string;
      isEquipped: boolean;
      detail: string;
      equipObj?: BaseEquipment;
    }> = [];

    items.push({
      type: "herb",
      name: `やくそう (x${hero.herbs})`,
      isEquipped: false,
      detail: "HPを35回復",
    });

    hero.inventory.equipments.forEach((eq) => {
      const isEq =
        eq.id === hero.inventory.equippedWeaponId ||
        eq.id === hero.inventory.equippedShieldId ||
        eq.id === hero.inventory.equippedArmorId ||
        eq.id === hero.inventory.equippedAccessoryId;
      const eqName = this.i18n.getEquipmentName(eq.nameKey) || eq.nameKey;
      const statDesc =
        eq.slot === "weapon"
          ? `攻+${eq.attackBonus}`
          : eq.slot === "shield" || eq.slot === "armor"
          ? `守+${eq.defenseBonus}`
          : `攻+${eq.attackBonus} 守+${eq.defenseBonus}`;

      items.push({
        type: "equip",
        name: `${eqName}`,
        isEquipped: isEq,
        detail: `${statDesc}`,
        equipObj: eq,
      });
    });

    // 描画（最大8件スクロールまたは表示）
    const startIndex = Math.max(0, Math.min(selectedIndex - 5, items.length - 7));
    const visibleItems = items.slice(startIndex, startIndex + 7);

    visibleItems.forEach((item, vIdx) => {
      const actualIdx = startIndex + vIdx;
      const iy = 110 + vIdx * 44;
      const isSelected = actualIdx === selectedIndex;

      if (isSelected) {
        this.drawRetroText("▶", 314, iy, RETRO_PALETTE.textGold, 14, true);
      }

      const nameColor = isSelected
        ? RETRO_PALETTE.textGold
        : item.isEquipped
        ? RETRO_PALETTE.textCyan
        : RETRO_PALETTE.textWhite;

      const badge = item.isEquipped ? " [E]" : "";
      this.drawRetroText(`${item.name}${badge}`, 332, iy, nameColor, 14, isSelected);
      this.drawRetroText(`  ${item.detail}`, 332, iy + 18, RETRO_PALETTE.wallStone, 12);
    });

    // 下部：操作ガイド
    this.drawRetroText(
      "[W/S] 選択  [ENTER] そうび/つかう  [E/ESC] とじる",
      45,
      460,
      RETRO_PALETTE.textGold,
      13,
      true
    );
  }

  private renderTile(tile: TileType, x: number, y: number, element: ElementType): void {
    const ctx = this.ctx;
    const pal = ELEMENT_PALETTES[element] || ELEMENT_PALETTES.normal;

    if (tile === "wall") {
      ctx.fillStyle = RETRO_PALETTE.wallStone;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = RETRO_PALETTE.wallStoneDark;
      ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      ctx.fillStyle = pal.primary;
      ctx.fillRect(x + 8, y + 8, 2, 8);
      ctx.fillRect(x + 10, y + 16, 8, 2);
    } else if (tile === "stairs_down") {
      ctx.fillStyle = RETRO_PALETTE.stairsBlue;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = RETRO_PALETTE.black;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(x + 4 + i * 4, y + 4 + i * 4, TILE_SIZE - 8 - i * 4, 3);
      }
    } else if (tile === "chest") {
      ctx.fillStyle = RETRO_PALETTE.floorStoneDark;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = RETRO_PALETTE.chestGold;
      ctx.fillRect(x + 6, y + 8, 20, 16);
      ctx.fillStyle = RETRO_PALETTE.black;
      ctx.fillRect(x + 14, y + 14, 4, 6);
    } else if (tile === "chest_opened") {
      ctx.fillStyle = RETRO_PALETTE.floorStoneDark;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = RETRO_PALETTE.wallStone;
      ctx.fillRect(x + 6, y + 12, 20, 12);
      ctx.fillStyle = RETRO_PALETTE.black;
      ctx.fillRect(x + 8, y + 14, 16, 8);
    } else {
      // 床
      ctx.fillStyle = RETRO_PALETTE.floorStone;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = RETRO_PALETTE.floorStoneDark;
      ctx.fillRect(x + 4, y + 4, 2, 2);
      ctx.fillRect(x + 18, y + 20, 2, 2);
    }
  }

  private renderHero(x: number, y: number, facing: "up" | "down" | "left" | "right"): void {
    const ctx = this.ctx;

    // 影
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.ellipse(x + 16, y + 28, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 体（ロイヤルブルー）
    ctx.fillStyle = "#0078f8";
    ctx.fillRect(x + 8, y + 12, 16, 14);

    // 頭・肌
    ctx.fillStyle = "#fcd8a8";
    ctx.fillRect(x + 10, y + 4, 12, 10);

    // 兜 / 髪（ゴールド）
    ctx.fillStyle = "#fcd800";
    ctx.fillRect(x + 8, y + 2, 16, 4);

    // 目
    ctx.fillStyle = "#000000";
    if (facing === "down") {
      ctx.fillRect(x + 12, y + 8, 2, 2);
      ctx.fillRect(x + 18, y + 8, 2, 2);
    } else if (facing === "left") {
      ctx.fillRect(x + 10, y + 8, 2, 2);
    } else if (facing === "right") {
      ctx.fillRect(x + 20, y + 8, 2, 2);
    }

    // 盾（左手側）
    ctx.fillStyle = "#e40058";
    ctx.fillRect(x + 4, y + 14, 4, 10);

    // 剣（右手側）
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + 24, y + 8, 2, 14);
    ctx.fillStyle = "#fcd800";
    ctx.fillRect(x + 23, y + 14, 4, 2);
  }

  /**
   * 上部HUD: 終わりがないゲームのため、フロア名なしで「地下{floor}階」のみを表示！
   */
  private renderDungeonHUD(
    hero: Hero,
    floor: DungeonFloor,
    jevStatus: { isThinking: boolean; lastLatencyMs: number; isSimulated: boolean }
  ): void {
    const t = (k: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>) =>
      this.i18n.t(k, params);

    // 固定サイズの上部ステータスバー
    this.drawRetroWindow(12, 8, CANVAS_WIDTH - 24, 38);

    // フロア名は排除し、「地下何階」のみをくっきり描画！
    const floorLabel = t("floor_status", { floor: floor.floorNumber });
    this.drawRetroText(floorLabel, 26, 18, RETRO_PALETTE.textGold, 15, true);

    // 勇者のステータス（固定X座標）
    this.drawRetroText(`${t("level")}:${hero.stats.level}`, 160, 19, RETRO_PALETTE.textWhite, 14);
    this.drawRetroText(`${t("hp")}:${hero.stats.currentHp}/${hero.stats.maxHp}`, 235, 19, RETRO_PALETTE.textWhite, 14);
    this.drawRetroText(`${t("mp")}:${hero.stats.currentMp}/${hero.stats.maxMp}`, 350, 19, RETRO_PALETTE.textWhite, 14);
    this.drawRetroText(`やくそう:x${hero.herbs}`, 455, 19, RETRO_PALETTE.textCyan, 14, true);

    this.renderJevLamp(jevStatus);
  }

  private renderJevLamp(jevStatus: {
    isThinking: boolean;
    lastLatencyMs: number;
    isSimulated: boolean;
  }): void {
    const ctx = this.ctx;
    const jevColor = jevStatus.isThinking
      ? RETRO_PALETTE.textGold
      : jevStatus.isSimulated
      ? RETRO_PALETTE.textCyan
      : "#00ff88";

    ctx.fillStyle = jevColor;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH - 45, 27, 4, 0, Math.PI * 2);
    ctx.fill();

    this.drawRetroText(`JEV`, CANVAS_WIDTH - 36, 20, RETRO_PALETTE.textWhite, 10, true);
  }
}

function yOffset(gridY: number): number {
  return 48 + gridY * TILE_SIZE;
}
