import { describe, it, expect } from "vitest";
import { BattleUseCase } from "../src/usecases/battleUseCase";
import { Hero, Monster } from "../src/domain/models";
import { INITIAL_EQUIPMENT } from "../src/domain/equipmentModels";

describe("BattleUseCase (Retro RPG Style Command Battle)", () => {
  const battleUseCase = new BattleUseCase();

  const createHero = (): Hero => ({
    x: 2,
    y: 2,
    facing: "down",
    stats: {
      maxHp: 32,
      currentHp: 20,
      maxMp: 10,
      currentMp: 6,
      attack: 15,
      defense: 8,
      agility: 8,
      level: 1,
      exp: 0,
      nextLevelExp: 20,
      gold: 10,
    },
    weapon: { id: "w1", name: "銅の剣", prefix: "", attack: 10, element: "normal", level: 1 },
    shield: { id: "s1", name: "革の盾", defense: 4 },
    inventory: {
      equipments: [...INITIAL_EQUIPMENT],
      equippedWeaponId: "w1",
      equippedShieldId: "s1",
      equippedArmorId: "a_tunic",
      equippedAccessoryId: "acc_ring",
    },
    spells: [
      { id: "sp_heal", name: "ヒール", mpCost: 3, type: "heal", power: 25, description: "HP回復" },
      { id: "sp_fire", name: "ファイア", mpCost: 4, type: "attack", power: 16, description: "火炎魔法" },
    ],
    herbs: 1,
    stepsTaken: 5,
  });

  const createMonster = (): Monster => ({
    id: "m1",
    name: "フォレストブロブ",
    type: "slime",
    element: "normal",
    dna: {
      bodyGene: "b_slime",
      eyesGene: "e_normal",
      mouthGene: "m_smile",
      hornsGene: "h_none",
      wingsGene: "w_none",
      tailGene: "t_none",
      auraGene: "a_none",
      paletteGene: "p_blue",
      dnaHash: "0xSLNODI",
    },
    maxHp: 15,
    currentHp: 15,
    attack: 8,
    defense: 4,
    agility: 5,
    expReward: 8,
    goldReward: 6,
    isBoss: false,
    rarity: "Common",
  });

  it("should initialize battle properly", () => {
    const monster = createMonster();
    const state = battleUseCase.initBattle(monster);

    expect(state.phase).toBe("command_select");
    expect(state.monster.name).toBe("フォレストブロブ");
    expect(state.turnMessages[0]).toContain("あらわれた！");
  });

  it("should execute hero attack and damage monster", () => {
    const hero = createHero();
    const monster = createMonster();
    const state = battleUseCase.initBattle(monster);

    const { state: nextState } = battleUseCase.executeHeroAttack(hero, state);

    expect(nextState.monster.currentHp).toBeLessThan(15);
  });

  it("should execute hero spell heal properly", () => {
    const hero = createHero();
    const monster = createMonster();
    const state = battleUseCase.initBattle(monster);
    const healSpell = hero.spells[0];

    const { hero: nextHero } = battleUseCase.executeHeroSpell(hero, healSpell, state);

    expect(nextHero.stats.currentHp).toBeGreaterThan(20);
    expect(nextHero.stats.currentMp).toBe(hero.stats.currentMp - healSpell.mpCost);
  });
});
