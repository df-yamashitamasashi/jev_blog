/**
 * Classic Retro RPG Game Director with Generative Monsters & Equipment Drops
 * Clean Architecture - Use Case Layer
 */

import { IJevClient } from "../adapters/jevClient";
import {
  Hero,
  Monster,
  DungeonFloor,
  TileType,
  ElementType,
  Weapon,
} from "../domain/models";
import { BaseEquipment, EquipmentSlot } from "../domain/equipmentModels";
import { GenerativeMonsterUseCase } from "./generativeMonsterUseCase";
import { MAP_COLS, MAP_ROWS } from "../domain/constants";
import { I18nManager } from "../presentation/i18nManager";
import { TranslationDictionary } from "../domain/i18nTypes";
import { pickWeightedChoice } from "./jevChoice";

export class GameDirectorUseCase {
  private readonly generativeMonsterUseCase: GenerativeMonsterUseCase;
  private readonly i18n: I18nManager;

  constructor(private readonly jevClient: IJevClient, i18n?: I18nManager) {
    this.generativeMonsterUseCase = new GenerativeMonsterUseCase(jevClient);
    this.i18n = i18n ?? new I18nManager();
  }

  /**
   * Jevがダンジョンフロアの環境属性・危険度・テーマを決定し、迷宮マップを生成
   */
  async directDungeonFloor(hero: Hero, floorNumber: number): Promise<{
    floor: DungeonFloor;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const hpRatio = Math.round((hero.stats.currentHp / hero.stats.maxHp) * 100) / 100;
    const state = {
      floorNumber,
      heroHpRatio: hpRatio,
      heroLevel: hero.stats.level,
      gold: hero.stats.gold,
      stepsTaken: hero.stepsTaken,
      situation: hpRatio < 0.3 ? "critical_low_hp" : "stable",
    };

    const { response, latencyMs, isSimulated } = await this.jevClient.systemOne({
      state,
      questions: {
        floorTheme: {
          type: "choice",
          instructions: "ダンジョン地下階層の環境属性を選択してください",
          criteria: {
            normal: "湿り気を帯びた古の洞窟（通常属性）",
            crimson: "マグマの熱気漂う紅蓮の回廊（火炎属性）",
            frost: "氷柱と冷気に包まれた凍土の地下迷宮（氷結属性）",
            shadow: "紫の瘴気が渦巻く深淵の魔窟（暗黒属性）",
            golden: "金色の光が微かに差し込む古代宝物殿（黄金属性）",
          },
        },
        dangerScore: {
          type: "score",
          instructions: "この階層の魔物の凶暴度とエンカウント危険度を評価してください",
          criteria: [
            "初級の洞窟、魔物の気配は疎ら",
            "中級の迷宮、適度な警戒が必要",
            "上級の魔境、強力な魔物が徘徊",
            "最深層の地獄、死と隣り合わせの試練",
          ],
        },
      },
    });

    const themeAns = response.answers["floorTheme"];
    const dangerAns = response.answers["dangerScore"];

    const chosenTheme = (themeAns?.type === "choice" ? pickWeightedChoice(themeAns) : "normal") as ElementType;
    // criteria配列は0始まりなので、従来の1.0〜4.0スケールに合わせるため+1する
    const dangerScore = dangerAns?.type === "score" ? dangerAns.score + 1 : 2.0;

    const themeTitles: Record<ElementType, string> = {
      normal: "古の迷宮洞窟",
      crimson: "灼熱の溶岩洞窟",
      frost: "永久凍土の氷穴",
      shadow: "虚無渦巻く魔窟",
      golden: "失われた黄金迷宮",
    };

    const tiles = this.generateDungeonTiles(floorNumber);

    const floor: DungeonFloor = {
      floorNumber,
      width: MAP_COLS,
      height: MAP_ROWS,
      tiles,
      themeName: themeTitles[chosenTheme] || "未知の洞窟",
      themeKey: `theme_${chosenTheme}`,
      ambientElement: chosenTheme,
      dangerScore,
    };

    return { floor, latencyMs, isSimulated };
  }

  /**
   * 1歩歩くごとのJevエンカウント判定（2.2億通りからDNA配合）
   */
  async checkEncounter(
    hero: Hero,
    floor: DungeonFloor,
    /** 前回の戦闘からの歩数。累計歩数ではなく、この値が遭遇判断の主材料になる */
    stepsSinceLastBattle = 0
  ): Promise<{
    shouldEncounter: boolean;
    monster?: Monster;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const hpRatio = Math.round((hero.stats.currentHp / hero.stats.maxHp) * 100) / 100;
    const state = {
      floor: floor.floorNumber,
      floorTheme: floor.ambientElement,
      heroHpRatio: hpRatio,
      steps: stepsSinceLastBattle,
      totalSteps: hero.stepsTaken,
      dangerScore: floor.dangerScore,
    };

    const { response, latencyMs, isSimulated } = await this.jevClient.systemOne({
      state,
      questions: {
        shouldEncounter: {
          type: "noul",
          instructions: "この歩行ステップで魔物と遭遇（エンカウント）すべきですか？",
        },
      },
    });

    const encAns = response.answers["shouldEncounter"];
    // 確実かつ快適にエンカウントするように調整 (レトロRPG標準: 35%〜60%)
    const shouldEncounter = encAns?.type === "noul" ? encAns.noul >= 0.40 : true;

    if (!shouldEncounter) {
      return { shouldEncounter: false, latencyMs, isSimulated };
    }

    // JevによるCryptoKitties風DNAモンスター配合の呼び出し
    const { monster, latencyMs: genLatency } = await this.generativeMonsterUseCase.generateMonster(
      floor,
      hero.stats.level,
      hpRatio
    );

    return { shouldEncounter: true, monster, latencyMs: latencyMs + genLatency, isSimulated };
  }

  /**
   * 即時エンカウント（テスト用・ユーザー体験用）
   */
  async forceEncounter(hero: Hero, floor: DungeonFloor): Promise<Monster> {
    const hpRatio = Math.round((hero.stats.currentHp / hero.stats.maxHp) * 100) / 100;
    const { monster } = await this.generativeMonsterUseCase.generateMonster(
      floor,
      hero.stats.level,
      hpRatio
    );
    return monster;
  }

  /**
   * 宝箱を開けたときのJevによる装備ドロップ判定
   */
  async directChestEquipment(floorNumber: number): Promise<BaseEquipment | null> {
    const state = { floorNumber, floor: floorNumber };
    const { response } = await this.jevClient.systemOne({
      state,
      questions: {
        equipmentSlot: {
          type: "choice",
          instructions: "宝箱から出現する武具の種類を選定してください",
          criteria: {
            weapon: "鋭い刃を持つ武器（こうげき力上昇）",
            shield: "硬質な盾（しゅび力上昇）",
            armor: "頑丈な鎧（しゅび力大幅上昇）",
            accessory: "神秘の装飾品（ステータス総合上昇）",
          },
        },
        equipmentTier: {
          type: "score",
          instructions: "武具のレアリティと強さを評価してください",
          criteria: [
            "一般的な武具（Common）",
            "鍛えられた良品（Rare）",
            "名工の業物（Epic）",
            "神話に謳われし神器（Legendary）",
          ],
        },
      },
    });

    const slotAns = response.answers["equipmentSlot"];
    const tierAns = response.answers["equipmentTier"];

    const slot = (slotAns?.type === "choice" ? pickWeightedChoice(slotAns) : "weapon") as EquipmentSlot;
    // criteria配列は0始まりなので、従来の1.0〜4.0スケールに合わせるため+1する
    const tierScore = tierAns?.type === "score" ? tierAns.score + 1 : 1.5;

    const rarity =
      tierScore >= 3.5 ? "Legendary" : tierScore >= 2.6 ? "Epic" : tierScore >= 1.8 ? "Rare" : "Common";

    const baseStats = {
      weapon: { atk: 12 + floorNumber * 4, def: 0, agi: 0, key: "steel_blade" },
      shield: { atk: 0, def: 6 + floorNumber * 3, agi: 0, key: "iron_shield" },
      armor: { atk: 0, def: 10 + floorNumber * 4, agi: 0, key: "iron_armor" },
      accessory: { atk: 4 + floorNumber * 2, def: 4 + floorNumber * 2, agi: 4, key: "power_ring" },
    }[slot];

    return {
      id: `eq_${Date.now()}`,
      nameKey: baseStats.key,
      slot,
      rarity,
      attackBonus: baseStats.atk,
      defenseBonus: baseStats.def,
      agilityBonus: baseStats.agi,
      element: "golden",
    };
  }

  /**
   * 戦闘中、モンスターの行動をJevにリアルタイム判断させる
   */
  async directMonsterAction(
    monster: Monster,
    hero: Hero
  ): Promise<{
    action: "attack" | "spell" | "defend" | "critical";
    spellName?: string;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const heroHpRatio = Math.round((hero.stats.currentHp / hero.stats.maxHp) * 100) / 100;
    const monsterHpRatio = Math.round((monster.currentHp / monster.maxHp) * 100) / 100;

    const state = {
      monsterName: monster.name,
      monsterDna: monster.dna.dnaHash,
      monsterHpRatio,
      heroHpRatio,
      heroLevel: hero.stats.level,
      isBoss: monster.isBoss,
    };

    const { response, latencyMs, isSimulated } = await this.jevClient.systemOne({
      state,
      questions: {
        monsterAction: {
          type: "choice",
          instructions: "モンスターがこのターンにとるべき最も効果的な行動を選択してください",
          criteria: {
            attack: "通常の物理攻撃（確実にダメージを狙う）",
            spell: "呪文攻撃（ファイアで防御を無視して削る）",
            critical: "力を溜めて放つ痛恨の一撃（クリティカル）",
            defend: "身を守り次の好機を窺う",
          },
        },
      },
    });

    const actAns = response.answers["monsterAction"];
    const action = (actAns?.type === "choice" ? pickWeightedChoice(actAns) : "attack") as
      | "attack"
      | "spell"
      | "defend"
      | "critical";

    return {
      action,
      // 表示テキストではなくスペルID（"fire"）を返し、ローカライズはUI側のspell_fireキーで行う
      spellName: action === "spell" ? "fire" : undefined,
      latencyMs,
      isSimulated,
    };
  }

  /**
   * 勝利後の武器の進化・二つ名覚醒判定
   */
  async directWeaponAwakening(hero: Hero, floorNumber = 1): Promise<{
    weapon: Weapon;
    awakeningText: string;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const state = {
      currentWeapon: hero.weapon.name,
      level: hero.weapon.level,
      heroLevel: hero.stats.level,
      gold: hero.stats.gold,
      floorNumber,
      heroHpRatio: Math.round((hero.stats.currentHp / hero.stats.maxHp) * 100) / 100,
    };

    const { response, latencyMs, isSimulated } = await this.jevClient.systemOne({
      state,
      questions: {
        prefixName: {
          type: "choice",
          instructions: "武器に宿る二つ名・称号を選択してください",
          criteria: {
            holy: "伝説の神話に謳われし『聖なる』",
            flame: "業火を纏い敵を焼き尽くす『ほのおの』",
            thunder: "稲妻の一撃を宿す『いなずまの』",
            light: "邪悪を祓う聖なる光『ひかりの』",
            miracle: "振るうたびに生命を取り戻す『きせきの』",
          },
        },
        attackBonus: {
          type: "score",
          instructions: "武器攻撃力の上昇幅を評価してください",
          criteria: [
            "わずかな研ぎ澄まし（ATK +3）",
            "鋭利な切れ味の覚醒（ATK +6）",
            "名工を越える業物（ATK +10）",
            "神話級の覚醒（ATK +15）",
          ],
        },
      },
    });

    const prefixAns = response.answers["prefixName"];
    const bonusAns = response.answers["attackBonus"];

    // プレフィックスは現在のUI言語でローカライズして武器名を合成する
    // （固有の武器種名は保持せず、汎用の「剣」ベース名 + プレフィックスで再構成する。
    //   これによりどの言語でも「Xの」のような日本語文法に依存せず一貫して組み立てられる）
    const pMap: Record<string, { prefixKey: keyof TranslationDictionary; elem: ElementType }> = {
      holy: { prefixKey: "weapon_prefix_holy", elem: "golden" },
      flame: { prefixKey: "weapon_prefix_flame", elem: "crimson" },
      thunder: { prefixKey: "weapon_prefix_thunder", elem: "frost" },
      light: { prefixKey: "weapon_prefix_light", elem: "golden" },
      miracle: { prefixKey: "weapon_prefix_miracle", elem: "normal" },
    };

    const selected =
      pMap[prefixAns?.type === "choice" ? pickWeightedChoice(prefixAns) : "flame"] || pMap.flame;
    // criteria配列は0始まりなので、従来の1.0〜4.0スケールに合わせるため+1する
    const bonus = Math.round(((bonusAns?.type === "score" ? bonusAns.score + 1 : 2.0)) * 3);
    const prefix = this.i18n.t(selected.prefixKey);
    const oldWeaponName = hero.weapon.name;

    const newWeapon: Weapon = {
      id: `wpn_${Date.now()}`,
      name: `${prefix} ${this.i18n.t("weapon_base_name")}`.trim(),
      prefix,
      attack: hero.weapon.attack + bonus,
      element: selected.elem,
      level: hero.weapon.level + 1,
    };

    const awakeningText = this.i18n.t("weapon_awakened_detail", {
      oldName: oldWeaponName,
      newName: newWeapon.name,
      bonus,
    });

    return { weapon: newWeapon, awakeningText, latencyMs, isSimulated };
  }

  private generateDungeonTiles(floorNumber: number): TileType[][] {
    const tiles: TileType[][] = [];

    for (let r = 0; r < MAP_ROWS; r++) {
      tiles[r] = [];
      for (let c = 0; c < MAP_COLS; c++) {
        if (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1) {
          tiles[r][c] = "wall";
        } else {
          if (r % 2 === 0 && c % 2 === 0 && Math.random() < 0.6) {
            tiles[r][c] = "wall";
          } else {
            tiles[r][c] = "floor";
          }
        }
      }
    }

    tiles[MAP_ROWS - 2][MAP_COLS - 2] = "stairs_down";

    const chestCount = floorNumber % 2 === 0 ? 2 : 1;
    for (let i = 0; i < chestCount; i++) {
      const cr = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
      const cc = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
      if (tiles[cr][cc] === "floor" && !(cr === 2 && cc === 2)) {
        tiles[cr][cc] = "chest";
      }
    }

    tiles[2][2] = "floor";
    tiles[2][3] = "floor";
    tiles[3][2] = "floor";

    return tiles;
  }
}
