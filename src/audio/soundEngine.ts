// Synthesized Web Audio API SFX inspired by Pikmin 3's KopPad & Day-End Fruit Tally

const STORAGE_KEY = 'koppad_sound_muted';

class KopPadSoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    this.muted = saved === 'true';
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(muted));
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    duration: number,
    options?: {
      type?: OscillatorType;
      gain?: number;
      delay?: number;
      slideTo?: number;
    }
  ) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime + (options?.delay ?? 0);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = options?.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (options?.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(options.slideTo, now + duration);
    }

    const peak = options?.gain ?? 0.11;
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(peak, now + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playTap(): void {
    this.tone(720, 0.075, { type: 'triangle', gain: 0.07, slideTo: 980 });
  }

  public playSunsetChime(): void {
    // Warm Koppai sundown orbital chord
    const notes = [392.0, 493.88, 587.33, 783.99];
    notes.forEach((n, idx) => {
      this.tone(n, 0.36, { type: 'sine', gain: 0.065, delay: idx * 0.07 });
    });
  }

  public playPurchasePop(index: number): void {
    // Bubble pop + ascending pentatonic fruit-tally chime!
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
    const note = pentatonic[index % pentatonic.length];
    this.tone(240, 0.08, { type: 'sine', gain: 0.08, slideTo: 520 });
    this.tone(note, 0.22, { type: 'triangle', gain: 0.1, delay: 0.045 });
    this.tone(note * 1.5, 0.16, { type: 'sine', gain: 0.045, delay: 0.07 });
  }

  public playDayComplete(status: 'abundant' | 'healthy' | 'caution' | 'critical'): void {
    if (status === 'abundant' || status === 'healthy') {
      // Sparkling victory / ration-preserved chime
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((n, idx) => {
        this.tone(n, 0.42, { type: 'triangle', gain: 0.08, delay: idx * 0.08 });
      });
    } else {
      // Gentle KopPad caution warble
      this.tone(587.33, 0.18, { type: 'triangle', gain: 0.08, delay: 0 });
      this.tone(493.88, 0.18, { type: 'triangle', gain: 0.08, delay: 0.16 });
      this.tone(440.0, 0.34, { type: 'sine', gain: 0.08, delay: 0.32 });
    }
  }

  public playSyncPulse(): void {
    this.tone(640, 0.1, { type: 'sine', gain: 0.07, slideTo: 960 });
    this.tone(960, 0.16, { type: 'triangle', gain: 0.075, delay: 0.11, slideTo: 1280 });
  }
}

export const soundEngine = new KopPadSoundEngine();
