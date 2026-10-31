/**
 * Sound effects, synthesized with WebAudio at runtime: no audio files.
 * The AudioContext starts on the first user gesture (browsers require it).
 */
export type SfxName =
  | 'harvest'
  | 'swat'
  | 'place'
  | 'feed'
  | 'transfer'
  | 'scatter'
  | 'fail'
  | 'relay'
  | 'dark'
  | 'win'
  | 'lose'
  | 'drained'
  | 'leeched'
  | 'grew'
  | 'click';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private hum: { gain: GainNode; osc: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private _muted = false;

  /** The shared context and master bus, once unlocked. Music plays through the same bus. */
  get output(): { ctx: AudioContext; out: AudioNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, out: this.master } : null;
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /** Call from a user gesture (key or click). Creates or resumes the context. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.createHum();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The beam's hum: 0 silent, up to 1 when lit. Call every frame. */
  setBeam(level: number): void {
    if (!this.ctx || !this.hum) return;
    const t = this.ctx.currentTime;
    this.hum.gain.gain.setTargetAtTime(0.12 * level, t, 0.15);
    this.hum.filter.frequency.setTargetAtTime(200 + 1400 * level, t, 0.15);
  }

  play(name: SfxName): void {
    if (!this.ctx || this._muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'harvest':
        this.tone(440, t, 0.09, 'square', 0.15, 880);
        this.tone(880, t + 0.07, 0.08, 'square', 0.1);
        break;
      case 'swat':
        this.noise(t, 0.12, 3000, 0.3, 800);
        this.tone(1200, t, 0.1, 'square', 0.1, 600);
        break;
      case 'place':
        this.tone(220, t, 0.12, 'triangle', 0.3, 110);
        this.noise(t, 0.05, 1200, 0.15);
        break;
      case 'feed':
        this.tone(330, t, 0.25, 'sine', 0.2, 660);
        break;
      case 'transfer':
        this.noise(t, 0.45, 300, 0.35, 4000);
        this.tone(200, t, 0.4, 'sine', 0.2, 800);
        break;
      case 'scatter':
        this.tone(900, t, 0.5, 'sawtooth', 0.15, 80);
        this.noise(t, 0.5, 4000, 0.2, 200);
        break;
      case 'fail':
        this.tone(140, t, 0.14, 'square', 0.12);
        this.tone(110, t + 0.1, 0.14, 'square', 0.12);
        break;
      case 'relay':
        [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.06, 0.6, 'triangle', 0.14));
        break;
      case 'dark':
        [784, 622, 523, 392, 262].forEach((f, i) => this.tone(f, t + i * 0.16, 0.8, 'triangle', 0.14));
        this.noise(t, 1.5, 600, 0.15, 100);
        break;
      case 'win':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.12, 0.5, 'square', 0.08));
        [523, 659, 784].forEach((f) => this.tone(f, t + 0.6, 1.4, 'triangle', 0.12));
        break;
      case 'lose':
        this.tone(330, t, 1.6, 'sawtooth', 0.15, 55);
        this.noise(t, 1.2, 800, 0.15, 100);
        break;
      case 'drained':
        this.tone(160, t, 0.18, 'sawtooth', 0.18, 90);
        break;
      case 'leeched':
        this.tone(90, t, 0.12, 'sine', 0.35, 60);
        this.tone(90, t + 0.16, 0.1, 'sine', 0.25, 60);
        break;
      case 'grew':
        this.tone(262, t, 0.3, 'triangle', 0.12, 392);
        break;
      case 'click':
        this.tone(1500, t, 0.03, 'square', 0.06);
        break;
    }
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, freq: number, vol: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private createHum(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    const osc = [55, 55.6, 110.4].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain).connect(this.master!);
    this.hum = { gain, osc, filter };
  }
}
