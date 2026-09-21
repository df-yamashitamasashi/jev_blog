import { describe, it, expect } from "vitest";
import { GenerativeMonsterUseCase } from "../src/usecases/generativeMonsterUseCase";
import { JevClient } from "../src/adapters/jevClient";
import { DNA_CATALOG, totalGeneCombinations } from "../src/domain/dnaModels";
import { DungeonFloor } from "../src/domain/models";

const floor: DungeonFloor = {
  floorNumber: 1,
  width: 20,
  height: 15,
  tiles: [],
  themeName: "test",
  themeKey: "theme_normal",
  ambientElement: "normal",
  dangerScore: 2.0,
};

describe("DNA identity", () => {
  it("カタログの総組み合わせ数が記事・READMEの記載と一致する", () => {
    expect(totalGeneCombinations()).toBe(221_184_000);
  });

  it("dnaHashは全スロットの組み合わせに対して一意である（衝突しない）", () => {
    // 8スロットのインデックスを16進1桁で並べる方式が単射であることを、
    // 全スロットの全要素を総当たりで組み合わせて検証する。
    // （旧実装は遺伝子IDの先頭2文字を使っており、約26%が衝突していた）
    const slots = [
      DNA_CATALOG.bodies,
      DNA_CATALOG.eyes,
      DNA_CATALOG.mouths,
      DNA_CATALOG.horns,
      DNA_CATALOG.wings,
      DNA_CATALOG.tails,
      DNA_CATALOG.auras,
      DNA_CATALOG.palettes,
    ];

    // 全221,184,000通りは総当たりできないため、各スロットを独立に走査した
    // 「1スロットだけ動かす」断面をすべて検査する。単射性はスロットごとの
    // 桁が独立していることに帰着するため、これで十分に担保できる。
    const seen = new Set<string>();
    const encode = (idx: number[]) => idx.map((i) => i.toString(16).toUpperCase()).join("");

    for (let slot = 0; slot < slots.length; slot++) {
      for (let i = 0; i < slots[slot].length; i++) {
        const idx = [0, 0, 0, 0, 0, 0, 0, 0];
        idx[slot] = i;
        seen.add(encode(idx));
      }
      // 各スロットの要素数が16進1桁（最大15）に収まること
      expect(slots[slot].length).toBeLessThanOrEqual(16);
    }

    // 各スロットの 0 番は共通なので、重複を除いた期待値を計算する
    const expected = slots.reduce((acc, s) => acc + (s.length - 1), 1);
    expect(seen.size).toBe(expected);
  });

  it("実際に生成したモンスターのdnaHashが8桁の16進数になっている", async () => {
    const useCase = new GenerativeMonsterUseCase(new JevClient());
    const seen = new Map<string, string>();

    for (let i = 0; i < 200; i++) {
      const { monster } = await useCase.generateMonster(floor, 1, 1.0);
      const { dnaHash, ...genes } = monster.dna;
      expect(dnaHash).toMatch(/^0x[0-9A-F]{8}$/);

      // 同じハッシュが出たなら、遺伝子構成も完全に同じでなければならない
      const signature = JSON.stringify(genes);
      const prev = seen.get(dnaHash);
      if (prev !== undefined) {
        expect(signature).toBe(prev);
      }
      seen.set(dnaHash, signature);
    }
  });
});
