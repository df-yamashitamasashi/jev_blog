/**
 * Dev-only visual gallery for the generative monster renderer.
 * Not part of the game build — used only to eyeball DNA coverage while iterating.
 */
import { DNA_CATALOG, MonsterDNA } from "./src/domain/dnaModels";
import { GenerativeMonsterRenderer } from "./src/presentation/generativeRenderer";

const root = document.getElementById("root")!;
const inspector = document.getElementById("inspector")!;

interface Cell {
  dna: MonsterDNA;
  label: string;
  ctx: CanvasRenderingContext2D;
}

const cells: Cell[] = [];

function baseDna(): MonsterDNA {
  return {
    bodyGene: DNA_CATALOG.bodies[1].id,
    eyesGene: DNA_CATALOG.eyes[0].id,
    mouthGene: DNA_CATALOG.mouths[0].id,
    hornsGene: DNA_CATALOG.horns[0].id,
    wingsGene: DNA_CATALOG.wings[0].id,
    tailGene: DNA_CATALOG.tails[0].id,
    auraGene: DNA_CATALOG.auras[0].id,
    paletteGene: DNA_CATALOG.palettes[0].id,
    dnaHash: "0xBASE",
  };
}

// --- Inspector: 拡大表示で細部を確認する ---
const inspectorTargets: { dna: MonsterDNA; label: string }[] = [
  { dna: { ...baseDna(), bodyGene: "b_dragon", eyesGene: "e_fiery", mouthGene: "m_fangs", hornsGene: "h_demon", wingsGene: "w_dragon", tailGene: "t_demon", auraGene: "a_flame", paletteGene: "p_crimson", dnaHash: "0xHELL" }, label: "dragon / crimson / flame" },
  { dna: { ...baseDna(), bodyGene: "b_golem", eyesGene: "e_divine", mouthGene: "m_iron", hornsGene: "h_helmet", wingsGene: "w_shell", tailGene: "t_none", auraGene: "a_holy", paletteGene: "p_gold", dnaHash: "0xGOLEM" }, label: "golem / gold / holy" },
  { dna: { ...baseDna(), bodyGene: "b_specter", eyesGene: "e_shadow", mouthGene: "m_tentacle", hornsGene: "h_none", wingsGene: "w_cape", tailGene: "t_twin", auraGene: "a_shadow", paletteGene: "p_void", dnaHash: "0xSPEC" }, label: "specter / void / shadow" },
];
inspectorTargets.forEach((t) => {
  const wrap = document.createElement("div");
  wrap.style.textAlign = "center";
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  canvas.style.imageRendering = "pixelated";
  canvas.style.background = "#000";
  canvas.style.border = "2px solid #555";
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  wrap.appendChild(canvas);
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = t.label;
  wrap.appendChild(label);
  inspector.appendChild(wrap);
  cells.push({ dna: t.dna, label: t.label, ctx });
});

function section(title: string): HTMLDivElement {
  const h = document.createElement("h2");
  h.textContent = title;
  root.appendChild(h);
  const grid = document.createElement("div");
  grid.className = "grid";
  root.appendChild(grid);
  return grid;
}

function addCell(grid: HTMLDivElement, dna: MonsterDNA, label: string): void {
  const cell = document.createElement("div");
  cell.className = "cell";
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  cell.appendChild(canvas);
  const labelEl = document.createElement("div");
  labelEl.className = "label";
  labelEl.textContent = label;
  cell.appendChild(labelEl);
  grid.appendChild(cell);
  cells.push({ dna, label, ctx });
}

// --- Section A: 全12ボディタイプ（他遺伝子はindexに応じてばらけさせる） ---
const gridA = section("A. Bodies (12 types) — mixed other genes for variety");
DNA_CATALOG.bodies.forEach((body, i) => {
  const dna: MonsterDNA = {
    bodyGene: body.id,
    eyesGene: DNA_CATALOG.eyes[(i * 2) % DNA_CATALOG.eyes.length].id,
    mouthGene: DNA_CATALOG.mouths[(i * 3) % DNA_CATALOG.mouths.length].id,
    hornsGene: DNA_CATALOG.horns[(i * 5) % DNA_CATALOG.horns.length].id,
    wingsGene: DNA_CATALOG.wings[(i * 4) % DNA_CATALOG.wings.length].id,
    tailGene: DNA_CATALOG.tails[(i * 7) % DNA_CATALOG.tails.length].id,
    auraGene: DNA_CATALOG.auras[i % DNA_CATALOG.auras.length].id,
    paletteGene: DNA_CATALOG.palettes[(i * 3) % DNA_CATALOG.palettes.length].id,
    dnaHash: `0xBODY${i}`,
  };
  addCell(gridA, dna, body.nameKey);
});

// --- Section B: 全16パレット（固定ボディ=dragon） ---
const gridB = section("B. Palettes (16 types) — fixed dragon body");
DNA_CATALOG.palettes.forEach((palette, i) => {
  const dna: MonsterDNA = { ...baseDna(), bodyGene: "b_dragon", hornsGene: "h_demon", wingsGene: "w_dragon", tailGene: "t_demon", auraGene: "a_cosmic", paletteGene: palette.id, dnaHash: `0xPAL${i}` };
  addCell(gridB, dna, palette.nameKey);
});

// --- Section C: 全12目タイプ ---
const gridC = section("C. Eyes (12 types)");
DNA_CATALOG.eyes.forEach((eyes, i) => {
  const dna: MonsterDNA = { ...baseDna(), eyesGene: eyes.id, dnaHash: `0xEYE${i}` };
  addCell(gridC, dna, eyes.nameKey);
});

// --- Section D: 全10口タイプ ---
const gridD = section("D. Mouths (10 types)");
DNA_CATALOG.mouths.forEach((mouth, i) => {
  const dna: MonsterDNA = { ...baseDna(), mouthGene: mouth.id, dnaHash: `0xMOU${i}` };
  addCell(gridD, dna, mouth.nameKey);
});

// --- Section E: 全12角タイプ ---
const gridE = section("E. Horns (12 types)");
DNA_CATALOG.horns.forEach((horns, i) => {
  const dna: MonsterDNA = { ...baseDna(), hornsGene: horns.id, dnaHash: `0xHOR${i}` };
  addCell(gridE, dna, horns.nameKey);
});

// --- Section F: 全10翼タイプ ---
const gridF = section("F. Wings (10 types)");
DNA_CATALOG.wings.forEach((wings, i) => {
  const dna: MonsterDNA = { ...baseDna(), bodyGene: "b_demon", wingsGene: wings.id, dnaHash: `0xWIN${i}` };
  addCell(gridF, dna, wings.nameKey);
});

// --- Section G: 全10尾タイプ ---
const gridG = section("G. Tails (10 types)");
DNA_CATALOG.tails.forEach((tail, i) => {
  const dna: MonsterDNA = { ...baseDna(), bodyGene: "b_demon", tailGene: tail.id, dnaHash: `0xTAI${i}` };
  addCell(gridG, dna, tail.nameKey);
});

// --- Section H: 全8オーラタイプ ---
const gridH = section("H. Auras (8 types)");
DNA_CATALOG.auras.forEach((aura, i) => {
  const dna: MonsterDNA = { ...baseDna(), bodyGene: "b_demon", auraGene: aura.id, dnaHash: `0xAUR${i}` };
  addCell(gridH, dna, aura.nameKey);
});

// --- Section I: ランダムサンプル（全スロット同時にばらける現実的な個体差） ---
const gridI = section("I. Random full-DNA samples (24)");
function pick<T>(arr: readonly T[], seed: number): T {
  const idx = ((seed % arr.length) + arr.length) % arr.length;
  return arr[idx];
}
for (let i = 0; i < 24; i++) {
  const s = i * 40503; // 乗算ハッシュ（32bit範囲に収める）
  const dna: MonsterDNA = {
    bodyGene: pick(DNA_CATALOG.bodies, s).id,
    eyesGene: pick(DNA_CATALOG.eyes, s >> 1).id,
    mouthGene: pick(DNA_CATALOG.mouths, s >> 2).id,
    hornsGene: pick(DNA_CATALOG.horns, s >> 3).id,
    wingsGene: pick(DNA_CATALOG.wings, s >> 4).id,
    tailGene: pick(DNA_CATALOG.tails, s >> 5).id,
    auraGene: pick(DNA_CATALOG.auras, s >> 6).id,
    paletteGene: pick(DNA_CATALOG.palettes, s >> 7).id,
    dnaHash: `0xRND${i}`,
  };
  addCell(gridI, dna, `#${i}`);
}

let frame = 0;
function loop() {
  frame++;
  for (const cell of cells) {
    const { width, height } = cell.ctx.canvas;
    cell.ctx.clearRect(0, 0, width, height);
    GenerativeMonsterRenderer.renderMonster(cell.ctx, width / 2, height / 2 + 4, cell.dna, width / 32, frame);
  }
  requestAnimationFrame(loop);
}
loop();
