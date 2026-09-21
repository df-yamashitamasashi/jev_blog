/**
 * Classic Retro RPG Turn/ATB Command Battle Use Case with Complete i18n
 * Clean Architecture - Use Case Layer
 */

import { Hero, Monster, BattleState, Spell } from "../domain/models";
import { I18nManager } from "../presentation/i18nManager";

export class BattleUseCase {
  constructor(private i18n?: I18nManager) {}

  public setI18n(i18n: I18nManager): void {
    this.i18n = i18n;
  }

  private t(key: Parameters<I18nManager["t"]>[0], params?: Record<string, string | number>): string {
    if (this.i18n) {
      return this.i18n.t(key, params);
    }
    // デフォルトフォールバック
    return String(key);
  }

  private getMonsterDisplayName(monster: Monster): string {
    if (this.i18n) {
      return this.i18n.getMonsterName(monster.dna, monster.rarity);
    }
    return monster.name;
  }

  initBattle(monster: Monster): BattleState {
    const name = this.getMonsterDisplayName(monster);
    const msg = this.i18n
      ? `${name} ${this.t("appeared")}`
      : `${monster.name} が あらわれた！`;

    return {
      monster,
      phase: "command_select",
      cursorIndex: 0,
      selectedSpellIndex: 0,
      turnMessages: [msg],
      currentMessageIndex: 0,
      isHeroDefending: false,
      canEscape: !monster.isBoss,
      atbHero: 1.0,
      atbMonster: 0.2,
    };
  }

  /**
   * プレイヤーが「たたかう」を選択した際の計算
   */
  executeHeroAttack(hero: Hero, state: BattleState): { hero: Hero; state: BattleState } {
    const isCrit = Math.random() < 0.18; // かいしんのいちげき
    const totalAtk = hero.stats.attack + hero.weapon.attack;
    const baseDmg = Math.max(1, totalAtk - Math.floor(state.monster.defense / 2));

    let actualDmg = isCrit ? Math.round(totalAtk * 1.5) : Math.round(baseDmg * (0.9 + Math.random() * 0.2));
    actualDmg = Math.max(1, actualDmg);

    const nextMonster = { ...state.monster, currentHp: Math.max(0, state.monster.currentHp - actualDmg) };
    const mName = this.getMonsterDisplayName(state.monster);

    const messages: string[] = [];
    if (isCrit) {
      messages.push(this.t("critical_hit"));
      messages.push(`${mName} ${actualDmg} ${this.t("damage_dealt")}`);
    } else {
      messages.push(`${this.t("hero")} ${this.t("attacked")}`);
      messages.push(`${mName} ${actualDmg} ${this.t("damage_dealt")}`);
    }

    const isDefeated = nextMonster.currentHp <= 0;
    if (isDefeated) {
      messages.push(`${mName} ${this.t("defeated_monster")}`);
    }

    return {
      hero: { ...hero },
      state: {
        ...state,
        monster: nextMonster,
        phase: isDefeated ? "victory" : "message_wait",
        turnMessages: messages,
        currentMessageIndex: 0,
        isHeroDefending: false,
        atbHero: 0.0,
      },
    };
  }

  /**
   * プレイヤーが「じゅもん」を選択した際の計算
   */
  executeHeroSpell(hero: Hero, spell: Spell, state: BattleState): { hero: Hero; state: BattleState } {
    if (hero.stats.currentMp < spell.mpCost) {
      return {
        hero,
        state: {
          ...state,
          phase: "command_select",
          turnMessages: [this.t("mp_lacking")],
          currentMessageIndex: 0,
        },
      };
    }

    const nextHero = {
      ...hero,
      stats: {
        ...hero.stats,
        currentMp: hero.stats.currentMp - spell.mpCost,
      },
    };

    const spellKey = `spell_${spell.id}` as Parameters<I18nManager["t"]>[0];
    const spellName = this.i18n ? this.i18n.t(spellKey) : spell.name;
    const mName = this.getMonsterDisplayName(state.monster);

    if (spell.type === "heal") {
      const healAmount = Math.min(nextHero.stats.maxHp - nextHero.stats.currentHp, spell.power);
      nextHero.stats.currentHp += healAmount;

      return {
        hero: nextHero,
        state: {
          ...state,
          phase: "message_wait",
          turnMessages: [
            `${this.t("hero")} ${this.t("spell_cast")} ${spellName}!`,
            `HP +${healAmount} ${this.t("heal_done")}`,
          ],
          currentMessageIndex: 0,
          atbHero: 0.0,
        },
      };
    } else {
      // 攻撃呪文（ファイア / サンダー）
      const spellDmg = Math.round(spell.power * (0.9 + Math.random() * 0.2));
      const nextMonster = { ...state.monster, currentHp: Math.max(0, state.monster.currentHp - spellDmg) };
      const isDefeated = nextMonster.currentHp <= 0;

      const messages = [
        `${this.t("hero")} ${this.t("spell_cast")} ${spellName}!`,
        `${mName} ${spellDmg} ${this.t("damage_dealt")}`,
      ];
      if (isDefeated) {
        messages.push(`${mName} ${this.t("defeated_monster")}`);
      }

      return {
        hero: nextHero,
        state: {
          ...state,
          monster: nextMonster,
          phase: isDefeated ? "victory" : "message_wait",
          turnMessages: messages,
          currentMessageIndex: 0,
          atbHero: 0.0,
        },
      };
    }
  }

  /**
   * プレイヤーが「どうぐ（やくそう）」を使用
   */
  executeUseHerb(hero: Hero, state: BattleState): { hero: Hero; state: BattleState } {
    if (hero.herbs <= 0) {
      return {
        hero,
        state: {
          ...state,
          phase: "command_select",
          turnMessages: [this.t("no_herbs")],
          currentMessageIndex: 0,
        },
      };
    }

    const healAmount = Math.min(35, hero.stats.maxHp - hero.stats.currentHp);
    const nextHero = {
      ...hero,
      herbs: hero.herbs - 1,
      stats: {
        ...hero.stats,
        currentHp: hero.stats.currentHp + healAmount,
      },
    };

    return {
      hero: nextHero,
      state: {
        ...state,
        phase: "message_wait",
        turnMessages: [
          `${this.t("hero")}: ${this.t("herb_used")}`,
          `HP +${healAmount} ${this.t("heal_done")}`,
        ],
        currentMessageIndex: 0,
        atbHero: 0.0,
      },
    };
  }

  /**
   * プレイヤーが「ぼうぎょ」を選択
   */
  executeHeroDefend(state: BattleState): BattleState {
    return {
      ...state,
      phase: "message_wait",
      turnMessages: [this.t("defending")],
      currentMessageIndex: 0,
      isHeroDefending: true,
      atbHero: 0.0,
    };
  }

  /**
   * プレイヤーが「にげる」を選択
   */
  executeHeroRun(state: BattleState): BattleState {
    if (!state.canEscape) {
      return {
        ...state,
        phase: "message_wait",
        turnMessages: [this.t("cannot_escape")],
        currentMessageIndex: 0,
      };
    }

    const success = Math.random() < 0.65;
    if (success) {
      return {
        ...state,
        phase: "escaped",
        turnMessages: [this.t("escape_success")],
        currentMessageIndex: 0,
      };
    } else {
      return {
        ...state,
        phase: "message_wait",
        turnMessages: [this.t("escape_fail")],
        currentMessageIndex: 0,
        atbHero: 0.0,
      };
    }
  }

  /**
   * Jevが決定したモンスターの行動を実行
   */
  executeMonsterTurn(
    hero: Hero,
    state: BattleState,
    action: "attack" | "spell" | "defend" | "critical",
    spellName?: string
  ): { hero: Hero; state: BattleState } {
    let dmg = 0;
    const messages: string[] = [];
    const mName = this.getMonsterDisplayName(state.monster);

    const totalDef = hero.stats.defense + hero.shield.defense;
    const defMultiplier = state.isHeroDefending ? 0.5 : 1.0;

    if (action === "critical") {
      messages.push(this.t("monster_critical"));
      dmg = Math.round(state.monster.attack * 1.4);
    } else if (action === "spell") {
      messages.push(`${mName} ${this.t("spell_cast")} ${spellName || "Frizz"}!`);
      dmg = Math.round(14 * (0.8 + Math.random() * 0.4));
    } else if (action === "defend") {
      messages.push(`${mName} ${this.t("monster_defending")}`);
      dmg = 0;
    } else {
      messages.push(`${mName} ${this.t("attacked")}`);
      dmg = Math.max(1, Math.round((state.monster.attack - Math.floor(totalDef / 2)) * defMultiplier));
    }

    if (dmg > 0) {
      messages.push(`${this.t("hero")} ${dmg} ${this.t("damage_taken")}`);
    }

    const nextHero = {
      ...hero,
      stats: {
        ...hero.stats,
        currentHp: Math.max(0, hero.stats.currentHp - dmg),
      },
    };

    const isDefeat = nextHero.stats.currentHp <= 0;
    if (isDefeat) {
      messages.push(this.t("hero_fell"));
    }

    return {
      hero: nextHero,
      state: {
        ...state,
        phase: isDefeat ? "defeat" : "message_wait",
        turnMessages: messages,
        currentMessageIndex: 0,
        atbMonster: 0.0,
      },
    };
  }
}
