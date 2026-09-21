/**
 * Classic Retro RPG Input Handler (Grid Walking & Command Menu)
 * Clean Architecture - Presentation Layer
 */

export interface DungeonInput {
  moveDir: "up" | "down" | "left" | "right" | null;
  actionPressed: boolean;
}

export interface BattleInput {
  cursorDelta: number; // -1 (上), +1 (下)
  confirmPressed: boolean;
  cancelPressed: boolean;
}

export class InputHandler {
  private lastMoveDir: "up" | "down" | "left" | "right" | null = null;

  private battleCursorDelta = 0;
  private confirmTriggered = false;
  private cancelTriggered = false;

  private lastMoveTime = 0;
  private readonly moveDelayMs = 160; // 1歩歩くレトロRPGのウェイト

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      // 探索時移動
      if (e.code === "ArrowUp" || e.code === "KeyW") {
        this.lastMoveDir = "up";
        this.battleCursorDelta = -1;
        e.preventDefault();
      } else if (e.code === "ArrowDown" || e.code === "KeyS") {
        this.lastMoveDir = "down";
        this.battleCursorDelta = 1;
        e.preventDefault();
      } else if (e.code === "ArrowLeft" || e.code === "KeyA") {
        this.lastMoveDir = "left";
        e.preventDefault();
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        this.lastMoveDir = "right";
        e.preventDefault();
      }

      // 決定 / アクション
      if (e.code === "Space" || e.code === "Enter" || e.code === "KeyZ") {
        this.confirmTriggered = true;
        e.preventDefault();
      }

      // キャンセル
      if (e.code === "Escape" || e.code === "KeyX" || e.code === "Backspace") {
        this.cancelTriggered = true;
        e.preventDefault();
      }
    });

    window.addEventListener("keyup", (e) => {
      if (
        (e.code === "ArrowUp" || e.code === "KeyW") && this.lastMoveDir === "up" ||
        (e.code === "ArrowDown" || e.code === "KeyS") && this.lastMoveDir === "down" ||
        (e.code === "ArrowLeft" || e.code === "KeyA") && this.lastMoveDir === "left" ||
        (e.code === "ArrowRight" || e.code === "KeyD") && this.lastMoveDir === "right"
      ) {
        this.lastMoveDir = null;
      }
    });

    canvas.addEventListener("click", () => {
      this.confirmTriggered = true;
    });
  }

  /**
   * エッジ入力（決定 / キャンセル / カーソル移動）をまとめて読み出して解除する。
   *
   * 各フレームで呼ばれるのは現在のモードに対応した1つのgetterだけなので、
   * モードごとに使うフラグだけを解除すると、使われなかったフラグが押しっぱなしのまま
   * 次のモードへ持ち越されてしまう（例: ダンジョンで押した決定キーが、
   * 直後に始まった戦闘の1フレーム目で「たたかう」を勝手に実行する）。
   * そのため、どのgetterから呼ばれても全てのエッジ入力を消費する。
   */
  private consumeEdgeInputs(): { confirm: boolean; cancel: boolean; cursorDelta: number } {
    const edges = {
      confirm: this.confirmTriggered,
      cancel: this.cancelTriggered,
      cursorDelta: this.battleCursorDelta,
    };
    this.confirmTriggered = false;
    this.cancelTriggered = false;
    this.battleCursorDelta = 0;
    return edges;
  }

  /** モーダル表示中など、どのモードの更新も走らないフレームで入力を捨てる */
  flush(): void {
    this.consumeEdgeInputs();
    // 押しっぱなしの方向キーも解除しておく
    // （カードモーダルを閉じた瞬間に勇者が walk しはじめるのを防ぐ）
    this.lastMoveDir = null;
  }

  getDungeonInput(): DungeonInput {
    const now = performance.now();
    let dir: "up" | "down" | "left" | "right" | null = null;

    if (this.lastMoveDir && now - this.lastMoveTime >= this.moveDelayMs) {
      dir = this.lastMoveDir;
      this.lastMoveTime = now;
    }

    const edges = this.consumeEdgeInputs();

    return {
      moveDir: dir,
      actionPressed: edges.confirm,
    };
  }

  getBattleInput(): BattleInput {
    const edges = this.consumeEdgeInputs();

    return {
      cursorDelta: edges.cursorDelta,
      confirmPressed: edges.confirm,
      cancelPressed: edges.cancel,
    };
  }
}
