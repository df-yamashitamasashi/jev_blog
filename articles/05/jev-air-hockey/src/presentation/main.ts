/**
 * Multi-Agent Application Entry Point & Input Orchestrator
 * Clean Architecture - Presentation Layer
 */

import { DEFAULT_STADIUM_CONFIG } from "../domain/gameState";
import { AgentType } from "../domain/jevAgentTypes";
import { SoundSynthesizer } from "../adapters/soundSynthesizer";
import { PhysicsEngine } from "../usecases/physicsEngine";
import { AgentBrainUseCase } from "../usecases/agentBrainUseCase";
import { GameLoopUseCase } from "../usecases/gameLoopUseCase";
import { CanvasRenderer } from "./canvasRenderer";
import { TelemetryHud } from "./telemetryHud";
import { AgentFactory } from "../adapters/agentFactory";
import { ModelSettings, listGeminiModels } from "../adapters/modelSettings";
import { TournamentUseCase } from "../usecases/tournamentUseCase";
import { TournamentPanel } from "./tournamentPanel";

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("air-hockey-canvas") as HTMLCanvasElement;
  const hudContainer = document.getElementById("hud-container") as HTMLElement;

  if (!canvas || !hudContainer) {
    console.error("Required DOM elements not found");
    return;
  }

  const config = DEFAULT_STADIUM_CONFIG;

  // Clean Architecture 依存性注入 (DI)
  const soundSynth = new SoundSynthesizer();
  const physicsEngine = new PhysicsEngine(config);

  // 初期対戦: CPU (Top) vs Human (Bottom)
  const initialTopClient = AgentFactory.createClient(AgentType.CPU);
  const topBrain = new AgentBrainUseCase(initialTopClient, config, "TOP", AgentType.CPU);

  const gameLoop = new GameLoopUseCase(
    physicsEngine,
    topBrain,
    soundSynth,
    config,
    AgentType.CPU,
    AgentType.HUMAN
  );

  const renderer = new CanvasRenderer(canvas, config);
  const hud = new TelemetryHud(hudContainer);

  // コールバック登録
  gameLoop.setCallbacks(
    (state) => {
      hud.updateMatchState(state);
      const selTop = document.getElementById("select-top-agent") as HTMLSelectElement | null;
      const selBot = document.getElementById("select-bottom-agent") as HTMLSelectElement | null;
      if (selTop && selTop.value !== state.topAgent) {
        selTop.value = state.topAgent;
      }
      if (selBot && selBot.value !== state.bottomAgent) {
        selBot.value = state.bottomAgent;
      }
    },
    (event) => {
      if (event.type === "PUCK_WALL") {
        renderer.addSparks(event.pos, 10, "#00f0ff");
      } else if (event.type === "PUCK_MALLET_PLAYER") {
        renderer.addSparks(event.pos, 20, "#00f0ff");
        renderer.triggerShake(event.impactSpeed > 1200 ? 5 : 2);
      } else if (event.type === "PUCK_MALLET_JEV") {
        renderer.addSparks(event.pos, 22, "#ff0055");
        renderer.triggerShake(event.impactSpeed > 1200 ? 6 : 2);
      } else if (event.type === "GOAL_PLAYER" || event.type === "GOAL_JEV") {
        renderer.addSparks(event.pos, 45, event.type === "GOAL_PLAYER" ? "#00f0ff" : "#ff0055");
        renderer.triggerShake(12, 0.35);
      }
    }
  );

  // 入力制御 (人間操作時のみ反映)
  let lastPointerTime = performance.now();

  const handlePointerMove = (clientX: number, clientY: number) => {
    // BottomがAIの場合は人間操作を無視 (観戦モード)
    if (gameLoop.getMatchState().bottomAgent !== AgentType.HUMAN) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // プレイヤー陣地 (コート下半分のみ)
    const margin = config.malletRadius;
    const clampedX = Math.max(margin, Math.min(config.width - margin, x));
    const clampedY = Math.max(config.height * 0.52, Math.min(config.height - margin, y));

    const now = performance.now();
    const dt = Math.max(0.001, (now - lastPointerTime) / 1000);

    const playerMallet = physicsEngine.getPlayerMallet();
    playerMallet.vel.set((clampedX - playerMallet.pos.x) / dt, (clampedY - playerMallet.pos.y) / dt);
    playerMallet.pos.set(clampedX, clampedY);

    lastPointerTime = now;
  };

  canvas.addEventListener("mousemove", (e) => {
    handlePointerMove(e.clientX, e.clientY);
  });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  // UIボタン制御
  const startBtn = document.getElementById("btn-start");
  const pauseBtn = document.getElementById("btn-pause");
  const bgmBtn = document.getElementById("btn-bgm");

  startBtn?.addEventListener("click", () => {
    gameLoop.startMatch();
  });

  pauseBtn?.addEventListener("click", () => {
    gameLoop.pauseMatch();
  });

  bgmBtn?.addEventListener("click", () => {
    soundSynth.toggleBgm();
    if (bgmBtn) {
      bgmBtn.textContent = soundSynth.isBgmActive() ? "🎵 BGM: ON" : "🎵 BGM: OFF";
      bgmBtn.classList.toggle("active", soundSynth.isBgmActive());
    }
  });

  // 対戦カード ドロップダウン切り替えセレクタ
  const selectTopAgent = document.getElementById("select-top-agent") as HTMLSelectElement;
  const selectBottomAgent = document.getElementById("select-bottom-agent") as HTMLSelectElement;

  const handleMatchupChange = () => {
    if (!selectTopAgent || !selectBottomAgent) return;
    const top = selectTopAgent.value as AgentType;
    const bottom = selectBottomAgent.value as AgentType;
    gameLoop.setMatchup(top, bottom);
  };

  selectTopAgent?.addEventListener("change", handleMatchupChange);
  selectBottomAgent?.addEventListener("change", handleMatchupChange);

  // API Key統合設定モーダル
  const apiKeyBtn = document.getElementById("btn-api-key");
  const modal = document.getElementById("api-key-modal");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const saveKeysBtn = document.getElementById("save-keys-btn");

  const jevKeyInput = document.getElementById("input-jev-key") as HTMLInputElement;
  const geminiKeyInput = document.getElementById("input-gemini-key") as HTMLInputElement;
  const claudeKeyInput = document.getElementById("input-claude-key") as HTMLInputElement;

  const updateModelNameLabels = () => {
    const geminiModelEl = document.getElementById("model-gemini-name");
    const claudeModelEl = document.getElementById("model-claude-name");
    if (geminiModelEl) geminiModelEl.textContent = ModelSettings.getGeminiModel();
    if (claudeModelEl) claudeModelEl.textContent = ModelSettings.getClaudeModel();
  };

  apiKeyBtn?.addEventListener("click", () => {
    const jevKey = localStorage.getItem("jev_api_key") || "";
    const geminiKey = localStorage.getItem("gemini_api_key") || "";
    const claudeKey = localStorage.getItem("claude_api_key") || "";

    if (jevKeyInput) jevKeyInput.value = jevKey;
    if (geminiKeyInput) geminiKeyInput.value = geminiKey;
    if (claudeKeyInput) claudeKeyInput.value = claudeKey;

    const statusJev = document.getElementById("status-jev-key");
    const statusGemini = document.getElementById("status-gemini-key");
    const statusClaude = document.getElementById("status-claude-key");

    if (statusJev) {
      statusJev.className = jevKey ? "mode-tag live" : "mode-tag cpu";
      statusJev.textContent = jevKey ? "🟢 本物AIモード" : "🖥️ CPUモード";
    }
    if (statusGemini) {
      statusGemini.className = geminiKey ? "mode-tag live" : "mode-tag cpu";
      statusGemini.textContent = geminiKey ? "🟢 本物AIモード" : "🖥️ CPUモード";
    }
    if (statusClaude) {
      statusClaude.className = claudeKey ? "mode-tag live" : "mode-tag cpu";
      statusClaude.textContent = claudeKey ? "🟢 本物AIモード" : "🖥️ CPUモード";
    }

    updateModelNameLabels();

    if (modal) modal.style.display = "flex";
  });

  // 最新モデル動的取得ボタン
  document.getElementById("btn-refresh-gemini-models")?.addEventListener("click", async () => {
    const key = (jevKeyInput ? geminiKeyInput.value.trim() : "") || localStorage.getItem("gemini_api_key") || "";
    if (!key) {
      alert("先にGoogle Gemini API Keyを入力してください。");
      return;
    }
    const btn = document.getElementById("btn-refresh-gemini-models");
    if (btn) btn.textContent = "⏳ 取得中...";
    const models = await listGeminiModels(key);
    updateModelNameLabels();
    if (btn) btn.textContent = "🔄 利用可能モデルを確認";
    alert(`このキーで使えるGeminiモデル (${models.length}件):\n\n${models.slice(0, 20).join("\n")}`);
  });

  modalCloseBtn?.addEventListener("click", () => {
    if (modal) modal.style.display = "none";
  });

  saveKeysBtn?.addEventListener("click", () => {
    const jKey = jevKeyInput?.value.trim() || "";
    const gKey = geminiKeyInput?.value.trim() || "";
    const cKey = claudeKeyInput?.value.trim() || "";

    if (jevKeyInput) localStorage.setItem("jev_api_key", jKey);
    if (geminiKeyInput) localStorage.setItem("gemini_api_key", gKey);
    if (claudeKeyInput) localStorage.setItem("claude_api_key", cKey);

    alert("APIキーを保存しました。画面を再読み込みしてエージェントをロードします。");
    if (modal) modal.style.display = "none";
    location.reload();
  });

  // グローバルなエージェント稼働状態バッジ同期関数
  const updateGlobalEngineStatusUI = () => {
    const hasJev = !!localStorage.getItem("jev_api_key");
    const hasGemini = !!localStorage.getItem("gemini_api_key");
    const hasClaude = !!localStorage.getItem("claude_api_key");

    // 1. トップのステータスチップ更新
    const chipJev = document.getElementById("chip-jev");
    const chipJevText = document.getElementById("chip-jev-text");
    if (chipJev && chipJevText) {
      chipJev.className = hasJev ? "engine-chip live" : "engine-chip cpu";
      chipJevText.textContent = hasJev ? "🟢 本物AI (Cloud)" : "🔑 APIキー未設定";
    }

    const chipGemini = document.getElementById("chip-gemini");
    const chipGeminiText = document.getElementById("chip-gemini-text");
    if (chipGemini && chipGeminiText) {
      chipGemini.className = hasGemini ? "engine-chip live" : "engine-chip cpu";
      chipGeminiText.textContent = hasGemini ? "🟢 本物AI (Cloud)" : "🔑 APIキー未設定";
    }

    const chipClaude = document.getElementById("chip-claude");
    const chipClaudeText = document.getElementById("chip-claude-text");
    if (chipClaude && chipClaudeText) {
      chipClaude.className = hasClaude ? "engine-chip live" : "engine-chip cpu";
      chipClaudeText.textContent = hasClaude ? "🟢 本物AI (Cloud)" : "🔑 APIキー未設定";
    }

    // 2. ドロップダウン内の各AIオプションの活性/非活性（グレーアウト）更新
    const updateOptionState = (optId: string, isAvailable: boolean, activeText: string, inactiveText: string) => {
      const opt = document.getElementById(optId) as HTMLOptionElement | null;
      if (opt) {
        opt.disabled = !isAvailable;
        opt.textContent = isAvailable ? activeText : inactiveText;
      }
    };

    updateOptionState("opt-top-jev", hasJev, "⚡ Jev AI (System One)", "⚡ Jev AI (要APIキー)");
    updateOptionState("opt-bot-jev", hasJev, "⚡ Jev AI (System One)", "⚡ Jev AI (要APIキー)");
    updateOptionState("opt-top-gemini", hasGemini, "♊ Gemini AI (Flash)", "♊ Gemini AI (要APIキー)");
    updateOptionState("opt-bot-gemini", hasGemini, "♊ Gemini AI (Flash)", "♊ Gemini AI (要APIキー)");
    updateOptionState("opt-top-claude", hasClaude, "🧠 Claude AI (Strategic)", "🧠 Claude AI (要APIキー)");
    updateOptionState("opt-bot-claude", hasClaude, "🧠 Claude AI (Strategic)", "🧠 Claude AI (要APIキー)");

    // 3. もし現在選択中のAIが無効化された場合はCPUに自動フォールバック
    if (selectTopAgent && selectTopAgent.selectedOptions[0]?.disabled) {
      selectTopAgent.value = "CPU";
    }
    if (selectBottomAgent && selectBottomAgent.selectedOptions[0]?.disabled) {
      selectBottomAgent.value = "HUMAN";
    }

    if (selectTopAgent && selectBottomAgent) {
      gameLoop.setMatchup(selectTopAgent.value as AgentType, selectBottomAgent.value as AgentType);
    }
  };

  // チップクリックでAPIキー設定モーダルを直接オープン
  ["chip-jev", "chip-gemini", "chip-claude"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => {
      apiKeyBtn?.click();
    });
  });

  // トーナメント (設定・実行・結果表示はすべて画面上で完結)
  const tournament = new TournamentUseCase(gameLoop);
  const tournamentPanelEl = document.getElementById("tournament-panel");
  if (tournamentPanelEl) {
    new TournamentPanel(tournamentPanelEl, tournament);
  }

  // 初期ステータス同期
  updateGlobalEngineStatusUI();

  // 初期ステート通知
  hud.updateMatchState(gameLoop.getMatchState());

  // シミュレーションループ (描画とは分離)。
  // 固定タイムステップで進み、AIの応答待ちの間は時計が止まる。
  // requestAnimationFrame はタブが非表示になると停止してしまうため、
  // 長時間かかるトーナメントが中断しないようタイマーで駆動する。
  // 結果は実時間から独立しているので、背面で速度が落ちても勝敗は変わらない。
  const STEPS_PER_SECOND = 1 / config.fixedDt;
  const MAX_CATCHUP_SEC = 0.5;

  let lastSimTime = performance.now();

  const simTick = async () => {
    const now = performance.now();
    const elapsedSec = Math.min(MAX_CATCHUP_SEC, (now - lastSimTime) / 1000);
    lastSimTime = now;

    const steps = Math.max(1, Math.round(elapsedSec * STEPS_PER_SECOND));

    try {
      if (tournament.isRunning()) {
        await tournament.tick(steps);
      } else {
        await gameLoop.advance(steps);
      }
    } catch (e) {
      console.error("シミュレーションの進行でエラーが発生しました:", e);
    }

    setTimeout(simTick, 8);
  };

  void simTick();

  // 描画ループ
  let lastFrameTime = performance.now();

  const gameLoopTick = () => {
    const now = performance.now();
    const renderDt = Math.min(0.033, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    const matchState = gameLoop.getMatchState();
    const topBrain = gameLoop.getTopBrain();
    const bottomBrain = gameLoop.getBottomBrain();
    const topTelemetry = topBrain.getTelemetry();
    const bottomTelemetry = bottomBrain?.getTelemetry() ?? null;

    renderer.render(
      renderDt,
      physicsEngine.getPuck(),
      physicsEngine.getPlayerMallet(),
      physicsEngine.getJevMallet(),
      topTelemetry,
      bottomTelemetry,
      matchState.topAgent,
      matchState.bottomAgent
    );

    hud.updateTelemetry(topTelemetry, bottomTelemetry);

    requestAnimationFrame(gameLoopTick);
  };

  requestAnimationFrame(gameLoopTick);
});
