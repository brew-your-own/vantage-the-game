import { Rng } from '../../core/rng';
import type { Mood } from './mood';
import { type Mode, type MusicIdentity, chordDegrees, degreeToMidi } from './theory';

export type Layer = 'pad' | 'bass' | 'arp' | 'motif' | 'perc' | 'tension';
export type Drum = 'kick' | 'hat' | 'riser';

/** One note. Times and lengths are in beats from the start of the bar. */
export interface NoteEvent {
  layer: Layer;
  at: number;
  len: number;
  /** MIDI note; absent for drums. */
  midi?: number;
  drum?: Drum;
  vel: number;
}

export interface Bar {
  bpm: number;
  mode: Mode;
  /** Chord root degree of this bar. */
  chord: number;
  events: NoteEvent[];
}

export const BEATS_PER_BAR = 4;
/** Most notes one bar may start, keeping the voice count in check. */
export const MAX_EVENTS_PER_BAR = 40;

/**
 * Composes one bar from the level's identity and the current mood. Pure and deterministic:
 * the same identity, bar index, mood and seed give the same notes.
 */
export function composeBar(id: MusicIdentity, bar: number, mood: Mood, seed = 0): Bar {
  const rng = new Rng((seed ^ Math.imul(bar + 1, 0x9e3779b1)) >>> 0);
  // Low energy darkens the mode; tempo sags when weak and pushes under the beam.
  const mode: Mode = mood.lowEnergy > 0.6 ? 'phrygian' : id.mode;
  const bpm = Math.round(id.bpm * (1 - 0.15 * mood.lowEnergy) * (1 + 0.12 * mood.exposure));
  // Progress walks further through the progression: early on, only its first half cycles.
  const span = Math.max(2, Math.round(id.progression.length * (0.5 + 0.5 * mood.progress)));
  const chord = id.progression[bar % span];
  const note = (degree: number, octave = 0) => degreeToMidi(id.root + 12 * octave, mode, degree);
  const events: NoteEvent[] = [];

  // Pad: always on. Brighter harmony (7th, 9th) with progress; open, higher voicing with altitude.
  const size = mood.progress > 0.66 ? 5 : mood.progress > 0.33 ? 4 : 3;
  const lift = mood.altitude > 0.6 ? 1 : 0;
  chordDegrees(chord, size).forEach((d, i) => {
    const open = lift && i % 2 === 1 ? 7 : 0;
    events.push({ layer: 'pad', at: 0, len: BEATS_PER_BAR, midi: note(d + open, 1 + lift), vel: 0.5 - 0.05 * i });
  });

  // Bass: a slow root when calm, a pulse otherwise; a heartbeat when energy runs low.
  const root = note(chord, 0);
  if (mood.lowEnergy > 0.5) {
    for (const b of [0, 2]) {
      events.push({ layer: 'bass', at: b, len: 0.2, midi: root, vel: 0.9 });
      events.push({ layer: 'bass', at: b + 0.3, len: 0.2, midi: root, vel: 0.6 });
    }
  } else if (mood.exposure > 0.6) {
    for (let b = 0; b < BEATS_PER_BAR; b += 0.5) events.push({ layer: 'bass', at: b, len: 0.35, midi: root, vel: b % 1 ? 0.5 : 0.8 });
  } else if (mood.calm > 0.7) {
    events.push({ layer: 'bass', at: 0, len: BEATS_PER_BAR, midi: root, vel: 0.6 });
  } else {
    for (let b = 0; b < BEATS_PER_BAR; b++) events.push({ layer: 'bass', at: b, len: 0.8, midi: root, vel: b === 0 ? 0.8 : 0.55 });
  }

  // Arpeggio: comes in with progress, busier as it grows; Moths make it high, staccato, stuttering.
  if (mood.progress > 0.15 || mood.threat > 0.3) {
    const step = mood.threat > 0.5 ? 0.25 : mood.progress > 0.5 ? 0.5 : 1;
    const tones = chordDegrees(chord, 4);
    const octave = mood.threat > 0.5 ? 3 : 2;
    let i = 0;
    for (let at = 0; at < BEATS_PER_BAR; at += step, i++) {
      if (mood.threat > 0.5 && rng.next() < 0.3) continue; // stutter
      const len = mood.threat > 0.5 ? 0.1 : step * 0.8;
      events.push({ layer: 'arp', at, len, midi: note(tones[i % tones.length], octave), vel: 0.35 + 0.2 * mood.progress });
    }
  }

  // Motif: the level's melody, over two bars, sparser when calm, never under the beam.
  const every = mood.calm > 0.7 ? 4 : 2;
  if (mood.exposure < 0.7 && bar % every < 2) {
    const half = (bar % 2) * 16;
    const shift = rng.next() < 0.25 ? rng.pick([-1, 1, 2]) : 0;
    for (const m of id.motif) {
      if (m.at < half || m.at >= half + 16) continue;
      events.push({
        layer: 'motif',
        at: (m.at - half) / 4,
        len: m.len / 4,
        midi: note(chord + m.degree + shift, 3 + lift),
        vel: 0.5,
      });
    }
  }

  // Percussion: mostly under pressure.
  const pressure = Math.max(mood.exposure, mood.threat);
  if (pressure > 0.3) {
    for (let b = 0; b < BEATS_PER_BAR; b += 2) events.push({ layer: 'perc', at: b, len: 0.3, drum: 'kick', vel: 0.5 + 0.4 * pressure });
    const hat = pressure > 0.7 ? 0.25 : 0.5;
    for (let at = hat; at < BEATS_PER_BAR; at += hat * 2) events.push({ layer: 'perc', at, len: 0.05, drum: 'hat', vel: 0.2 + 0.3 * pressure });
  }

  // Tension: a riser while the beam approaches, a dissonant cluster inside it.
  if (mood.exposure > 0.2 && mood.exposure < 0.9) {
    events.push({ layer: 'tension', at: 0, len: BEATS_PER_BAR, drum: 'riser', vel: mood.exposure });
  }
  if (mood.exposure >= 0.9) {
    const base = note(chord, 2);
    for (const semis of [0, 1, 6]) events.push({ layer: 'tension', at: 0, len: BEATS_PER_BAR, midi: base + semis, vel: 0.5 });
  }

  return { bpm, mode, chord, events: events.slice(0, MAX_EVENTS_PER_BAR) };
}

/** Short phrases for game events, in beats from the next beat. */
export type Stinger = 'relay' | 'dark' | 'transfer' | 'scatter' | 'swat' | 'win' | 'lose';

export function composeStinger(id: MusicIdentity, kind: Stinger, chord: number, mode: Mode): NoteEvent[] {
  const n = (degree: number, octave: number) => degreeToMidi(id.root + 12 * octave, mode, degree);
  const run = (degrees: number[], octave: number, step: number, layer: Layer = 'motif', len = step * 1.5) =>
    degrees.map((d, i) => ({ layer, at: i * step, len, midi: n(d, octave), vel: 0.6 }));
  switch (kind) {
    case 'relay':
      return run(chordDegrees(chord, 4), 3, 0.25, 'arp');
    case 'dark':
      return run([7, 4, 2, 0, -3], 3, 0.5, 'motif', 1.5);
    case 'transfer':
      return run([chord + 4, chord + 7], 3, 0.5);
    case 'scatter':
      return run([chord + 7, chord + 5, chord + 3, chord + 1], 3, 0.125, 'arp');
    case 'swat':
      return run([chord + 9], 3, 0.25, 'arp', 0.2);
    case 'win':
      // V – I cadence in the home mode, landing on a long tonic chord.
      return [
        ...chordDegrees(4, 4).map((d) => ({ layer: 'pad' as const, at: 0, len: 2, midi: n(d, 1), vel: 0.5 })),
        ...chordDegrees(0, 5).map((d) => ({ layer: 'pad' as const, at: 2, len: 8, midi: n(d, 1), vel: 0.55 })),
        ...run([0, 2, 4, 7], 3, 0.5, 'motif', 3).map((e) => ({ ...e, at: e.at + 2 })),
      ];
    case 'lose':
      return run([4, 3, 1, 0, -1, -3], 2, 0.75, 'motif', 1.5);
  }
}
