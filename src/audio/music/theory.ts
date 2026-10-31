import { Rng, hashString } from '../../core/rng';

/** Semitone steps of each mode, from its tonic. */
export const MODES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;
export type Mode = keyof typeof MODES;

/** MIDI note of a scale degree (0-based, may be negative or above 6) in a mode. */
export function degreeToMidi(root: number, mode: Mode, degree: number): number {
  const steps = MODES[mode];
  const octave = Math.floor(degree / 7);
  const d = ((degree % 7) + 7) % 7;
  return root + 12 * octave + steps[d];
}

/** Scale degrees of a chord built in thirds on `degree`: triad, or with a 7th / 9th. */
export function chordDegrees(degree: number, size: 3 | 4 | 5 = 3): number[] {
  return Array.from({ length: size }, (_, i) => degree + 2 * i);
}

export const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** A short melodic figure: positions in 16ths within two bars, degrees relative to the chord root. */
export interface MotifNote {
  at: number;
  degree: number;
  len: number;
}

/** Everything that makes a level's music its own. Same level code, same music. */
export interface MusicIdentity {
  /** MIDI note of the tonic in the bass register. */
  root: number;
  mode: Mode;
  bpm: number;
  /** Chord roots as scale degrees, one per bar. Starts on the tonic. */
  progression: number[];
  motif: MotifNote[];
}

const HOME_MODES: Mode[] = ['dorian', 'aeolian', 'mixolydian', 'lydian', 'dorian', 'aeolian'];
/** Chord-root moves that sound good in modal ambient music. */
const MOVES = [3, 5, 4, 6, 2, 1];

export function identityFor(code: number): MusicIdentity {
  const rng = new Rng(hashString(`music:${code}`));
  const root = 36 + rng.int(0, 11); // C2..B2
  const mode = rng.pick(HOME_MODES);
  const bpm = 60 + rng.int(0, 30);
  const length = rng.pick([4, 4, 6, 8]);
  const progression = [0];
  while (progression.length < length) {
    const prev = progression[progression.length - 1];
    let next = rng.pick(MOVES);
    if (next === prev) next = 0;
    progression.push(next);
  }
  // A motif of 4–6 notes over two bars, mostly stepwise, starting on a chord tone.
  const count = 4 + rng.int(0, 2);
  const slots = new Set<number>();
  while (slots.size < count) slots.add(rng.int(0, 7) * 4 + (rng.next() < 0.3 ? 2 : 0));
  let degree = rng.pick([0, 2, 4]);
  const motif = [...slots]
    .sort((a, b) => a - b)
    .map((at) => {
      const note = { at, degree, len: rng.pick([2, 4, 4, 6]) };
      degree += rng.pick([-2, -1, -1, 1, 1, 2]);
      degree = Math.max(-2, Math.min(9, degree));
      return note;
    });
  return { root, mode, bpm, progression, motif };
}
