/**
 * Multi-Agent Telemetry HUD Presentation Component (Clean Architecture - Presentation Layer)
 * Top AI & Bottom AI/Human のリアルタイム思考ログ、戦術バッジ、心理戦チャット
 */

import { AgentTelemetry, DecisionStatus, AGENT_PROFILES, AgentType } from "../domain/jevAgentTypes";
import { ServoMode } from "../usecases/agentBrainUseCase";
import { GameMatchState, GameStatus } from "../domain/gameState";
import { ModelSettings } from "../adapters/modelSettings";

/**
 * サーボが今やっていること。AIの判断 (どこを狙うか) と、それを実行する機構の
 * 状態を分けて見せる。これが無いと「AIが動かしているのか、ローカル処理が
 * 動かしているのか」が画面から判別できない。
 */
const SERVO_LABEL: Record<ServoMode, string> = {
  SETUP: "🎯 打点で構え中",
  STRIKE: "💥 振り抜き中",
  DEFEND: "🛡️ 進路を塞ぐ (計画なし)",
  HOME: "↩️ 守備隊形へ復帰",
};

const STATUS_LABEL: Record<DecisionStatus, string> = {
  OK: "✅ 有効な判断",
  CLAMPED: "⚠️ 物理制限で丸めました",
  INVALID: "❌ 応答が解釈不能",
  ERROR: "❌ 通信エラー",
  TIMEOUT: "❌ 時間切れ",
};

export class TelemetryHud {
  private chatBubbleEl: HTMLElement | null = null;
  private currentChatTimeout: number | null = null;

  constructor(_container: HTMLElement) {}

  /** サーボの実行状態と、AIの応答待ちかどうかを表示する */
  updateServoState(mode: ServoMode, awaitingDecision: boolean): void {
    const el = document.getElementById("hud-servo-mode");
    if (!el) return;

    el.textContent = awaitingDecision ? `⏳ AI判断待ち / ${SERVO_LABEL[mode]}` : SERVO_LABEL[mode];
    el.setAttribute("data-stance", awaitingDecision ? "THINKING" : mode);
  }

  updateTelemetry(
    topTelemetry: AgentTelemetry | null,
    bottomTelemetry: AgentTelemetry | null = null
  ): void {
    if (topTelemetry) {
      const latencyEl = document.getElementById("hud-latency");
      if (latencyEl) {
        const badge = topTelemetry.isLiveApi
          ? `<span class="mode-tag live">🟢 Cloud API</span>`
          : `<span class="mode-tag cpu">🖥️ ローカル演算</span>`;
        // 実測レイテンシは参考値。勝敗には影響しない
        latencyEl.innerHTML = `${Math.round(topTelemetry.rawLatencyMs)} ms ${badge}`;
      }

      const statusEl = document.getElementById("hud-stance");
      if (statusEl) {
        if (topTelemetry.status === "ERROR") {
          const reason = topTelemetry.clampNotes[0] || "通信エラー";
          if (reason.includes("429") || reason.toLowerCase().includes("quota") || reason.includes("rate-limit")) {
            statusEl.textContent = "⏳ 無料枠制限 (429)";
          } else {
            statusEl.textContent = `❌ ${reason.length > 28 ? reason.slice(0, 28) + "…" : reason}`;
          }
        } else {
          statusEl.textContent = STATUS_LABEL[topTelemetry.status];
        }
        statusEl.setAttribute("data-stance", topTelemetry.status);
      }

      const planEl = document.getElementById("hud-confidence");
      if (planEl) {
        if (topTelemetry.status === "ERROR") {
          const reason = topTelemetry.clampNotes[0] || "不明";
          if (reason.includes("429") || reason.toLowerCase().includes("quota") || reason.includes("rate-limit")) {
            const match = reason.match(/retry in ([0-9.]+)s/i);
            const waitTime = match ? `${Math.ceil(parseFloat(match[1]))}秒後` : "約7秒後";
            planEl.textContent = `⏳ Gemini無料枠の上限(5回/分)に達しました。${waitTime}に自動再開します（現在は緊急守備ブロック中）`;
          } else {
            planEl.textContent = `⚠️ エラー詳細: ${reason}`;
          }
        } else {
          planEl.textContent = describePlan(topTelemetry);
        }
      }

      const detailEl = document.getElementById("hud-courses-list");
      if (detailEl) {
        detailEl.innerHTML = renderPlanDetail(topTelemetry);
      }

      if (topTelemetry.latestChat) {
        this.displayChat(
          "TOP",
          topTelemetry.latestChat.text,
          topTelemetry.latestChat.category,
          topTelemetry.isLiveApi
        );
      }
    }

    if (bottomTelemetry?.latestChat) {
      this.displayChat(
        "BOTTOM",
        bottomTelemetry.latestChat.text,
        bottomTelemetry.latestChat.category,
        bottomTelemetry.isLiveApi
      );
    }
  }

  updateMatchState(state: GameMatchState): void {
    const topProf = AGENT_PROFILES[state.topAgent];
    const botProf = AGENT_PROFILES[state.bottomAgent];

    // 各モデルのAPIキー設定有無を確認
    const isTopAi = state.topAgent !== AgentType.HUMAN && (
      (state.topAgent === AgentType.JEV && !!localStorage.getItem("jev_api_key")) ||
      (state.topAgent === AgentType.GEMINI && !!localStorage.getItem("gemini_api_key")) ||
      (state.topAgent === AgentType.CLAUDE && !!localStorage.getItem("claude_api_key"))
    );

    const isBotHuman = state.bottomAgent === AgentType.HUMAN;
    const isBotAi = !isBotHuman && (
      (state.bottomAgent === AgentType.JEV && !!localStorage.getItem("jev_api_key")) ||
      (state.bottomAgent === AgentType.GEMINI && !!localStorage.getItem("gemini_api_key")) ||
      (state.bottomAgent === AgentType.CLAUDE && !!localStorage.getItem("claude_api_key"))
    );

    // スコアボードのラベル更新
    const labelTopEl = document.getElementById("label-top");
    const labelBotEl = document.getElementById("label-bottom");
    if (labelTopEl) labelTopEl.textContent = topProf.displayName;
    if (labelBotEl) labelBotEl.textContent = botProf.displayName;

    // スコアボード直下のモードバッジ更新
    const badgeTopEl = document.getElementById("status-badge-top");
    const badgeBotEl = document.getElementById("status-badge-bottom");

    if (badgeTopEl) {
      if (state.topAgent === AgentType.HUMAN) {
        badgeTopEl.className = "scoreboard-mode-tag human";
        badgeTopEl.textContent = "👤 HUMAN (PLAYER)";
      } else if (state.topAgent === AgentType.CPU) {
        badgeTopEl.className = "scoreboard-mode-tag cpu";
        badgeTopEl.textContent = "🖥️ CPU (幾何解)";
      } else {
        badgeTopEl.className = isTopAi ? "scoreboard-mode-tag live" : "scoreboard-mode-tag cpu";
        badgeTopEl.textContent = isTopAi ? "🟢 LIVE CLOUD AI" : "🔑 APIキー未設定";
      }
    }

    if (badgeBotEl) {
      if (state.bottomAgent === AgentType.HUMAN) {
        badgeBotEl.className = "scoreboard-mode-tag human";
        badgeBotEl.textContent = "👤 HUMAN (PLAYER)";
      } else if (state.bottomAgent === AgentType.CPU) {
        badgeBotEl.className = "scoreboard-mode-tag cpu";
        badgeBotEl.textContent = "🖥️ CPU (幾何解)";
      } else {
        badgeBotEl.className = isBotAi ? "scoreboard-mode-tag live" : "scoreboard-mode-tag cpu";
        badgeBotEl.textContent = isBotAi ? "🟢 LIVE CLOUD AI" : "🔑 APIキー未設定";
      }
    }

    const getAgentModelDesc = (type: AgentType): string => {
      switch (type) {
        case AgentType.CPU:
          return "内蔵の幾何解ソルバー";
        case AgentType.JEV:
          return "TypeSafe Jev System One";
        case AgentType.GEMINI:
          return `Gemini (${ModelSettings.getGeminiModel()})`;
        case AgentType.CLAUDE:
          return `Claude (${ModelSettings.getClaudeModel()})`;
        default:
          return "";
      }
    };

    // HUD の CURRENT MATCH ENGINE カード更新
    const hudTopName = document.getElementById("hud-top-name");
    const hudTopBadge = document.getElementById("hud-top-engine-badge");
    const hudTopDesc = document.getElementById("hud-top-desc");
    if (hudTopName) {
      if (state.topAgent === AgentType.HUMAN) {
        hudTopName.textContent = "PLAYER (人間)";
      } else if (state.topAgent === AgentType.CPU) {
        hudTopName.textContent = "CPU (幾何解ソルバー)";
      } else {
        hudTopName.textContent = `${topProf.displayName} [${getAgentModelDesc(state.topAgent)}]`;
      }
    }
    if (hudTopBadge) {
      if (state.topAgent === AgentType.HUMAN) {
        hudTopBadge.className = "scoreboard-mode-tag human";
        hudTopBadge.textContent = "👤 人間プレイヤー (Human)";
      } else if (state.topAgent === AgentType.CPU) {
        hudTopBadge.className = "scoreboard-mode-tag cpu";
        hudTopBadge.textContent = "🖥️ ローカルCPU (対照群)";
      } else {
        hudTopBadge.className = isTopAi ? "scoreboard-mode-tag live" : "scoreboard-mode-tag cpu";
        hudTopBadge.textContent = isTopAi ? "🟢 本物AI (Cloud API)" : "🔑 APIキー未設定";
      }
    }
    if (hudTopDesc) {
      if (state.topAgent === AgentType.HUMAN) {
        hudTopDesc.textContent = "マウス/タッチ操作でコントロール";
      } else if (state.topAgent === AgentType.CPU) {
        hudTopDesc.textContent = "壁反射を含む軌道予測で迎撃点を算出。API通信なしの対照群";
      } else {
        hudTopDesc.textContent = isTopAi
          ? `${getAgentModelDesc(state.topAgent)} が迎撃点とスイングを決定しています`
          : `APIキーが未設定です。API Keysボタンからキーを設定してください。`;
      }
    }

    const hudBotName = document.getElementById("hud-bot-name");
    const hudBotBadge = document.getElementById("hud-bot-engine-badge");
    const hudBotDesc = document.getElementById("hud-bot-desc");
    if (hudBotName) {
      if (state.bottomAgent === AgentType.HUMAN) {
        hudBotName.textContent = "PLAYER (人間)";
      } else if (state.bottomAgent === AgentType.CPU) {
        hudBotName.textContent = "CPU (幾何解ソルバー)";
      } else {
        hudBotName.textContent = `${botProf.displayName} [${getAgentModelDesc(state.bottomAgent)}]`;
      }
    }
    if (hudBotBadge) {
      if (state.bottomAgent === AgentType.HUMAN) {
        hudBotBadge.className = "scoreboard-mode-tag human";
        hudBotBadge.textContent = "👤 人間プレイヤー (Human)";
      } else if (state.bottomAgent === AgentType.CPU) {
        hudBotBadge.className = "scoreboard-mode-tag cpu";
        hudBotBadge.textContent = "🖥️ ローカルCPU (対照群)";
      } else {
        hudBotBadge.className = isBotAi ? "scoreboard-mode-tag live" : "scoreboard-mode-tag cpu";
        hudBotBadge.textContent = isBotAi ? "🟢 本物AI (Cloud API)" : "🔑 APIキー未設定";
      }
    }
    if (hudBotDesc) {
      if (state.bottomAgent === AgentType.HUMAN) {
        hudBotDesc.textContent = "プレイヤーのマウス/タッチ操作にリアルタイム追従";
      } else if (state.bottomAgent === AgentType.CPU) {
        hudBotDesc.textContent = "壁反射を含む軌道予測で迎撃点を算出。API通信なしの対照群";
      } else {
        hudBotDesc.textContent = isBotAi
          ? `${getAgentModelDesc(state.bottomAgent)} が迎撃点とスイングを決定しています`
          : `APIキーが未設定です。API Keysボタンからキーを設定してください。`;
      }
    }

    const scorePlayerEl = document.getElementById("score-player"); // Bottom
    const scoreJevEl = document.getElementById("score-jev");       // Top
    const rallyEl = document.getElementById("hud-rally");
    const maxSpeedEl = document.getElementById("hud-max-speed");

    if (scorePlayerEl) scorePlayerEl.textContent = state.score.player.toString();
    if (scoreJevEl) scoreJevEl.textContent = state.score.jev.toString();
    if (rallyEl) rallyEl.textContent = state.rallyCount.toString();
    if (maxSpeedEl) maxSpeedEl.textContent = `${state.maxSpeedReached} px/s`;

    // バナー表示
    const bannerEl = document.getElementById("game-banner");
    if (bannerEl) {
      if (state.status === GameStatus.READY) {
        bannerEl.textContent = "PRESS START TO PLAY";
        bannerEl.style.display = "block";
      } else if (state.status === GameStatus.GOAL_SCORED) {
        bannerEl.textContent = state.lastScorer === "BOTTOM"
          ? `GOAL! ${botProf.displayName} SCORED`
          : `GOAL! ${topProf.displayName} SCORED`;
        bannerEl.style.display = "block";
      } else if (state.status === GameStatus.GAME_OVER) {
        const winner = state.score.player >= state.score.targetScore ? botProf.displayName : topProf.displayName;
        bannerEl.textContent = `VICTORY! ${winner} WINS`;
        bannerEl.style.display = "block";
      } else if (state.status === GameStatus.PAUSED) {
        bannerEl.textContent = "GAME PAUSED";
        bannerEl.style.display = "block";
      } else {
        bannerEl.style.display = "none";
      }
    }
  }

  private displayChat(
    sender: "TOP" | "BOTTOM",
    text: string,
    category: string,
    isLiveApi: boolean
  ): void {
    if (!this.chatBubbleEl) {
      this.chatBubbleEl = document.getElementById("jev-chat-bubble");
    }
    if (!this.chatBubbleEl) return;

    this.chatBubbleEl.textContent = `${isLiveApi ? "[🟢 Cloud AI]" : "[🖥️ CPU]"} ${text}`;
    this.chatBubbleEl.setAttribute("data-category", category);
    this.chatBubbleEl.setAttribute("data-sender", sender);
    this.chatBubbleEl.classList.add("visible");

    this.chatBubbleEl.style.borderColor = isLiveApi
      ? "rgba(16, 185, 129, 0.8)"
      : "rgba(217, 119, 6, 0.8)";
    this.chatBubbleEl.style.boxShadow = isLiveApi
      ? "0 0 18px rgba(16, 185, 129, 0.5)"
      : "0 0 18px rgba(217, 119, 6, 0.4)";

    if (this.currentChatTimeout) clearTimeout(this.currentChatTimeout);
    this.currentChatTimeout = window.setTimeout(() => {
      this.chatBubbleEl?.classList.remove("visible");
    }, 4500);
  }
}

function describePlan(telemetry: AgentTelemetry): string {
  const { plan, status } = telemetry;
  if (!plan) {
    if (status === "TIMEOUT") return "⏱️ タイムアウト: 緊急守備ブロックで迎撃";
    return "🛡️ 計画なし: 緊急守備ブロックで迎撃";
  }

  return `迎撃 (${Math.round(plan.interceptPoint.x)}, ${Math.round(plan.interceptPoint.y)}) / 振り抜き ${Math.round(plan.swingDirDeg)}° / ${Math.round(plan.swingSpeed)} px/s`;
}

function renderPlanDetail(telemetry: AgentTelemetry): string {
  const rows: Array<[string, string]> = [];

  if (telemetry.plan) {
    rows.push([
      "狙い点",
      `(${Math.round(telemetry.plan.aimPoint.x)}, ${Math.round(telemetry.plan.aimPoint.y)})`,
    ]);
  }

  for (const note of telemetry.clampNotes) {
    rows.push(["補正", note]);
  }

  if (rows.length === 0) return "";

  return rows
    .map(
      ([label, value]) => `
        <div class="course-item">
          <div class="course-header">
            <span class="course-name">${escapeHtml(label)}</span>
            <span class="course-score">${escapeHtml(value)}</span>
          </div>
        </div>`
    )
    .join("");
}

/** LLM由来の文字列をDOMへ入れるため、常にエスケープする */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
