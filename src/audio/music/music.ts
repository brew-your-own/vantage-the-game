import { BEATS_PER_BAR, type Layer, type NoteEvent, type Stinger, composeBar, composeStinger } from './composer';
import { type Timbre, type Voice, createReverb, playNote } from './instruments';
import { type Mood, NEUTRAL_MOOD } from './mood';
import { type Mode, type MusicIdentity, identityFor } from './theory';

const LOOKAHEAD = 0.3; // seconds of music scheduled ahead of the audio clock
const TICK_MS = 25;
const MAX_VOICES = 32;
const LAYERS: Layer[] = ['pad', 'bass', 'arp', 'motif', 'perc', 'tension'];
/** Base level of each layer, and how much of it goes to the reverb. */
const MIX: Record<Layer, { gain: number; send: number }> = {
  pad: { gain: 0.9, send: 0.5 },
  bass: { gain: 0.8, send: 0.1 },
  arp: { gain: 0.6, send: 0.35 },
  motif: { gain: 0.7, send: 0.6 },
  perc: { gain: 0.6, send: 0.15 },
  tension: { gain: 0.7, send: 0.4 },
};
const VOLUME = 0.55;

/**
 * Adaptive music: composes a bar at a time from the level's identity and the latest mood,
 * and schedules it slightly ahead on the audio clock so timing holds when frames drop.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers = {} as Record<Layer, { dry: GainNode; send: GainNode }>;
  private reverb: GainNode | null = null;
  private id: MusicIdentity = identityFor(1);
  private seed = 1;
  private bar = 0;
  private barStart = 0;
  private nextBar = 0;
  private bpm = 72;
  private chord = 0;
  private mode: Mode = 'dorian';
  private mood: Mood = NEUTRAL_MOOD;
  private timbre: Timbre = { padCutoff: 700 };
  private voices: Voice[] = [];
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _enabled = true;
  private quiet = false;

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(on: boolean) {
    this._enabled = on;
    this.applyVolume();
  }

  get attached(): boolean {
    return this.ctx !== null;
  }

  /** Connects to the shared audio context; `out` is the game's master bus. */
  attach(ctx: AudioContext, out: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(out);
    const conv = createReverb(ctx);
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.5;
    conv.connect(this.reverb).connect(this.master);
    for (const l of LAYERS) {
      const dry = ctx.createGain();
      dry.gain.value = MIX[l].gain;
      const send = ctx.createGain();
      send.gain.value = MIX[l].send;
      dry.connect(this.master);
      dry.connect(send).connect(conv);
      this.layers[l] = { dry, send };
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Starts a level's music from its first bar. */
  start(code: number): void {
    this.id = identityFor(code);
    this.seed = code;
    this.bar = 0;
    this.mode = this.id.mode;
    this.chord = 0;
    this.bpm = this.id.bpm;
    this.running = true;
    if (!this.ctx) return;
    this.barStart = this.nextBar = this.ctx.currentTime + 0.1;
    this.applyVolume(0.5);
  }

  /** Called every frame with the smoothed mood. `quiet` lowers the music (menu, pause). */
  update(mood: Mood, quiet: boolean): void {
    this.mood = mood;
    if (quiet !== this.quiet) {
      this.quiet = quiet;
      this.applyVolume();
    }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Continuous changes, independent of bar boundaries.
    this.timbre.padCutoff = 500 + 1600 * mood.progress + 900 * mood.altitude + 600 * mood.exposure;
    this.reverb?.gain.setTargetAtTime(0.35 + 0.5 * mood.altitude, t, 0.5);
    this.layers.tension?.dry.gain.setTargetAtTime(MIX.tension.gain * (0.4 + 0.6 * mood.exposure), t, 0.2);
    this.layers.perc?.dry.gain.setTargetAtTime(MIX.perc.gain * (0.5 + 0.5 * Math.max(mood.exposure, mood.threat)), t, 0.3);
    this.layers.pad?.dry.gain.setTargetAtTime(MIX.pad.gain * (1 - 0.35 * mood.exposure), t, 0.4);
  }

  /** A short phrase for a game event, on the next beat. Win and lose end the level's music. */
  stinger(kind: Stinger): void {
    if (!this.ctx || !this.running) return;
    const spb = 60 / this.bpm;
    const now = this.ctx.currentTime;
    const beat = this.barStart + Math.ceil((now + 0.05 - this.barStart) / spb) * spb;
    const mode = kind === 'win' ? this.id.mode : this.mode;
    this.schedule(composeStinger(this.id, kind, this.chord, mode), beat, spb, true);
    if (kind === 'win' || kind === 'lose') {
      this.running = false;
      // Let the cadence or the wind-down ring, then fade.
      const fadeAt = beat + (kind === 'win' ? 10 : 6) * spb;
      this.master!.gain.setTargetAtTime(0, fadeAt, 1.2);
    }
  }

  /** Stops scheduling for good (e.g. on hot reload). */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  private applyVolume(tau = 0.6): void {
    if (!this.ctx || !this.master) return;
    const v = this._enabled ? VOLUME * (this.quiet ? 0.45 : 1) : 0;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, tau);
  }

  private tick(): void {
    if (!this.ctx || !this.running || !this._enabled) {
      // Keep the clock moving so a re-enabled track starts in time.
      if (this.ctx && this.nextBar < this.ctx.currentTime) this.barStart = this.nextBar = this.ctx.currentTime + 0.1;
      return;
    }
    const now = this.ctx.currentTime;
    if (this.nextBar < now - 0.5) this.barStart = this.nextBar = now + 0.05; // after a stall
    while (this.nextBar < now + LOOKAHEAD) {
      const bar = composeBar(this.id, this.bar, this.mood, this.seed);
      const spb = 60 / bar.bpm;
      this.bpm = bar.bpm;
      this.chord = bar.chord;
      this.mode = bar.mode;
      this.barStart = this.nextBar;
      this.schedule(bar.events, this.nextBar, spb, false);
      this.nextBar += BEATS_PER_BAR * spb;
      this.bar++;
    }
  }

  private schedule(events: NoteEvent[], start: number, spb: number, force: boolean): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    for (const e of events) {
      const sustained = e.layer === 'pad' || e.layer === 'tension';
      if (!force && !sustained && this.voices.length >= MAX_VOICES) continue;
      const voice = playNote(ctx, this.layers[e.layer].dry, e.layer, start + e.at * spb, e.len * spb, e.vel, this.timbre, e.midi, e.drum);
      this.voices.push(voice);
    }
  }
}
