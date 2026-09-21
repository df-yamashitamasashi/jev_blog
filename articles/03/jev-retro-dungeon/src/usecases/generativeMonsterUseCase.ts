/**
 * Generative Monster Generator Use Case (CryptoKitties / CryptoPunks Architecture)
 * Clean Architecture - Use Case Layer
 * 
 * Jev (System One) decides the 8 gene slots out of 2.2+ Billion Combinations!
 */

import { IJevClient } from "../adapters/jevClient";
import { Monster, DungeonFloor, ElementType, MonsterType } from "../domain/models";
import { DNA_CATALOG, MonsterDNA } from "../domain/dnaModels";

export class GenerativeMonsterUseCase {
  constructor(private readonly jevClient: IJevClient) {}

  /**
   * Jevがダンジョンフロアと戦況から8スロットの遺伝子を判断し、ジェネラティブモンスターを生成
   */
  async generateMonster(
    floor: DungeonFloor,
    heroLevel: number,
    heroHpRatio: number
  ): Promise<{
    monster: Monster;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const state = {
      floorNumber: floor.floorNumber,
      ambientElement: floor.ambientElement,
      dangerScore: floor.dangerScore,
      heroLevel,
      heroHpRatio,
      timestamp: Date.now(),
    };

    // Jevに8スロットの遺伝子選定を問い合わせ
    const { response, latencyMs, isSimulated } = await this.jevClient.systemOne({
      state,
      questions: {
        bodyGene: {
          type: "choice",
          instructions: "フロア環境と危険度に応じた魔物の基本骨格・種族（Body）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.bodies.map((b) => [b.id, b.nameKey])),
        },
        eyesGene: {
          type: "choice",
          instructions: "魔物の視線・眼光（Eyes）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.eyes.map((e) => [e.id, e.nameKey])),
        },
        mouthGene: {
          type: "choice",
          instructions: "魔物の顎・牙・口部（Mouth）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.mouths.map((m) => [m.id, m.nameKey])),
        },
        hornsGene: {
          type: "choice",
          instructions: "魔物の角・耳・兜（Horns/Head）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.horns.map((h) => [h.id, h.nameKey])),
        },
        wingsGene: {
          type: "choice",
          instructions: "魔物の翼・甲羅・背部突起（Wings/Back）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.wings.map((w) => [w.id, w.nameKey])),
        },
        tailGene: {
          type: "choice",
          instructions: "魔物の尻尾・下肢（Tail/Legs）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.tails.map((t) => [t.id, t.nameKey])),
        },
        auraGene: {
          type: "choice",
          instructions: "魔物が放つ魔力オーラ・気配（Aura）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.auras.map((a) => [a.id, a.nameKey])),
        },
        paletteGene: {
          type: "choice",
          instructions: "魔物の色彩・外皮テクスチャ（Palette）を選定してください",
          criteria: Object.fromEntries(DNA_CATALOG.palettes.map((p) => [p.id, p.nameKey])),
        },
      },
    });

    const getAns = (key: string, fallback: string) => {
      const ans = response.answers[key];
      return ans?.type === "choice" ? ans.choice : fallback;
    };

    const bodyId = getAns("bodyGene", DNA_CATALOG.bodies[0].id);
    const eyesId = getAns("eyesGene", DNA_CATALOG.eyes[0].id);
    const mouthId = getAns("mouthGene", DNA_CATALOG.mouths[0].id);
    const hornsId = getAns("hornsGene", DNA_CATALOG.horns[0].id);
    const wingsId = getAns("wingsGene", DNA_CATALOG.wings[0].id);
    const tailId = getAns("tailGene", DNA_CATALOG.tails[0].id);
    const auraId = getAns("auraGene", DNA_CATALOG.auras[0].id);
    const paletteId = getAns("paletteGene", DNA_CATALOG.palettes[0].id);

    // ユニークなDNAハッシュの生成（CryptoPunksのtokenIdライク）
    const dnaHash = `0x${[bodyId, eyesId, mouthId, hornsId, wingsId, tailId, auraId, paletteId]
      .map((id) => id.split("_")[1].substring(0, 2).toUpperCase())
      .join("")}`;

    const dna: MonsterDNA = {
      bodyGene: bodyId,
      eyesGene: eyesId,
      mouthGene: mouthId,
      hornsGene: hornsId,
      wingsGene: wingsId,
      tailGene: tailId,
      auraGene: auraId,
      paletteGene: paletteId,
      dnaHash,
    };

    // ステータスと名前の合成計算
    const bodyPart = DNA_CATALOG.bodies.find((b) => b.id === bodyId) || DNA_CATALOG.bodies[0];
    const eyesPart = DNA_CATALOG.eyes.find((e) => e.id === eyesId) || DNA_CATALOG.eyes[0];
    const mouthPart = DNA_CATALOG.mouths.find((m) => m.id === mouthId) || DNA_CATALOG.mouths[0];
    const hornsPart = DNA_CATALOG.horns.find((h) => h.id === hornsId) || DNA_CATALOG.horns[0];
    const wingsPart = DNA_CATALOG.wings.find((w) => w.id === wingsId) || DNA_CATALOG.wings[0];
    const tailPart = DNA_CATALOG.tails.find((t) => t.id === tailId) || DNA_CATALOG.tails[0];
    const auraPart = DNA_CATALOG.auras.find((a) => a.id === auraId) || DNA_CATALOG.auras[0];

    const parts = [bodyPart, eyesPart, mouthPart, hornsPart, wingsPart, tailPart, auraPart];

    const totalMod = parts.reduce(
      (acc, p) => ({
        hp: acc.hp + p.statModifiers.hp,
        atk: acc.atk + p.statModifiers.atk,
        def: acc.def + p.statModifiers.def,
        agi: acc.agi + p.statModifiers.agi,
      }),
      { hp: 0, atk: 0, def: 0, agi: 0 }
    );

    const floorMult = 1.0 + (floor.floorNumber - 1) * 0.25;

    // パレットからエレメントを推定
    let element: ElementType = "normal";
    if (paletteId.includes("crimson") || paletteId.includes("ruby") || paletteId.includes("sunburst")) {
      element = "crimson";
    } else if (paletteId.includes("cyan") || paletteId.includes("spectral") || paletteId.includes("silver")) {
      element = "frost";
    } else if (paletteId.includes("purple") || paletteId.includes("obsidian") || paletteId.includes("void")) {
      element = "shadow";
    } else if (paletteId.includes("gold") || paletteId.includes("emerald")) {
      element = "golden";
    }

    const maxHp = Math.max(15, Math.round(totalMod.hp * floorMult));
    const attack = Math.max(6, Math.round(totalMod.atk * floorMult));
    const defense = Math.max(3, Math.round(totalMod.def * floorMult));
    const agility = Math.max(4, Math.round(totalMod.agi * floorMult));

    // レトロRPG風の名前の命名
    const prefixes: Record<string, string> = {
      p_blue: "蒼天の",
      p_crimson: "紅蓮の",
      p_emerald: "深緑の",
      p_gold: "黄金の",
      p_purple: "魔界の",
      p_cyan: "氷結の",
      p_obsidian: "黒曜の",
      p_bone: "骸骨の",
      p_toxic: "猛毒の",
      p_copper: "古銅の",
      p_silver: "白銀の",
      p_ruby: "血華の",
      p_plasma: "閃光の",
      p_spectral: "幻影の",
      p_sunburst: "烈日の",
      p_void: "虚無の",
    };

    const bodyNames: Record<string, string> = {
      b_slime: "スライム",
      b_beast: "魔獣",
      b_reptile: "トカゲ戦士",
      b_avian: "怪鳥",
      b_undead: "スケルトン",
      b_insect: "甲虫兵",
      b_golem: "ゴーレム",
      b_demon: "悪魔",
      b_aquatic: "水竜",
      b_plant: "人喰い樹",
      b_specter: "亡霊まどうし",
      b_dragon: "ドラゴンロード",
    };

    const prefix = prefixes[paletteId] || "";
    const baseName = bodyNames[bodyId] || "魔物";
    const monsterName = `${prefix}${baseName}`;

    // レアリティ判定
    const isBoss = bodyId === "b_dragon" || floor.floorNumber % 5 === 0;
    const rarity = isBoss
      ? "Legendary"
      : totalMod.atk + totalMod.def >= 28
      ? "Epic"
      : totalMod.atk + totalMod.def >= 18
      ? "Rare"
      : "Common";

    let monsterType: MonsterType = "slime";
    if (bodyId === "b_dragon") monsterType = "dragon_lord";
    else if (bodyId === "b_golem") monsterType = "golem";
    else if (bodyId === "b_undead") monsterType = "skeleton";
    else if (bodyId === "b_specter") monsterType = "mage";
    else if (bodyId === "b_avian") monsterType = "drakky";

    const monster: Monster = {
      id: `gen_mon_${Date.now()}_${dnaHash}`,
      name: monsterName,
      type: monsterType,
      element,
      dna,
      maxHp,
      currentHp: maxHp,
      attack,
      defense,
      agility,
      expReward: Math.round((maxHp + attack * 2) * (element === "golden" ? 2.5 : 1.0)),
      goldReward: Math.round((defense * 2 + agility) * (element === "golden" ? 3.0 : 1.0)),
      isBoss,
      rarity,
    };

    return { monster, latencyMs, isSimulated };
  }
}
