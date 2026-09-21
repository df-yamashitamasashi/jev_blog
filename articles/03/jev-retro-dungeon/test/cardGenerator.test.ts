import { describe, it, expect } from "vitest";
import { CardGeneratorUseCase } from "../src/usecases/cardGeneratorUseCase";
import { JevClient } from "../src/adapters/jevClient";
import { Monster, Hero } from "../src/domain/models";
import { INITIAL_EQUIPMENT } from "../src/domain/equipmentModels";

describe("CardGeneratorUseCase (Retro RPG Style)", () => {
  const client = new JevClient();
  const cardGenerator = new CardGeneratorUseCase(client);

  const mockMonster: Monster = {
    id: "m_boss",
    name: "紅蓮のりゅうおう",
    type: "dragon_lord",
    element: "crimson",
    maxHp: 160,
    currentHp: 0,
    attack: 42,
    defense: 25,
    agility: 16,
    expReward: 300,
    goldReward: 250,
    isBoss: true,
    rarity: "Legendary",
    dna: {
      dnaHash: "0xABCDEF12345678",
      bodyGene: "b_dragon",
      eyesGene: "e_fiery",
      mouthGene: "m_fangs",
      hornsGene: "h_demon",
      wingsGene: "w_dragon",
      tailGene: "t_dragon",
      auraGene: "a_divine",
      paletteGene: "p_crimson",
    },
  };

  const mockHero: Hero = {
    x: 2,
    y: 2,
    facing: "down",
    stats: {
      maxHp: 50,
      currentHp: 8, // 瀕死の激闘
      maxMp: 20,
      currentMp: 2,
      attack: 28,
      defense: 16,
      agility: 12,
      level: 5,
      exp: 480,
      nextLevelExp: 600,
      gold: 320,
    },
    weapon: {
      id: "w2",
      name: "伝説の聖剣",
      prefix: "聖なる",
      element: "golden",
      attack: 30,
      level: 3,
    },
    shield: {
      id: "s2",
      name: "鉄の盾",
      defense: 10,
    },
    inventory: {
      equipments: INITIAL_EQUIPMENT,
      equippedWeaponId: "w_copper",
      equippedShieldId: "s_leather",
      equippedArmorId: "a_tunic",
      equippedAccessoryId: "acc_ring",
    },
    spells: [],
    herbs: 0,
    stepsTaken: 40,
  };

  it("should generate a rich retro TCG card data from battle", async () => {
    const { card, latencyMs } = await cardGenerator.generateMonsterCard(mockMonster, mockHero, 3);

    // カードタイトルはフレーバー名ではなくDNAハッシュ由来のIDを表示する
    expect(card.title).toBe(`#${mockMonster.dna!.dnaHash}`);
    expect(card.subtitle).toBeDefined();
    expect(card.monsterType).toBe("dragon_lord");
    expect(card.element).toBe("crimson");
    expect(card.rarity).toBe("Legendary");
    expect(card.stats.attack).toBe(mockMonster.attack);
    expect(card.stats.dangerScore).toBeGreaterThan(0);
    expect(card.flavorText).toBeDefined();
    // slayerNameは現在のUI言語（デフォルトja）に応じてi18nの"hero"キーから決まる
    expect(card.slayerName).toBe("ゆうしゃ");
    expect(latencyMs).toBeGreaterThan(0);
  });
});
