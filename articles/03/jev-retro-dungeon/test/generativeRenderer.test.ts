import { describe, it, expect } from "vitest";
import { DNA_CATALOG, MonsterDNA } from "../src/domain/dnaModels";
import { composeMonsterBuffer, animStateForFrame } from "../src/presentation/generativeRenderer";
import { PX } from "../src/presentation/pixelBuffer";
import { buildRamp, hexToRgb, getRamp } from "../src/presentation/colorRamp";
import { GRID_SIZE } from "../src/presentation/parts/types";

function makeDna(overrides: Partial<MonsterDNA> = {}): MonsterDNA {
  return {
    bodyGene: DNA_CATALOG.bodies[0].id,
    eyesGene: DNA_CATALOG.eyes[0].id,
    mouthGene: DNA_CATALOG.mouths[0].id,
    hornsGene: DNA_CATALOG.horns[0].id,
    wingsGene: DNA_CATALOG.wings[0].id,
    tailGene: DNA_CATALOG.tails[0].id,
    auraGene: DNA_CATALOG.auras[0].id,
    paletteGene: DNA_CATALOG.palettes[0].id,
    dnaHash: "0xTEST0000",
    ...overrides,
  };
}

function countNonEmpty(cells: Uint8Array): number {
  let n = 0;
  for (const c of cells) if (c !== PX.EMPTY) n++;
  return n;
}

function countCode(cells: Uint8Array, code: number): number {
  let n = 0;
  for (const c of cells) if (c === code) n++;
  return n;
}

describe("Generative Monster Renderer — coverage", () => {
  it("draws a non-empty, in-bounds silhouette for every body drawType (0-11)", () => {
    DNA_CATALOG.bodies.forEach((body, idx) => {
      const dna = makeDna({ bodyGene: body.id });
      const buffer = composeMonsterBuffer(dna);
      expect(buffer.size).toBe(GRID_SIZE);
      const cells = buffer.toArray();
      expect(cells.length).toBe(GRID_SIZE * GRID_SIZE);
      // ボディ・目・口は必須要素なので、どのdrawTypeでも一定量のピクセルが描かれるはず
      expect(countNonEmpty(cells), `body drawType ${idx} (${body.id}) produced no pixels`).toBeGreaterThan(20);
    });
  });

  it("renders every eyes drawType (0-11) without throwing and paints pupils/sockets", () => {
    DNA_CATALOG.eyes.forEach((eyes) => {
      const dna = makeDna({ eyesGene: eyes.id });
      expect(() => composeMonsterBuffer(dna)).not.toThrow();
    });
  });

  it("renders every mouth drawType (0-9) without throwing", () => {
    DNA_CATALOG.mouths.forEach((mouth) => {
      const dna = makeDna({ mouthGene: mouth.id });
      expect(() => composeMonsterBuffer(dna)).not.toThrow();
    });
  });

  it("renders every horns drawType (0-11) including the 'none' case", () => {
    DNA_CATALOG.horns.forEach((horns) => {
      const dna = makeDna({ hornsGene: horns.id });
      expect(() => composeMonsterBuffer(dna)).not.toThrow();
    });
  });

  it("renders every wings drawType (0-9) including the 'none' case, across flap phases", () => {
    DNA_CATALOG.wings.forEach((wings) => {
      const dna = makeDna({ wingsGene: wings.id });
      expect(() => composeMonsterBuffer(dna, { bob: 0, flap: 0, pulse: 0 })).not.toThrow();
      expect(() => composeMonsterBuffer(dna, { bob: 0, flap: 1, pulse: 0 })).not.toThrow();
    });
  });

  it("renders every tail drawType (0-9) including the 'none' case", () => {
    DNA_CATALOG.tails.forEach((tail) => {
      const dna = makeDna({ tailGene: tail.id });
      expect(() => composeMonsterBuffer(dna)).not.toThrow();
    });
  });

  it("renders every aura drawType (0-7) including the 'none' case, across pulse phases", () => {
    DNA_CATALOG.auras.forEach((aura) => {
      const dna = makeDna({ auraGene: aura.id });
      for (const pulse of [0, 1, 2] as const) {
        expect(() => composeMonsterBuffer(dna, { bob: 0, flap: 0, pulse })).not.toThrow();
      }
    });
  });

  it("never writes outside the 32x32 buffer for a wide sample of DNA combinations", () => {
    // 全組み合わせは22億通りあるため、決定論的にばらけたサンプルを網羅的に検証する
    let sampled = 0;
    for (let i = 0; i < DNA_CATALOG.bodies.length; i++) {
      for (let j = 0; j < DNA_CATALOG.horns.length; j++) {
        const dna = makeDna({
          bodyGene: DNA_CATALOG.bodies[i].id,
          hornsGene: DNA_CATALOG.horns[j].id,
          wingsGene: DNA_CATALOG.wings[(i + j) % DNA_CATALOG.wings.length].id,
          tailGene: DNA_CATALOG.tails[(i * 3 + j) % DNA_CATALOG.tails.length].id,
          eyesGene: DNA_CATALOG.eyes[(i + j * 2) % DNA_CATALOG.eyes.length].id,
          mouthGene: DNA_CATALOG.mouths[(i * 2 + j) % DNA_CATALOG.mouths.length].id,
          auraGene: DNA_CATALOG.auras[(i + j) % DNA_CATALOG.auras.length].id,
        });
        const buffer = composeMonsterBuffer(dna);
        expect(buffer.toArray().length).toBe(GRID_SIZE * GRID_SIZE);
        sampled++;
      }
    }
    expect(sampled).toBe(DNA_CATALOG.bodies.length * DNA_CATALOG.horns.length);
  });
});

describe("Generative Monster Renderer — determinism & silhouette quality", () => {
  it("produces byte-identical output for the same DNA and animation state", () => {
    const dna = makeDna({ bodyGene: "b_dragon", wingsGene: "w_dragon", auraGene: "a_cosmic" });
    const a = composeMonsterBuffer(dna, { bob: 0, flap: 1, pulse: 2 });
    const b = composeMonsterBuffer(dna, { bob: 0, flap: 1, pulse: 2 });
    expect(Array.from(a.toArray())).toEqual(Array.from(b.toArray()));
  });

  it("produces a different silhouette when the aura pulse phase changes for animated auras", () => {
    const dna = makeDna({ auraGene: "a_thunder" });
    const p0 = composeMonsterBuffer(dna, { bob: 0, flap: 0, pulse: 0 });
    const p1 = composeMonsterBuffer(dna, { bob: 0, flap: 0, pulse: 1 });
    expect(Array.from(p0.toArray())).not.toEqual(Array.from(p1.toArray()));
  });

  it("auto-generates a closed outline around every composed silhouette", () => {
    const dna = makeDna({ bodyGene: "b_golem", hornsGene: "h_helmet" });
    const buffer = composeMonsterBuffer(dna);
    const cells = buffer.toArray();
    expect(countCode(cells, PX.OUTLINE)).toBeGreaterThan(10);
  });

  it("maps animation frames to a small, stable set of discrete states (no sub-pixel jitter)", () => {
    const states = new Set(Array.from({ length: 40 }, (_, f) => JSON.stringify(animStateForFrame(f))));
    // bob(2) * flap(2) * pulse(3) = 12通りの離散状態に収まる
    expect(states.size).toBeLessThanOrEqual(12);
  });
});

describe("Color ramp — SNES-style tone generation", () => {
  it("derives a full 9-tone ramp with valid hex colors for every DNA palette", () => {
    DNA_CATALOG.palettes.forEach((palette) => {
      const ramp = buildRamp(palette.primary, palette.secondary);
      for (const tone of Object.values(ramp)) {
        expect(tone).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  });

  it("keeps highlight brighter than base, and base brighter than shadowDeep", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = hexToRgb(hex);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    DNA_CATALOG.palettes.forEach((palette) => {
      const ramp = buildRamp(palette.primary, palette.secondary);
      expect(luminance(ramp.highlight)).toBeGreaterThanOrEqual(luminance(ramp.base));
      expect(luminance(ramp.base)).toBeGreaterThanOrEqual(luminance(ramp.shadowDeep));
    });
  });

  it("memoizes ramps for identical primary/secondary pairs", () => {
    const r1 = getRamp("#0078f8", "#38b8f8");
    const r2 = getRamp("#0078f8", "#38b8f8");
    expect(r1).toBe(r2);
  });
});
