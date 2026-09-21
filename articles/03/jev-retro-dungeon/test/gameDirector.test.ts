import { describe, it, expect } from "vitest";
import { GameDirectorUseCase } from "../src/usecases/gameDirectorUseCase";
import { JevClient } from "../src/adapters/jevClient";
import { Hero } from "../src/domain/models";
import { INITIAL_EQUIPMENT } from "../src/domain/equipmentModels";

describe("GameDirectorUseCase (Retro RPG Style with Generative DNA & Equipment)", () => {
  const client = new JevClient();
  const director = new GameDirectorUseCase(client);

  const mockHero: Hero = {
    x: 2,
    y: 2,
    facing: "down",
    stats: {
      maxHp: 36,
      currentHp: 24,
      maxMp: 14,
      currentMp: 8,
      attack: 14,
      defense: 6,
      agility: 8,
      level: 1,
      exp: 0,
      nextLevelExp: 20,
      gold: 15,
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
    herbs: 2,
    stepsTaken: 8,
  };

  it("should generate floor with Jev decision", async () => {
    const { floor, latencyMs } = await director.directDungeonFloor(mockHero, 1);

    expect(floor.floorNumber).toBe(1);
    expect(floor.tiles.length).toBeGreaterThan(0);
    expect(latencyMs).toBeGreaterThan(0);
  });

  it("should generate a monster with DNA slots (CryptoKitties style)", async () => {
    const { floor } = await director.directDungeonFloor(mockHero, 1);
    const enc = await director.checkEncounter(mockHero, floor);

    if (enc.shouldEncounter && enc.monster) {
      expect(enc.monster.dna).toBeDefined();
      expect(enc.monster.dna.dnaHash).toMatch(/^0x[A-Z0-9]+$/);
      expect(enc.monster.dna.bodyGene).toBeDefined();
      expect(enc.monster.dna.eyesGene).toBeDefined();
    }
  });

  it("should direct chest equipment drop with Jev", async () => {
    const equip = await director.directChestEquipment(2);

    expect(equip).not.toBeNull();
    if (equip) {
      expect(["weapon", "shield", "armor", "accessory"]).toContain(equip.slot);
      expect(["Common", "Rare", "Epic", "Legendary"]).toContain(equip.rarity);
    }
  });
});
