/**
 * Application Entry Point (Classic Retro RPG Style + Generative DNA + 8 Languages)
 * Clean Architecture - Presentation Layer
 */

import { JevClient } from "./adapters/jevClient";
import { RetroSoundEngine } from "./adapters/soundEngine";
import { GameDirectorUseCase } from "./usecases/gameDirectorUseCase";
import { BattleUseCase } from "./usecases/battleUseCase";
import { CardGeneratorUseCase } from "./usecases/cardGeneratorUseCase";
import { BgmComposerUseCase } from "./usecases/bgmComposerUseCase";
import { CanvasRenderer } from "./presentation/canvasRenderer";
import { InputHandler } from "./presentation/inputHandler";
import { GameLoop } from "./presentation/gameLoop";
import { CardRenderer } from "./presentation/cardRenderer";
import { I18nManager } from "./presentation/i18nManager";
import { AudioSynthesizer } from "./presentation/audioSynthesizer";
import { CardData } from "./domain/models";
import { LanguageCode } from "./domain/i18nTypes";

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
  const logContainer = document.getElementById("logContainer") as HTMLDivElement;
  const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
  const saveKeyBtn = document.getElementById("saveKeyBtn") as HTMLButtonElement;
  const bgmToggleBtn = document.getElementById("bgmToggleBtn") as HTMLButtonElement;
  const langSelect = document.getElementById("langSelect") as HTMLSelectElement;

  // Card Modal elements
  const cardModal = document.getElementById("cardModal") as HTMLDivElement;
  const cardModalCanvas = document.getElementById("cardModalCanvas") as HTMLCanvasElement;
  const downloadCardBtn = document.getElementById("downloadCardBtn") as HTMLButtonElement;
  const shareCardBtn = document.getElementById("shareCardBtn") as HTMLButtonElement;
  const closeCardBtn = document.getElementById("closeCardBtn") as HTMLButtonElement;

  // 1. 言語マネージャー初期化 & 初回DOM翻訳
  const i18n = new I18nManager();
  langSelect.value = i18n.language;
  i18n.updateDom();

  // 2. Chiptune オーディオシンセサイザー初期化
  const audioSynthesizer = new AudioSynthesizer();
  let isBgmOn = false;

  const updateBgmButton = () => {
    bgmToggleBtn.textContent = isBgmOn ? i18n.t("ui_bgm_on") : i18n.t("ui_bgm_off");
    bgmToggleBtn.style.color = isBgmOn ? "#00ff88" : "#fcd800";
  };
  updateBgmButton();

  // 言語切り替えイベント
  langSelect.addEventListener("change", () => {
    i18n.setLanguage(langSelect.value as LanguageCode);
    updateBgmButton();
  });

  // 保存済みAPIキーの読み込み
  const savedKey = localStorage.getItem("jev_api_key") || "";
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }

  saveKeyBtn.addEventListener("click", () => {
    localStorage.setItem("jev_api_key", apiKeyInput.value.trim());
    alert(i18n.t("ui_save") + ": JEV API KEY");
  });

  // アダプター & ユースケースのDI
  const jevClient = new JevClient({ apiKey: savedKey });
  const soundEngine = new RetroSoundEngine();
  const gameDirector = new GameDirectorUseCase(jevClient);
  const battleUseCase = new BattleUseCase(i18n);
  const cardGenerator = new CardGeneratorUseCase(jevClient);
  const bgmComposer = new BgmComposerUseCase(jevClient);

  // BGM切り替えボタン
  bgmToggleBtn.addEventListener("click", () => {
    isBgmOn = audioSynthesizer.toggleBgm();
    updateBgmButton();
  });

  const canvasRenderer = new CanvasRenderer(canvas, i18n);
  const inputHandler = new InputHandler(canvas);

  let currentCard: CardData | null = null;

  const appendLog = (msg: string, type: "info" | "jev" | "combat" | "evolution") => {
    const item = document.createElement("div");
    item.className = `log-item log-${type}`;
    const timeStr = new Date().toLocaleTimeString().slice(3);
    item.textContent = `[${timeStr}] ${msg}`;
    logContainer.appendChild(item);
    logContainer.scrollTop = logContainer.scrollHeight;
  };

  const gameLoop = new GameLoop(
    canvasRenderer,
    inputHandler,
    soundEngine,
    gameDirector,
    battleUseCase,
    cardGenerator,
    i18n,
    {
      onLogMessage: appendLog,
      onCardGenerated: (card: CardData, generatedCanvas: HTMLCanvasElement) => {
        currentCard = card;
        cardModalCanvas.width = generatedCanvas.width;
        cardModalCanvas.height = generatedCanvas.height;
        const ctx = cardModalCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(generatedCanvas, 0, 0);
        }
        cardModal.style.display = "flex";
        gameLoop.pause(true);
      },
    },
    audioSynthesizer,
    bgmComposer
  );

  closeCardBtn.addEventListener("click", () => {
    cardModal.style.display = "none";
    gameLoop.pause(false);
  });

  downloadCardBtn.addEventListener("click", () => {
    if (currentCard) {
      CardRenderer.downloadCardImage(cardModalCanvas, currentCard.title);
    }
  });

  shareCardBtn.addEventListener("click", async () => {
    if (currentCard) {
      const msg = await CardRenderer.shareCard(cardModalCanvas, currentCard);
      alert(msg);
    }
  });

  gameLoop.start();
});
