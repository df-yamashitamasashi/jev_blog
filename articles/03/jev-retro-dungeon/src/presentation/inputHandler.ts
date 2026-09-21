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
  private actionTriggered = false;

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
        this.actionTriggered = true;
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
      this.actionTriggered = true;
    });
  }

  getDungeonInput(): DungeonInput {
    const now = performance.now();
    let dir: "up" | "down" | "left" | "right" | null = null;

    if (this.lastMoveDir && now - this.lastMoveTime >= this.moveDelayMs) {
      dir = this.lastMoveDir;
      this.lastMoveTime = now;
    }

    const action = this.actionTriggered;
    this.actionTriggered = false;

    return {
      moveDir: dir,
      actionPressed: action,
    };
  }

  getBattleInput(): BattleInput {
    const delta = this.battleCursorDelta;
    this.battleCursorDelta = 0;

    const confirm = this.confirmTriggered;
    this.confirmTriggered = false;

    const cancel = this.cancelTriggered;
    this.cancelTriggered = false;

    return {
      cursorDelta: delta,
      confirmPressed: confirm,
      cancelPressed: cancel,
    };
  }
}
