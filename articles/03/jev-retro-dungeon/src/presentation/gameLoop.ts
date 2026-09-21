/**
 * Classic Retro RPG Game Loop & State Machine (Generative Monsters & Equipment)
 * Clean Architecture - Presentation Layer
 */

import {
  Hero,
  DungeonFloor,
  BattleState,
  Monster,
  CardData,
} from "../domain/models";
import { INITIAL_EQUIPMENT, BaseEquipment } from "../domain/equipmentModels";
import { HERB_HEAL_AMOUNT } from "../domain/constants";
import { GameDirectorUseCase } from "../usecases/gameDirectorUseCase";
import { BattleUseCase } from "../usecases/battleUseCase";
import { CardGeneratorUseCase } from "../usecases/cardGeneratorUseCase";
import { BgmComposerUseCase } from "../usecases/bgmComposerUseCase";
import { ISoundEngine } from "../adapters/soundEngine";
import { CanvasRenderer } from "./canvasRenderer";
import { InputHandler } from "./inputHandler";
import { CardRenderer } from "./cardRenderer";
import { I18nManager } from "./i18nManager";
import { AudioSynthesizer } from "./audioSynthesizer";

export interface GameLoopCallbacks {
  onCardGenerated: (card: CardData, cardCanvas: HTMLCanvasElement) => void;
  onLogMessage: (msg: string, type: "info" | "jev" | "combat" | "evolution") => void;
}

export type GameMode = "dungeon" | "battle" | "equip_menu" | "paused";

export class GameLoop {
  private isRunning = false;
  private mode: GameMode = "dungeon";

  private hero: Hero;
  private currentFloor!: DungeonFloor;
  private battleState: BattleState | null = null;
  private floorNumber = 1;
  private inventoryCursorIndex = 0;
  private stepsSinceLastBattle = 0;
  private animFrame = 0;
  /** Jev応答待ちなど非同期処理の実行中フラグ（連打による多重実行・多重報酬を防ぐ） */
  private isResolvingTurn = false;

  private jevStatus = {
    isThinking: false,
    lastLatencyMs: 0,
    isSimulated: true,
  };

  constructor(
    private readonly canvasRenderer: CanvasRenderer,
    private readonly inputHandler: InputHandler,
    private readonly soundEngine: ISoundEngine,
    private readonly gameDirector: GameDirectorUseCase,
    private readonly battleUseCase: BattleUseCase,
    private readonly cardGenerator: CardGeneratorUseCase,
    private readonly i18n: I18nManager,
    private readonly callbacks: GameLoopCallbacks,
    private readonly audioSynthesizer?: AudioSynthesizer,
    private readonly bgmComposer?: BgmComposerUseCase
  ) {
    this.hero = this.createInitialHero();
    this.battleUseCase.setI18n(this.i18n);

    // 言語切り替え時に即座に再描画
    this.i18n.onLanguageChange(() => {
      this.battleUseCase.setI18n(this.i18n);
      if (this.currentFloor) {
        this.renderCurrentState();
      }
    });
  }

  private createInitialHero(): Hero {
    return {
      x: 2,
      y: 2,
      facing: "down",
      stats: {
        maxHp: 40,
        currentHp: 40,
        maxMp: 16,
        currentMp: 16,
        attack: 16,
        defense: 8,
        agility: 10,
        level: 1,
        exp: 0,
        nextLevelExp: 20,
        gold: 30,
      },
      weapon: {
        id: "w_copper",
        // 武器覚醒ログ等で表示されるため、ハードコードせず辞書から引く
        name: this.i18n.getEquipmentName("copper_sword"),
        prefix: "",
        element: "normal",
        attack: 10,
        level: 1,
      },
      shield: {
        id: "s_leather",
        name: this.i18n.getEquipmentName("leather_shield"),
        defense: 4,
      },
      inventory: {
        equipments: [...INITIAL_EQUIPMENT],
        equippedWeaponId: "w_copper",
        equippedShieldId: "s_leather",
        equippedArmorId: "a_tunic",
        equippedAccessoryId: "acc_ring",
      },
      spells: [
        {
          id: "fire",
          name: "ファイア",
          mpCost: 3,
          type: "attack",
          power: 16,
          description: "小さな火球を放ち敵単体にダメージ",
        },
        {
          id: "heal",
          name: "ヒール",
          mpCost: 4,
          type: "heal",
          power: 28,
          description: "傷を癒しHPを大きく回復",
        },
        {
          id: "thunder",
          name: "サンダー",
          mpCost: 5,
          type: "attack",
          power: 24,
          description: "閃光の雷撃波で敵に大ダメージ",
        },
      ],
      herbs: 3,
      stepsTaken: 0,
    };
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.callbacks.onLogMessage(this.i18n.t("log_dungeon_start"), "jev");

    window.addEventListener("keydown", async (e) => {
      if (e.code === "KeyE") {
        if (this.mode === "dungeon") {
          this.mode = "equip_menu";
          this.inventoryCursorIndex = 0;
          this.soundEngine.playSelect();
        } else if (this.mode === "equip_menu") {
          this.mode = "dungeon";
          this.soundEngine.playCancel();
        }
      } else if (e.code === "KeyH") {
        // フィールド上で道具（やくそう）使用
        if (this.mode === "dungeon") {
          this.useHerbInDungeon();
        }
      } else if (e.code === "KeyB") {
        // 即時エンカウント（体験・テスト用）
        if (this.mode === "dungeon" && !this.jevStatus.isThinking) {
          await this.triggerForceBattle();
        }
      }
    });

    await this.generateFloor();
    requestAnimationFrame(this.loop.bind(this));
  }

  pause(paused: boolean): void {
    this.mode = paused ? "paused" : this.battleState ? "battle" : "dungeon";
  }

  private loop(): void {
    if (!this.isRunning) return;

    this.animFrame++;

    // 1フレーム内で例外が出てもrequestAnimationFrameの連鎖を切らない
    // （切れるとゲーム画面が固まったまま操作不能になる）
    try {
      if (this.mode === "dungeon") {
        this.updateDungeon();
      } else if (this.mode === "battle" && this.battleState) {
        void this.updateBattle();
      } else if (this.mode === "equip_menu") {
        this.updateEquipMenu();
      } else if (this.mode === "paused") {
        // カードモーダル表示中の入力は溜めずに捨てる（閉じた直後の暴発防止）
        this.inputHandler.flush();
      }

      // update内でモード・状態が切り替わるため、描画は必ず「更新後の状態」で分岐する
      this.renderCurrentState();
    } catch (err) {
      console.error("Game loop frame failed", err);
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  private updateEquipMenu(): void {
    const bInput = this.inputHandler.getBattleInput();
    const totalItems = 1 /* やくそう */ + this.hero.inventory.equipments.length;

    if (bInput.cursorDelta !== 0) {
      this.soundEngine.playCursor();
      this.inventoryCursorIndex =
        (this.inventoryCursorIndex + bInput.cursorDelta + totalItems) % totalItems;
    }

    if (bInput.confirmPressed) {
      if (this.inventoryCursorIndex === 0) {
        // やくそう使用
        this.useHerbInDungeon();
      } else {
        // 装備品装着
        const eq = this.hero.inventory.equipments[this.inventoryCursorIndex - 1];
        if (eq) {
          this.equipItem(eq);
        }
      }
    }

    if (bInput.cancelPressed) {
      this.mode = "dungeon";
      this.soundEngine.playCancel();
    }
  }

  private equipItem(eq: BaseEquipment): void {
    this.soundEngine.playSelect();
    const eqDisp = this.i18n.getEquipmentName(eq.nameKey) || eq.nameKey;

    if (eq.slot === "weapon") {
      this.hero.inventory.equippedWeaponId = eq.id;
      this.hero.weapon = {
        name: eqDisp,
        attack: eq.attackBonus,
        id: eq.id,
        prefix: "",
        element: eq.element,
        level: 1,
      };
    } else if (eq.slot === "shield") {
      this.hero.inventory.equippedShieldId = eq.id;
      this.hero.shield = {
        name: eqDisp,
        defense: eq.defenseBonus,
        id: eq.id,
      };
    } else if (eq.slot === "armor") {
      this.hero.inventory.equippedArmorId = eq.id;
    } else if (eq.slot === "accessory") {
      this.hero.inventory.equippedAccessoryId = eq.id;
    }

    this.callbacks.onLogMessage(this.i18n.t("log_equipped", { name: eqDisp }), "evolution");
  }

  private useHerbInDungeon(): void {
    if (this.hero.herbs <= 0) {
      this.soundEngine.playCancel();
      this.callbacks.onLogMessage(this.i18n.t("no_herbs"), "info");
      return;
    }
    if (this.hero.stats.currentHp >= this.hero.stats.maxHp) {
      this.soundEngine.playCancel();
      this.callbacks.onLogMessage(this.i18n.t("log_hp_full"), "info");
      return;
    }

    this.hero.herbs--;
    const healAmount = Math.min(HERB_HEAL_AMOUNT, this.hero.stats.maxHp - this.hero.stats.currentHp);
    this.hero.stats.currentHp += healAmount;
    this.soundEngine.playSpell();
    this.callbacks.onLogMessage(this.i18n.t("herb_used", { amount: healAmount }), "evolution");
  }

  private renderCurrentState(): void {
    if (this.mode === "dungeon" && this.currentFloor) {
      this.canvasRenderer.renderDungeon(this.hero, this.currentFloor, this.jevStatus);
    } else if (this.mode === "battle" && this.battleState) {
      this.canvasRenderer.renderBattle(this.hero, this.battleState, this.jevStatus, this.animFrame);
    } else if (this.mode === "equip_menu") {
      this.canvasRenderer.renderEquipmentMenu(this.hero, this.inventoryCursorIndex);
    }
  }

  private updateDungeon(): void {
    const input = this.inputHandler.getDungeonInput();

    if (input.moveDir) {
      this.hero.facing = input.moveDir;
      let nx = this.hero.x;
      let ny = this.hero.y;

      if (input.moveDir === "up") ny--;
      else if (input.moveDir === "down") ny++;
      else if (input.moveDir === "left") nx--;
      else if (input.moveDir === "right") nx++;

      if (this.isWalkable(nx, ny)) {
        this.hero.x = nx;
        this.hero.y = ny;
        this.hero.stepsTaken++;
        this.stepsSinceLastBattle++;
        this.checkTileEvents();
      }
    }

    if (input.actionPressed) {
      this.interactCurrentTile();
    }
  }

  private isWalkable(x: number, y: number): boolean {
    if (x < 0 || x >= this.currentFloor.width || y < 0 || y >= this.currentFloor.height) {
      return false;
    }
    const tile = this.currentFloor.tiles[y][x];
    return tile !== "wall";
  }

  private async checkTileEvents(): Promise<void> {
    const tile = this.currentFloor.tiles[this.hero.y][this.hero.x];

    if (tile === "stairs_down") {
      this.soundEngine.playStairs();
      this.floorNumber++;
      this.callbacks.onLogMessage(this.i18n.t("stairs_down"), "info");
      await this.generateFloor();
      return;
    }

    // 3歩以上で判定開始、6歩以上で高確率、8歩で確定エンカウント（天井）
    if (!this.jevStatus.isThinking && this.stepsSinceLastBattle >= 3) {
      this.jevStatus.isThinking = true;
      try {
        if (this.stepsSinceLastBattle >= 7) {
          // 7歩以上は確定エンカウント（天井）
          const monster = await this.gameDirector.forceEncounter(this.hero, this.currentFloor);
          this.stepsSinceLastBattle = 0;
          this.startBattle(monster);
        } else {
          const { shouldEncounter, monster, latencyMs, isSimulated } =
            await this.gameDirector.checkEncounter(
              this.hero,
              this.currentFloor,
              this.stepsSinceLastBattle
            );

          this.jevStatus.lastLatencyMs = latencyMs;
          this.jevStatus.isSimulated = isSimulated;

          // Jev判定または歩数に応じた確率（5歩以上なら50%以上）
          const stepChance = (this.stepsSinceLastBattle - 2) * 0.2;
          if ((shouldEncounter || Math.random() < stepChance) && monster) {
            this.stepsSinceLastBattle = 0;
            this.startBattle(monster);
          }
        }
      } catch (err) {
        console.error("Encounter check failed", err);
      } finally {
        this.jevStatus.isThinking = false;
      }
    }
  }

  private async triggerForceBattle(): Promise<void> {
    this.jevStatus.isThinking = true;
    try {
      const monster = await this.gameDirector.forceEncounter(this.hero, this.currentFloor);
      this.startBattle(monster);
    } catch (err) {
      console.error("Force battle failed", err);
    } finally {
      this.jevStatus.isThinking = false;
    }
  }

  private async interactCurrentTile(): Promise<void> {
    const tile = this.currentFloor.tiles[this.hero.y][this.hero.x];
    if (tile === "chest") {
      this.soundEngine.playChest();
      this.currentFloor.tiles[this.hero.y][this.hero.x] = "chest_opened";

      // 50%でJevによる装備品ドロップ
      if (Math.random() < 0.5) {
        this.jevStatus.isThinking = true;
        try {
          const equip = await this.gameDirector.directChestEquipment(this.floorNumber);
          if (equip) {
            this.hero.inventory.equipments.push(equip);
            const eqDisp = this.i18n.getEquipmentName(equip.nameKey) || equip.nameKey;
            this.callbacks.onLogMessage(
              `${this.i18n.t("chest_found")} 【${eqDisp}】 (${equip.rarity}) ${this.i18n.t("got_item")} [E]`,
              "evolution"
            );
            return;
          }
        } finally {
          this.jevStatus.isThinking = false;
        }
      }

      // 通常アイテム / ゴールド
      if (Math.random() < 0.5) {
        this.hero.herbs++;
        this.callbacks.onLogMessage(`${this.i18n.t("chest_opened")} ${this.i18n.t("got_item")}`, "info");
      } else {
        const goldGain = Math.round(15 + Math.random() * 20);
        this.hero.stats.gold += goldGain;
        this.callbacks.onLogMessage(
          `${this.i18n.t("chest_opened")} ${goldGain} ${this.i18n.t("gold")} ${this.i18n.t("got_item")}`,
          "info"
        );
      }
    }
  }

  private startBattle(monster: Monster): void {
    this.soundEngine.playSelect();
    this.mode = "battle";
    this.stepsSinceLastBattle = 0;
    this.battleState = this.battleUseCase.initBattle(monster);
    this.callbacks.onLogMessage(
      `#${monster.dna.dnaHash} ${this.i18n.t("appeared")} [${monster.rarity}]`,
      "combat"
    );
  }

  private async updateBattle(): Promise<void> {
    if (!this.battleState) return;

    const bInput = this.inputHandler.getBattleInput();

    // Jev応答待ちの間の入力は読み捨てる（連打で同じターンが二重に走るのを防ぐ）
    if (this.isResolvingTurn) return;

    if (this.battleState.phase === "command_select") {
      if (bInput.cursorDelta !== 0) {
        this.soundEngine.playCursor();
        const maxCmd = 4;
        this.battleState.cursorIndex = (this.battleState.cursorIndex + bInput.cursorDelta + maxCmd) % maxCmd;
      }

      if (bInput.confirmPressed) {
        this.soundEngine.playSelect();
        const cmdIndex = this.battleState.cursorIndex;

        if (cmdIndex === 0) {
          this.soundEngine.playHit();
          const res = this.battleUseCase.executeHeroAttack(this.hero, this.battleState);
          this.hero = res.hero;
          this.battleState = res.state;
        } else if (cmdIndex === 1) {
          this.battleState.phase = "spell_select";
          this.battleState.selectedSpellIndex = 0;
        } else if (cmdIndex === 2) {
          if (this.hero.herbs > 0) {
            this.soundEngine.playSpell();
            const res = this.battleUseCase.executeUseHerb(this.hero, this.battleState);
            this.hero = res.hero;
            this.battleState = res.state;
          } else {
            this.soundEngine.playCancel();
            this.battleState.turnMessages = [this.i18n.t("no_herbs")];
            this.battleState.phase = "message_wait";
            this.battleState.currentMessageIndex = 0;
          }
        } else if (cmdIndex === 3) {
          this.battleState = this.battleUseCase.executeHeroRun(this.battleState);
        }
      }
    } else if (this.battleState.phase === "spell_select") {
      if (bInput.cursorDelta !== 0) {
        this.soundEngine.playCursor();
        const numSpells = this.hero.spells.length;
        this.battleState.selectedSpellIndex =
          (this.battleState.selectedSpellIndex + bInput.cursorDelta + numSpells) % numSpells;
      }

      if (bInput.cancelPressed) {
        this.soundEngine.playCancel();
        this.battleState.phase = "command_select";
      } else if (bInput.confirmPressed) {
        const spell = this.hero.spells[this.battleState.selectedSpellIndex];
        this.soundEngine.playSpell();
        const res = this.battleUseCase.executeHeroSpell(this.hero, spell, this.battleState);
        this.hero = res.hero;
        this.battleState = res.state;
      }
    } else if (this.battleState.phase === "message_wait") {
      if (bInput.confirmPressed) {
        this.soundEngine.playCursor();
        this.battleState.currentMessageIndex++;

        if (this.battleState.currentMessageIndex >= this.battleState.turnMessages.length) {
          if (this.battleState.pendingActor === "monster") {
            // 勇者の行動が終わった → モンスターの反撃へ
            this.isResolvingTurn = true;
            try {
              await this.triggerMonsterTurn();
            } finally {
              this.isResolvingTurn = false;
            }
          } else if (this.battleState) {
            // モンスターの行動が終わった / 行動不成立 → コマンド選択に戻す
            this.battleState.phase = "command_select";
            this.battleState.currentMessageIndex = Math.max(0, this.battleState.turnMessages.length - 1);
          }
        }
      }
    } else if (this.battleState.phase === "victory") {
      if (bInput.confirmPressed) {
        this.soundEngine.playVictory();
        this.isResolvingTurn = true;
        try {
          await this.handleVictory(this.battleState.monster);
        } finally {
          this.isResolvingTurn = false;
        }
      }
    } else if (this.battleState.phase === "defeat") {
      if (bInput.confirmPressed) {
        this.soundEngine.playDefeat();
        this.isResolvingTurn = true;
        try {
          alert(`${this.i18n.t("defeat")} (B${this.floorNumber}F)`);
          this.hero = this.createInitialHero();
          this.floorNumber = 1;
          this.mode = "dungeon";
          this.battleState = null;
          await this.generateFloor();
        } finally {
          this.isResolvingTurn = false;
        }
      }
    } else if (this.battleState.phase === "escaped") {
      if (bInput.confirmPressed) {
        this.mode = "dungeon";
        this.battleState = null;
      }
    }
  }

  private async triggerMonsterTurn(): Promise<void> {
    if (!this.battleState) return;

    this.jevStatus.isThinking = true;
    try {
      const { action, spellName, latencyMs, isSimulated } =
        await this.gameDirector.directMonsterAction(this.battleState.monster, this.hero);

      this.jevStatus.lastLatencyMs = latencyMs;
      this.jevStatus.isSimulated = isSimulated;

      if (action === "critical") this.soundEngine.playCritical();
      else if (action === "spell") this.soundEngine.playSpell();
      else this.soundEngine.playHit();

      const res = this.battleUseCase.executeMonsterTurn(
        this.hero,
        this.battleState,
        action,
        spellName
      );
      this.hero = res.hero;
      this.battleState = res.state;
    } catch (err) {
      console.error("Monster turn failed", err);
    } finally {
      this.jevStatus.isThinking = false;
    }
  }

  private async handleVictory(monster: Monster): Promise<void> {
    const exp = monster.expReward;
    const gold = monster.goldReward;
    this.hero.stats.exp += exp;
    this.hero.stats.gold += gold;

    this.callbacks.onLogMessage(`${exp} ${this.i18n.t("exp")} & ${gold} ${this.i18n.t("gold")} ${this.i18n.t("got_item")}`, "info");

    if (this.hero.stats.exp >= this.hero.stats.nextLevelExp) {
      this.soundEngine.playLevelUp();
      this.hero.stats.level++;
      this.hero.stats.maxHp += 8;
      this.hero.stats.currentHp = this.hero.stats.maxHp;
      this.hero.stats.maxMp += 4;
      this.hero.stats.currentMp = this.hero.stats.maxMp;
      this.hero.stats.attack += 3;
      this.hero.stats.defense += 2;
      this.hero.stats.nextLevelExp = Math.round(this.hero.stats.nextLevelExp * 1.7);
      this.callbacks.onLogMessage(`${this.i18n.t("level_up")} (LV ${this.hero.stats.level})`, "info");
    }

    if (monster.isBoss || monster.rarity !== "Common") {
      this.jevStatus.isThinking = true;
      try {
        const { weapon, awakeningText } = await this.gameDirector.directWeaponAwakening(this.hero, this.floorNumber);
        this.hero.weapon = weapon;
        this.callbacks.onLogMessage(awakeningText || this.i18n.t("weapon_awakened"), "evolution");
      } catch (err) {
        console.error("Awakening failed", err);
      } finally {
        this.jevStatus.isThinking = false;
      }
    }

    // 討伐モンスターのカード生成＆ポップアップ
    this.jevStatus.isThinking = true;
    try {
      const { card, latencyMs, isSimulated } = await this.cardGenerator.generateMonsterCard(
        monster,
        this.hero,
        this.floorNumber
      );
      this.jevStatus.lastLatencyMs = latencyMs;
      this.jevStatus.isSimulated = isSimulated;

      const cardCanvas = CardRenderer.renderCardToCanvas(card, undefined, this.i18n);
      this.callbacks.onCardGenerated(card, cardCanvas);
      this.callbacks.onLogMessage(`${this.i18n.t("card_get")} (${card.title}) [DNA: ${card.dna.dnaHash}]`, "jev");
    } catch (err) {
      console.error("Card generation failed", err);
    } finally {
      this.jevStatus.isThinking = false;
    }

    this.battleState = null;
    // onCardGenerated がカードモーダルを開いて pause(true) 済みの場合があるため、
    // ここで無条件に "dungeon" へ戻すとモーダルの裏でダンジョンが動いてしまう
    if (this.mode !== "paused") {
      this.mode = "dungeon";
    }
  }

  private async generateFloor(): Promise<void> {
    this.jevStatus.isThinking = true;
    try {
      const { floor, latencyMs, isSimulated } = await this.gameDirector.directDungeonFloor(
        this.hero,
        this.floorNumber
      );
      this.currentFloor = floor;
      this.jevStatus.lastLatencyMs = latencyMs;
      this.jevStatus.isSimulated = isSimulated;

      // 階段を降りたら左上の安全な床（x: 2, y: 2）から必ずスタート
      this.hero.x = 2;
      this.hero.y = 2;
      this.hero.facing = "down";
      this.currentFloor.tiles[2][2] = "floor";
      this.stepsSinceLastBattle = 0;

      // JevによるフロアBGMのリアルタイム動的作曲
      if (this.bgmComposer && this.audioSynthesizer) {
        try {
          const track = await this.bgmComposer.composeFloorBgm(
            this.floorNumber,
            this.currentFloor.ambientElement
          );
          this.audioSynthesizer.setTrack(track);
        } catch (bgmErr) {
          console.warn("BGM composition warning", bgmErr);
        }
      }

      this.callbacks.onLogMessage(
        this.i18n.t("log_floor_reached", { floor: floor.floorNumber, danger: floor.dangerScore.toFixed(1) }),
        "jev"
      );
    } catch (err) {
      console.error("Floor generation failed", err);
    } finally {
      this.jevStatus.isThinking = false;
    }
  }
}
