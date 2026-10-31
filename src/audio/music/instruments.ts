import type { Drum, Layer } from './composer';
import { midiToFreq } from './theory';

/** Per-layer tone settings the mixer changes continuously (smoothed by the caller). */
export interface Timbre {
  /** Pad low-pass cutoff in Hz. */
  padCutoff: number;
}

export interface Voice {
  /** When the voice stops sounding (AudioContext time). */
  end: number;
}

let noise: AudioBuffer | null = null;
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A gain envelope: attack, hold until `release`, then fade. Returns the gain node. */
function envelope(ctx: BaseAudioContext, at: number, attack: number, peak: number, releaseAt: number, release: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  g.gain.setValueAtTime(Math.max(peak, 0.0002), Math.max(at + attack, releaseAt));
  g.gain.exponentialRampToValueAtTime(0.0001, Math.max(at + attack, releaseAt) + release);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, at: number, end: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(at);
  o.stop(end);
  return o;
}

/** Plays one note on a layer's instrument into `out`. `len` is in seconds. */
export function playNote(
  ctx: BaseAudioContext,
  out: AudioNode,
  layer: Layer,
  at: number,
  len: number,
  vel: number,
  timbre: Timbre,
  midi?: number,
  drum?: Drum,
): Voice {
  const f = midi !== undefined ? midiToFreq(midi) : 0;
  switch (layer) {
    case 'pad': {
      // Two detuned saws through a soft low-pass, slow attack and release.
      const end = at + len + 1.6;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = timbre.padCutoff;
      filter.Q.value = 0.4;
      const env = envelope(ctx, at, 0.7, 0.06 * vel, at + len, 1.4);
      for (const d of [-7, 7]) osc(ctx, 'sawtooth', f, at, end, d).connect(filter);
      filter.connect(env).connect(out);
      return { end };
    }
    case 'bass': {
      const end = at + len + 0.3;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      const env = envelope(ctx, at, 0.015, 0.35 * vel, at + Math.min(len, 0.1), Math.max(0.15, len));
      osc(ctx, 'triangle', f, at, end).connect(filter);
      osc(ctx, 'sine', f / 2, at, end).connect(filter);
      filter.connect(env).connect(out);
      return { end };
    }
    case 'arp': {
      // A soft pluck.
      const end = at + len + 0.4;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, at);
      filter.frequency.exponentialRampToValueAtTime(600, at + 0.3);
      const env = envelope(ctx, at, 0.005, 0.09 * vel, at + 0.01, Math.max(0.12, len));
      osc(ctx, 'square', f, at, end).connect(filter);
      filter.connect(env).connect(out);
      return { end };
    }
    case 'motif': {
      // An FM bell: the modulation index decays, so the tone mellows as it rings.
      const end = at + len + 1.5;
      const mod = osc(ctx, 'sine', f * 3.5, at, end);
      const index = ctx.createGain();
      index.gain.setValueAtTime(f * 2.2, at);
      index.gain.exponentialRampToValueAtTime(f * 0.05, at + 1.2);
      const carrier = osc(ctx, 'sine', f, at, end);
      mod.connect(index).connect(carrier.frequency);
      const env = envelope(ctx, at, 0.004, 0.12 * vel, at + 0.02, len + 1.2);
      carrier.connect(env).connect(out);
      return { end };
    }
    case 'tension': {
      const end = at + len + 0.8;
      if (drum === 'riser') {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 3;
        filter.frequency.setValueAtTime(300, at);
        filter.frequency.exponentialRampToValueAtTime(300 + 3000 * vel, at + len);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(0.05 + 0.1 * vel, at + len);
        env.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.3);
        src.connect(filter).connect(env).connect(out);
        src.start(at);
        src.stop(end);
        return { end };
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = f * 2;
      filter.Q.value = 1.5;
      const env = envelope(ctx, at, 0.4, 0.05 * vel, at + len, 0.6);
      osc(ctx, 'sawtooth', f, at, end, 0).connect(filter);
      osc(ctx, 'sawtooth', f, at, end, 18).connect(filter);
      filter.connect(env).connect(out);
      return { end };
    }
    case 'perc': {
      if (drum === 'kick') {
        const end = at + 0.4;
        const o = osc(ctx, 'sine', 120, at, end);
        o.frequency.setValueAtTime(120, at);
        o.frequency.exponentialRampToValueAtTime(40, at + 0.25);
        const env = envelope(ctx, at, 0.003, 0.5 * vel, at + 0.01, 0.3);
        o.connect(env).connect(out);
        return { end };
      }
      const end = at + 0.1;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      const env = envelope(ctx, at, 0.002, 0.12 * vel, at + 0.005, 0.05);
      src.connect(filter).connect(env).connect(out);
      src.start(at);
      src.stop(end);
      return { end };
    }
  }
}

/** A generated reverb impulse: decaying stereo noise. No audio files. */
export function createReverb(ctx: BaseAudioContext, seconds = 2.8): ConvolverNode {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}
