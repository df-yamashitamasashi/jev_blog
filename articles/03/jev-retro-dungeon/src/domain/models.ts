/**
 * Classic Retro RPG Dungeon & Battle Domain Models
 * Clean Architecture - Domain Layer
 */

import { MonsterDNA } from "./dnaModels";
import { Inventory } from "./equipmentModels";

export type ElementType = "normal" | "crimson" | "frost" | "shadow" | "golden";

export interface Weapon {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly attack: number;
  readonly element: ElementType;
  readonly level: number;
}

export interface Shield {
  readonly id: string;
  readonly name: string;
  readonly defense: number;
}

export interface Spell {
  readonly id: string;
  readonly name: string;
  readonly mpCost: number;
  readonly type: "attack" | "heal";
  readonly power: number;
  readonly description: string;
}

export interface HeroStats {
  maxHp: number;
  currentHp: number;
  maxMp: number;
  currentMp: number;
  attack: number;
  defense: number;
  agility: number;
  level: number;
  exp: number;
  nextLevelExp: number;
  gold: number;
}

export interface Hero {
  x: number; // グリッドX
  y: number; // グリッドY
  facing: "up" | "down" | "left" | "right";
  stats: HeroStats;
  weapon: Weapon;
  shield: Shield;
  inventory: Inventory;
  spells: Spell[];
  herbs: number; // やくそうの所持数
  stepsTaken: number;
}

export type MonsterType = "slime" | "drakky" | "skeleton" | "mage" | "golem" | "dragon_lord";

export interface Monster {
  readonly id: string;
  readonly name: string;
  readonly type: MonsterType;
  readonly element: ElementType;
  readonly dna: MonsterDNA; // CryptoKitties/CryptoPunks風の遺伝子スロット
  readonly maxHp: number;
  currentHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly agility: number;
  readonly expReward: number;
  readonly goldReward: number;
  readonly isBoss: boolean;
  readonly rarity: "Common" | "Rare" | "Epic" | "Legendary";
}

export type TileType = "wall" | "floor" | "stairs_down" | "chest" | "chest_opened";

export interface DungeonFloor {
  readonly floorNumber: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: TileType[][];
  readonly themeName: string;
  readonly themeKey: string;
  readonly ambientElement: ElementType;
  readonly dangerScore: number;
}

export type BattleCommand = "fight" | "spell" | "defend" | "item" | "run";

export type BattlePhase =
  | "command_select"
  | "spell_select"
  | "action_resolving"
  | "message_wait"
  | "victory"
  | "defeat"
  | "escaped";

export interface BattleState {
  monster: Monster;
  phase: BattlePhase;
  cursorIndex: number;
  selectedSpellIndex: number;
  turnMessages: string[];
  currentMessageIndex: number;
  isHeroDefending: boolean;
  canEscape: boolean;
  /**
   * turnMessages を読み終えた後に手番を渡す相手。
   * "monster" ならモンスターの反撃へ、"hero" ならコマンド選択へ戻る。
   * これが無いとモンスターのターン終了後に再びモンスターのターンが走り続ける。
   */
  pendingActor: "hero" | "monster";
  atbHero: number; // 0.0 〜 1.0 (リアルタイムATBゲージ)
  atbMonster: number;
}

export interface CardData {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly monsterType: MonsterType;
  readonly element: ElementType;
  readonly rarity: "Common" | "Rare" | "Epic" | "Legendary";
  readonly stats: {
    readonly maxHp: number;
    readonly attack: number;
    readonly defense: number;
    /** すばやさのランク表記（S / A / B） */
    readonly speed: string;
    /** すばやさの実数値 */
    readonly agility: number;
    readonly dangerScore: number;
  };
  /** 討伐報酬 */
  readonly rewards: {
    readonly exp: number;
    readonly gold: number;
  };
  readonly dna: MonsterDNA;
  readonly flavorText: string;
  readonly slayerName: string;
  readonly floor: number;
  readonly timestamp: number;
  readonly jevConfidence: number;
}
