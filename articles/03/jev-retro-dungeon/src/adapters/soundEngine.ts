/**
 * Classic Retro RPG 8-bit Sound Synthesizer (Web Audio API)
 * Clean Architecture - Adapter Layer
 */

export interface ISoundEngine {
  playCursor(): void;
  playSelect(): void;
  playCancel(): void;
  playHit(): void;
  playCritical(): void;
  playSpell(): void;
  playStairs(): void;
  playChest(): void;
  playLevelUp(): void;
  playVictory(): void;
  playDefeat(): void;
  toggleBgm(enable?: boolean): boolean;
}

export class RetroSoundEngine implements ISoundEngine {
  private ctx: AudioContext | null = null;
  private isBgmPlaying = false;
  private bgmIntervalId: number | null = null;

  private initCtx() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playCursor(): void {
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.04);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playSelect(): void {
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(1046.5, now);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  playCancel(): void {
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(330, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playHit(): void {
    this.initCtx();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.12);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playCritical(): void {
    this.initCtx();
    if (!this.ctx) return;
    // かいしんのいちげき：ピシューン！
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.25);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  playSpell(): void {
    this.initCtx();
    if (!this.ctx) return;
    // 呪文ピロリロリ
    const freqs = [440, 554, 659, 880, 1108, 1318];
    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      const start = this.ctx.currentTime + idx * 0.03;
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.08, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.05);
    });
  }

  playStairs(): void {
    this.initCtx();
    if (!this.ctx) return;
    // 階段を降りる音（ザッ ザッ ザッ）
    [0, 0.1, 0.2].forEach((delay) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      const start = this.ctx.currentTime + delay;
      osc.frequency.setValueAtTime(140, start);
      osc.frequency.linearRampToValueAtTime(60, start + 0.07);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.07);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.07);
    });
  }

  playChest(): void {
    this.initCtx();
    if (!this.ctx) return;
    // 宝箱を開けるピロリン音
    const freqs = [523, 659, 783, 1046];
    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      const start = this.ctx.currentTime + idx * 0.06;
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.1, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  }

  playLevelUp(): void {
    this.initCtx();
    if (!this.ctx) return;
    // レベルアップファンファーレ
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, index) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      const startTime = this.ctx.currentTime + index * 0.09;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.16);
    });
  }

  playVictory(): void {
    this.initCtx();
    if (!this.ctx) return;
    // 勝利ファンファーレ（レトロRPG風タタタタン♪）
    const melody = [587.33, 587.33, 587.33, 587.33, 783.99, 880.0];
    const times = [0, 0.09, 0.18, 0.27, 0.4, 0.6];
    melody.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      const start = this.ctx.currentTime + times[idx];
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  }

  playDefeat(): void {
    this.initCtx();
    if (!this.ctx) return;
    // 死亡ジングル
    const melody = [440, 415, 392, 370];
    melody.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      const start = this.ctx.currentTime + idx * 0.25;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.linearRampToValueAtTime(0, start + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }

  toggleBgm(enable?: boolean): boolean {
    this.initCtx();
    if (enable !== undefined) {
      this.isBgmPlaying = !enable;
    }

    if (this.isBgmPlaying) {
      if (this.bgmIntervalId) {
        clearInterval(this.bgmIntervalId);
        this.bgmIntervalId = null;
      }
      this.isBgmPlaying = false;
      return false;
    }

    this.isBgmPlaying = true;
    // レトロRPG風ダンジョンBGM（不気味で重厚な8bitアルペジオ）
    const bassline = [110, 116.54, 110, 98, 103.83, 110, 92.5, 98];
    let step = 0;

    this.bgmIntervalId = window.setInterval(() => {
      if (!this.ctx || !this.isBgmPlaying) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      const now = this.ctx.currentTime;
      const freq = bassline[step % bassline.length];
      step++;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }, 280);

    return true;
  }
}
