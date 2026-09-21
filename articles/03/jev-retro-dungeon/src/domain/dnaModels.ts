/**
 * Generative Monster DNA Models (CryptoKitties / CryptoPunks Style)
 * Clean Architecture - Domain Layer
 * 
 * 8 Gene Slots:
 * Body (12) * Eyes (12) * Mouth (10) * Horns (12) * Wings (10) * Tail (10) * Aura (8) * Palette (16)
 * Total Combinations = 221,184,000 (221 Million Variations)
 * ※ 実測値。totalGeneCombinations() と test/dnaIdentity.test.ts で検証している。
 */

export interface GenePart {
  readonly id: string;
  readonly nameKey: string;
  readonly drawType: number; // レンダラーでの描画バリエーションインデックス
  readonly statModifiers: {
    hp: number;
    atk: number;
    def: number;
    agi: number;
  };
}

export interface MonsterDNA {
  readonly bodyGene: string;     // 12 types
  readonly eyesGene: string;     // 12 types
  readonly mouthGene: string;    // 10 types
  readonly hornsGene: string;    // 12 types
  readonly wingsGene: string;    // 10 types
  readonly tailGene: string;     // 10 types
  readonly auraGene: string;     // 8 types
  readonly paletteGene: string;  // 16 color schemes
  readonly dnaHash: string;      // 16進数ユニークDNAハッシュ (例: "0x7F4A8C...")
}

export const DNA_CATALOG = {
  bodies: [
    { id: "b_slime", nameKey: "slime", drawType: 0, statModifiers: { hp: 10, atk: 2, def: 2, agi: 4 } },
    { id: "b_beast", nameKey: "beast", drawType: 1, statModifiers: { hp: 20, atk: 6, def: 4, agi: 6 } },
    { id: "b_reptile", nameKey: "reptile", drawType: 2, statModifiers: { hp: 25, atk: 5, def: 8, agi: 3 } },
    { id: "b_avian", nameKey: "avian", drawType: 3, statModifiers: { hp: 15, atk: 4, def: 3, agi: 10 } },
    { id: "b_undead", nameKey: "undead", drawType: 4, statModifiers: { hp: 18, atk: 7, def: 3, agi: 4 } },
    { id: "b_insect", nameKey: "insect", drawType: 5, statModifiers: { hp: 14, atk: 5, def: 6, agi: 8 } },
    { id: "b_golem", nameKey: "golem", drawType: 6, statModifiers: { hp: 40, atk: 10, def: 14, agi: 1 } },
    { id: "b_demon", nameKey: "demon", drawType: 7, statModifiers: { hp: 30, atk: 9, def: 7, agi: 7 } },
    { id: "b_aquatic", nameKey: "aquatic", drawType: 8, statModifiers: { hp: 22, atk: 5, def: 5, agi: 6 } },
    { id: "b_plant", nameKey: "plant", drawType: 9, statModifiers: { hp: 24, atk: 4, def: 8, agi: 2 } },
    { id: "b_specter", nameKey: "specter", drawType: 10, statModifiers: { hp: 16, atk: 8, def: 2, agi: 9 } },
    { id: "b_dragon", nameKey: "dragon", drawType: 11, statModifiers: { hp: 50, atk: 14, def: 12, agi: 8 } },
  ],
  eyes: [
    { id: "e_normal", nameKey: "round_eyes", drawType: 0, statModifiers: { hp: 0, atk: 0, def: 0, agi: 1 } },
    { id: "e_glare", nameKey: "glaring_eyes", drawType: 1, statModifiers: { hp: 0, atk: 2, def: 0, agi: 0 } },
    { id: "e_cyclops", nameKey: "cyclops_eye", drawType: 2, statModifiers: { hp: 2, atk: 1, def: 1, agi: -1 } },
    { id: "e_blind", nameKey: "blindfold", drawType: 3, statModifiers: { hp: 0, atk: 3, def: 0, agi: 2 } },
    { id: "e_laser", nameKey: "glowing_ruby", drawType: 4, statModifiers: { hp: 0, atk: 4, def: 0, agi: 0 } },
    { id: "e_void", nameKey: "empty_sockets", drawType: 5, statModifiers: { hp: 0, atk: 1, def: 1, agi: 1 } },
    { id: "e_multi", nameKey: "spider_eyes", drawType: 6, statModifiers: { hp: 0, atk: 1, def: 0, agi: 3 } },
    { id: "e_cat", nameKey: "cat_slits", drawType: 7, statModifiers: { hp: 0, atk: 0, def: 0, agi: 2 } },
    { id: "e_fiery", nameKey: "blazing_eyes", drawType: 8, statModifiers: { hp: 0, atk: 3, def: 0, agi: 0 } },
    { id: "e_frost", nameKey: "ice_crystals", drawType: 9, statModifiers: { hp: 1, atk: 0, def: 2, agi: 0 } },
    { id: "e_divine", nameKey: "golden_gaze", drawType: 10, statModifiers: { hp: 2, atk: 2, def: 2, agi: 2 } },
    { id: "e_shadow", nameKey: "abyss_spark", drawType: 11, statModifiers: { hp: 0, atk: 2, def: 1, agi: 2 } },
  ],
  mouths: [
    { id: "m_smile", nameKey: "sharp_smile", drawType: 0, statModifiers: { hp: 0, atk: 1, def: 0, agi: 0 } },
    { id: "m_fangs", nameKey: "vampiric_fangs", drawType: 1, statModifiers: { hp: 0, atk: 3, def: 0, agi: 0 } },
    { id: "m_mandible", nameKey: "chitin_mandibles", drawType: 2, statModifiers: { hp: 0, atk: 2, def: 1, agi: 0 } },
    { id: "m_beak", nameKey: "predator_beak", drawType: 3, statModifiers: { hp: 0, atk: 2, def: 0, agi: 1 } },
    { id: "m_maw", nameKey: "abyssal_maw", drawType: 4, statModifiers: { hp: 3, atk: 4, def: 0, agi: -1 } },
    { id: "m_tongue", nameKey: "poison_tongue", drawType: 5, statModifiers: { hp: 0, atk: 2, def: 0, agi: 1 } },
    { id: "m_iron", nameKey: "iron_grill", drawType: 6, statModifiers: { hp: 0, atk: 0, def: 3, agi: 0 } },
    { id: "m_tentacle", nameKey: "mouth_tentacles", drawType: 7, statModifiers: { hp: 2, atk: 1, def: 0, agi: 1 } },
    { id: "m_flame", nameKey: "ember_breath", drawType: 8, statModifiers: { hp: 0, atk: 3, def: 0, agi: 0 } },
    { id: "m_tusk", nameKey: "mammoth_tusks", drawType: 9, statModifiers: { hp: 2, atk: 3, def: 1, agi: -1 } },
  ],
  horns: [
    { id: "h_none", nameKey: "no_horns", drawType: 0, statModifiers: { hp: 0, atk: 0, def: 0, agi: 1 } },
    { id: "h_demon", nameKey: "curved_horns", drawType: 1, statModifiers: { hp: 0, atk: 3, def: 1, agi: 0 } },
    { id: "h_unicorn", nameKey: "spiral_horn", drawType: 2, statModifiers: { hp: 0, atk: 4, def: 0, agi: 1 } },
    { id: "h_antler", nameKey: "stag_antlers", drawType: 3, statModifiers: { hp: 2, atk: 1, def: 2, agi: 0 } },
    { id: "h_crown", nameKey: "bone_crown", drawType: 4, statModifiers: { hp: 1, atk: 2, def: 2, agi: 0 } },
    { id: "h_ears_cat", nameKey: "pointed_ears", drawType: 5, statModifiers: { hp: 0, atk: 0, def: 0, agi: 3 } },
    { id: "h_ears_bat", nameKey: "radar_ears", drawType: 6, statModifiers: { hp: 0, atk: 0, def: 1, agi: 2 } },
    { id: "h_spikes", nameKey: "skull_spikes", drawType: 7, statModifiers: { hp: 0, atk: 2, def: 2, agi: 0 } },
    { id: "h_feathers", nameKey: "feather_crest", drawType: 8, statModifiers: { hp: 0, atk: 1, def: 0, agi: 2 } },
    { id: "h_helmet", nameKey: "viking_helm", drawType: 9, statModifiers: { hp: 0, atk: 1, def: 4, agi: -1 } },
    { id: "h_halo", nameKey: "blessed_halo", drawType: 10, statModifiers: { hp: 4, atk: 1, def: 1, agi: 1 } },
    { id: "h_ram", nameKey: "battering_ram", drawType: 11, statModifiers: { hp: 0, atk: 4, def: 3, agi: -1 } },
  ],
  wings: [
    { id: "w_none", nameKey: "no_wings", drawType: 0, statModifiers: { hp: 0, atk: 0, def: 0, agi: 0 } },
    { id: "w_bat", nameKey: "leathery_wings", drawType: 1, statModifiers: { hp: 0, atk: 1, def: 0, agi: 3 } },
    { id: "w_feather", nameKey: "angel_wings", drawType: 2, statModifiers: { hp: 2, atk: 0, def: 1, agi: 3 } },
    { id: "w_dragon", nameKey: "wyvern_wings", drawType: 3, statModifiers: { hp: 0, atk: 3, def: 1, agi: 2 } },
    { id: "w_insect", nameKey: "wasp_wings", drawType: 4, statModifiers: { hp: 0, atk: 1, def: 0, agi: 5 } },
    { id: "w_shell", nameKey: "carapace_shield", drawType: 5, statModifiers: { hp: 4, atk: 0, def: 5, agi: -2 } },
    { id: "w_spines", nameKey: "back_spines", drawType: 6, statModifiers: { hp: 0, atk: 2, def: 2, agi: 0 } },
    { id: "w_flame", nameKey: "fire_wings", drawType: 7, statModifiers: { hp: 0, atk: 4, def: 0, agi: 2 } },
    { id: "w_tentacles", nameKey: "back_tentacles", drawType: 8, statModifiers: { hp: 2, atk: 2, def: 1, agi: 0 } },
    { id: "w_cape", nameKey: "shadow_cloak", drawType: 9, statModifiers: { hp: 0, atk: 1, def: 2, agi: 2 } },
  ],
  tails: [
    { id: "t_none", nameKey: "no_tail", drawType: 0, statModifiers: { hp: 0, atk: 0, def: 0, agi: 0 } },
    { id: "t_demon", nameKey: "spade_tail", drawType: 1, statModifiers: { hp: 0, atk: 2, def: 0, agi: 1 } },
    { id: "t_reptile", nameKey: "whip_tail", drawType: 2, statModifiers: { hp: 0, atk: 2, def: 1, agi: 0 } },
    { id: "t_scorp", nameKey: "poison_stinger", drawType: 3, statModifiers: { hp: 0, atk: 4, def: 0, agi: 0 } },
    { id: "t_feather", nameKey: "plumage_tail", drawType: 4, statModifiers: { hp: 0, atk: 0, def: 0, agi: 2 } },
    { id: "t_club", nameKey: "ankylosaur_club", drawType: 5, statModifiers: { hp: 0, atk: 3, def: 2, agi: -1 } },
    { id: "t_fish", nameKey: "serpent_fin", drawType: 6, statModifiers: { hp: 1, atk: 0, def: 0, agi: 2 } },
    { id: "t_fluffy", nameKey: "fox_nine_tail", drawType: 7, statModifiers: { hp: 2, atk: 1, def: 0, agi: 1 } },
    { id: "t_twin", nameKey: "twin_tentacles", drawType: 8, statModifiers: { hp: 1, atk: 1, def: 1, agi: 1 } },
    { id: "t_flame", nameKey: "blaze_tail", drawType: 9, statModifiers: { hp: 0, atk: 3, def: 0, agi: 1 } },
  ],
  auras: [
    { id: "a_none", nameKey: "calm_air", drawType: 0, statModifiers: { hp: 0, atk: 0, def: 0, agi: 0 } },
    { id: "a_flame", nameKey: "crimson_blaze", drawType: 1, statModifiers: { hp: 0, atk: 5, def: 0, agi: 0 } },
    { id: "a_frost", nameKey: "glacial_mist", drawType: 2, statModifiers: { hp: 0, atk: 0, def: 4, agi: 0 } },
    { id: "a_thunder", nameKey: "sparking_plasma", drawType: 3, statModifiers: { hp: 0, atk: 3, def: 0, agi: 3 } },
    { id: "a_shadow", nameKey: "void_vortex", drawType: 4, statModifiers: { hp: 0, atk: 2, def: 2, agi: 2 } },
    { id: "a_holy", nameKey: "sacred_radiance", drawType: 5, statModifiers: { hp: 5, atk: 2, def: 2, agi: 0 } },
    { id: "a_poison", nameKey: "miasma_cloud", drawType: 6, statModifiers: { hp: 0, atk: 3, def: 1, agi: 1 } },
    { id: "a_cosmic", nameKey: "nebula_burst", drawType: 7, statModifiers: { hp: 4, atk: 4, def: 4, agi: 4 } },
  ],
  palettes: [
    { id: "p_blue", nameKey: "ocean_blue", primary: "#0078f8", secondary: "#38b8f8", glow: "rgba(0, 120, 248, 0.4)" },
    { id: "p_crimson", nameKey: "hell_crimson", primary: "#f83800", secondary: "#f87858", glow: "rgba(248, 56, 0, 0.5)" },
    { id: "p_emerald", nameKey: "forest_emerald", primary: "#00a800", secondary: "#58d858", glow: "rgba(0, 168, 0, 0.4)" },
    { id: "p_gold", nameKey: "king_gold", primary: "#fcd800", secondary: "#f8f878", glow: "rgba(252, 216, 0, 0.6)" },
    { id: "p_purple", nameKey: "abyss_purple", primary: "#940088", secondary: "#d800cc", glow: "rgba(148, 0, 136, 0.5)" },
    { id: "p_cyan", nameKey: "frost_cyan", primary: "#00e8d8", secondary: "#b8f8f8", glow: "rgba(0, 232, 216, 0.5)" },
    { id: "p_obsidian", nameKey: "dark_obsidian", primary: "#202028", secondary: "#505060", glow: "rgba(32, 32, 40, 0.6)" },
    { id: "p_bone", nameKey: "ancient_bone", primary: "#e0d8b8", secondary: "#f8f0d8", glow: "rgba(224, 216, 184, 0.4)" },
    { id: "p_toxic", nameKey: "toxic_lime", primary: "#88d800", secondary: "#b8f858", glow: "rgba(136, 216, 0, 0.5)" },
    { id: "p_copper", nameKey: "rust_copper", primary: "#b85818", secondary: "#d88838", glow: "rgba(184, 88, 24, 0.4)" },
    { id: "p_silver", nameKey: "mithril_silver", primary: "#a8b8c8", secondary: "#d8e8f8", glow: "rgba(168, 184, 200, 0.5)" },
    { id: "p_ruby", nameKey: "blood_ruby", primary: "#d80038", secondary: "#f85878", glow: "rgba(216, 0, 56, 0.5)" },
    { id: "p_plasma", nameKey: "neon_plasma", primary: "#f80088", secondary: "#00f8d8", glow: "rgba(248, 0, 136, 0.6)" },
    { id: "p_spectral", nameKey: "ghost_spectral", primary: "#7898a8", secondary: "#c8d8e8", glow: "rgba(120, 152, 168, 0.5)" },
    { id: "p_sunburst", nameKey: "solar_flare", primary: "#f87800", secondary: "#f8b800", glow: "rgba(248, 120, 0, 0.6)" },
    { id: "p_void", nameKey: "deep_void", primary: "#100820", secondary: "#381858", glow: "rgba(56, 24, 88, 0.7)" },
  ],
};

/** 遺伝子スロットの並び順（カード表示・DNAハッシュ生成で共有） */
export const GENE_SLOTS = [
  "body",
  "eyes",
  "mouth",
  "horns",
  "wings",
  "tail",
  "aura",
  "palette",
] as const;

export type GeneSlot = (typeof GENE_SLOTS)[number];

const SLOT_TO_CATALOG: Record<GeneSlot, keyof typeof DNA_CATALOG> = {
  body: "bodies",
  eyes: "eyes",
  mouth: "mouths",
  horns: "horns",
  wings: "wings",
  tail: "tails",
  aura: "auras",
  palette: "palettes",
};

export interface GeneReadout {
  readonly slot: GeneSlot;
  readonly id: string;
  /** "b_dragon" → "dragon" のようにスロット接頭辞を落とした表示用コード */
  readonly code: string;
  readonly statModifiers: { hp: number; atk: number; def: number; agi: number } | null;
}

const NO_MODIFIERS = { hp: 0, atk: 0, def: 0, agi: 0 };

/**
 * MonsterDNAを8スロットの読み出し行に変換する（カードの遺伝子情報欄で使用）。
 *
 * カタログに無いIDが来ても表示は壊さず、コードだけを出して補正はnullにする。
 * paletteは配色のみのスロットでステータス補正を持たないため常にnullになる。
 */
export function readGenome(dna: MonsterDNA): GeneReadout[] {
  const ids: Record<GeneSlot, string> = {
    body: dna.bodyGene,
    eyes: dna.eyesGene,
    mouth: dna.mouthGene,
    horns: dna.hornsGene,
    wings: dna.wingsGene,
    tail: dna.tailGene,
    aura: dna.auraGene,
    palette: dna.paletteGene,
  };

  return GENE_SLOTS.map((slot) => {
    const id = ids[slot] || "-";
    const entry = (DNA_CATALOG[SLOT_TO_CATALOG[slot]] as ReadonlyArray<{ id: string }>).find(
      (e) => e.id === id
    ) as { statModifiers?: typeof NO_MODIFIERS } | undefined;

    return {
      slot,
      id,
      code: id.replace(/^[a-z]+_/, ""),
      statModifiers: entry?.statModifiers ?? null,
    };
  });
}

/** 遺伝子由来のステータス補正の合計 */
export function sumGenomeModifiers(dna: MonsterDNA): { hp: number; atk: number; def: number; agi: number } {
  return readGenome(dna).reduce(
    (acc, g) => {
      const m = g.statModifiers ?? NO_MODIFIERS;
      return { hp: acc.hp + m.hp, atk: acc.atk + m.atk, def: acc.def + m.def, agi: acc.agi + m.agi };
    },
    { ...NO_MODIFIERS }
  );
}

/** DNAカタログ上で表現しうるモンスターの総組み合わせ数 */
export function totalGeneCombinations(): number {
  return (
    DNA_CATALOG.bodies.length *
    DNA_CATALOG.eyes.length *
    DNA_CATALOG.mouths.length *
    DNA_CATALOG.horns.length *
    DNA_CATALOG.wings.length *
    DNA_CATALOG.tails.length *
    DNA_CATALOG.auras.length *
    DNA_CATALOG.palettes.length
  );
}
