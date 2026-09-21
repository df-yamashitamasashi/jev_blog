/**
 * Retro 8-bit Chiptune Audio Synthesizer (Web Audio API)
 * Clean Architecture - Presentation Layer
 * 
 * Supports dynamic real-time procedural BGM playback composed by Jev,
 * as well as authentic 8-bit retro sound effects (SE).
 */

import { BgmTrack, ScaleType } from "../domain/bgmModels";

// スケールごとのセミトーン（半音）オフセット定義
const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19],
  dorian: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19],
  phrygian: [0, 1, 3, 5, 7, 8, 10, 12, 13, 15, 17, 19],
  pentatonic: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24],
  whole_tone: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11, 12, 14, 15, 17, 19],
  major: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19],
};

function midiToFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private isBgmPlaying = false;
  private currentTrack: BgmTrack | null = null;
  private timerId: number | null = null;
  private step = 0;
  private masterGain: GainNode | null = null;

  private initContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.12; // 耳に優しい音量
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.isBgmPlaying;
  }

  public setTrack(track: BgmTrack): void {
    this.currentTrack = track;
    this.step = 0;
  }

  public toggleBgm(enabled?: boolean): boolean {
    const target = enabled !== undefined ? enabled : !this.isBgmPlaying;
    if (target) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
    return this.isBgmPlaying;
  }

  public startBgm(): void {
    if (this.isBgmPlaying) return;
    const ctx = this.initContext();
    this.isBgmPlaying = true;
    this.step = 0;

    const tick = () => {
      if (!this.isBgmPlaying || !this.currentTrack) return;
      this.playStep(ctx, this.currentTrack, this.step);
      this.step++;
      const sixteenthNoteMs = (60 / this.currentTrack.bpm / 4) * 1000;
      this.timerId = window.setTimeout(tick, sixteenthNoteMs);
    };

    tick();
  }

  public stopBgm(): void {
    this.isBgmPlaying = false;
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private playStep(ctx: AudioContext, track: BgmTrack, currentStep: number): void {
    const scale = SCALE_INTERVALS[track.scale] || SCALE_INTERVALS.minor;
    const now = ctx.currentTime;
    const noteDuration = 60 / track.bpm / 4;

    // 1. メロディ (Chiptune 矩形波 / Square Wave)
    const melIdx = currentStep % track.melodyPattern.length;
    const scaleDegree = track.melodyPattern[melIdx];
    if (scaleDegree >= 0) {
      const semitone = scale[scaleDegree % scale.length] + Math.floor(scaleDegree / scale.length) * 12;
      const freq = midiToFreq(track.rootNote + 12 + semitone);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + noteDuration * 0.85);

      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + noteDuration * 0.9);
    }

    // 2. ベースライン (Chiptune 三角波 / Triangle Wave) - 4ステップごと (4分音符)
    if (currentStep % 4 === 0) {
      const bassIdx = Math.floor(currentStep / 4) % track.bassPattern.length;
      const bassDegree = track.bassPattern[bassIdx];
      const semitone = scale[((bassDegree % scale.length) + scale.length) % scale.length];
      const bassFreq = midiToFreq(track.rootNote - 12 + semitone);

      const bOsc = ctx.createOscillator();
      const bGain = ctx.createGain();
      bOsc.type = "triangle";
      bOsc.frequency.setValueAtTime(bassFreq, now);

      bGain.gain.setValueAtTime(0.15, now);
      bGain.gain.exponentialRampToValueAtTime(0.01, now + noteDuration * 3.6);

      bOsc.connect(bGain);
      if (this.masterGain) bGain.connect(this.masterGain);

      bOsc.start(now);
      bOsc.stop(now + noteDuration * 3.8);
    }

    // 3. ドラム / ノイズパーカッション (White Noise)
    if (track.drumStyle !== "none") {
      // ハイハット (偶数ステップ)
      if (currentStep % 2 === 0) {
        this.playNoise(ctx, now, 0.02, 0.03);
      }
      // スネア (4拍子中の2拍目・4拍目)
      if (currentStep % 8 === 4) {
        this.playNoise(ctx, now, 0.06, 0.08);
      }
    }
  }

  private playNoise(ctx: AudioContext, time: number, duration: number, volume: number): void {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1000, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(filter);
    filter.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);

    noise.start(time);
    noise.stop(time + duration);
  }

  // 効果音 (SE)
  public playAttackSe(): void {
    const ctx = this.initContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playCriticalSe(): void {
    const ctx = this.initContext();
    const now = ctx.currentTime;
    this.playNoise(ctx, now, 0.25, 0.2);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.2);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playChestSe(): void {
    const ctx = this.initContext();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.1, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.08);
      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.08);
    });
  }

  public playStairsSe(): void {
    const ctx = this.initContext();
    const now = ctx.currentTime;
    [880, 784, 659, 523].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.12, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.06);
      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.06);
    });
  }
}
