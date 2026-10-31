import { describe, expect, it } from 'vitest';
import { MAX_EVENTS_PER_BAR, composeBar, composeStinger } from '../src/audio/music/composer';
import { type Mood, NEUTRAL_MOOD, moodOf, smoothMood } from '../src/audio/music/mood';
import { MODES, chordDegrees, degreeToMidi, identityFor } from '../src/audio/music/theory';
import { spawn, spawnMoth } from '../src/core/world';
import { arena, at } from './helpers/worlds';

const mood = (m: Partial<Mood>): Mood => ({ ...NEUTRAL_MOOD, ...m });
const layers = (m: Partial<Mood>, bar = 0) => new Set(composeBar(identityFor(7), bar, mood(m)).events.map((e) => e.layer));
const pitchClassesOf = (root: number, mode: keyof typeof MODES) => new Set(MODES[mode].map((s) => (root + s) % 12));

describe('theory', () => {
  it('maps scale degrees across octaves', () => {
    expect(degreeToMidi(60, 'ionian', 0)).toBe(60);
    expect(degreeToMidi(60, 'ionian', 2)).toBe(64);
    expect(degreeToMidi(60, 'aeolian', 2)).toBe(63);
    expect(degreeToMidi(60, 'ionian', 7)).toBe(72);
    expect(degreeToMidi(60, 'ionian', -1)).toBe(59);
    expect(chordDegrees(1, 4)).toEqual([1, 3, 5, 7]);
  });

  it('gives each level its own, stable musical identity', () => {
    expect(identityFor(42)).toEqual(identityFor(42));
    const ids = [1, 2, 3, 4, 5, 6, 7, 8].map(identityFor);
    expect(new Set(ids.map((i) => `${i.root}/${i.mode}/${i.bpm}`)).size).toBeGreaterThan(4);
    for (const id of ids) {
      expect(id.bpm).toBeGreaterThanOrEqual(60);
      expect(id.bpm).toBeLessThanOrEqual(90);
      expect(id.progression[0]).toBe(0);
      expect([4, 6, 8]).toContain(id.progression.length);
      expect(id.motif.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('composer', () => {
  it('is deterministic', () => {
    const m = mood({ progress: 0.5, threat: 0.6 });
    expect(composeBar(identityFor(3), 5, m, 9)).toEqual(composeBar(identityFor(3), 5, m, 9));
  });

  it('keeps calm music sparse: pad, bass and the occasional motif', () => {
    expect(layers({}, 0)).toEqual(new Set(['pad', 'bass', 'motif']));
    expect(layers({}, 2)).toEqual(new Set(['pad', 'bass']));
  });

  it('adds percussion and a dissonant cluster in the beam, and drops the motif', () => {
    const bar = composeBar(identityFor(7), 0, mood({ exposure: 1, calm: 0 }));
    const l = new Set(bar.events.map((e) => e.layer));
    expect(l.has('perc')).toBe(true);
    expect(l.has('tension')).toBe(true);
    expect(l.has('motif')).toBe(false);
    expect(bar.bpm).toBeGreaterThan(identityFor(7).bpm);
  });

  it('a riser while the beam approaches', () => {
    const bar = composeBar(identityFor(7), 0, mood({ exposure: 0.5, calm: 0.5 }));
    expect(bar.events.some((e) => e.drum === 'riser')).toBe(true);
  });

  it('low energy turns phrygian, slower, with a heartbeat', () => {
    const id = identityFor(7);
    const bar = composeBar(id, 0, mood({ lowEnergy: 1, calm: 0 }));
    expect(bar.mode).toBe('phrygian');
    expect(bar.bpm).toBeLessThan(id.bpm);
    const bass = bar.events.filter((e) => e.layer === 'bass');
    expect(bass.map((e) => e.at)).toEqual([0, 0.3, 2, 2.3]);
  });

  it('brings in the arpeggio with progress and richer chords', () => {
    expect(layers({ progress: 0 }).has('arp')).toBe(false);
    expect(layers({ progress: 0.5 }).has('arp')).toBe(true);
    const pads = (p: number) => composeBar(identityFor(7), 0, mood({ progress: p })).events.filter((e) => e.layer === 'pad').length;
    expect(pads(0)).toBe(3);
    expect(pads(1)).toBe(5);
  });

  it('stays in the scale (apart from the tension cluster) and under the voice cap', () => {
    const id = identityFor(11);
    for (const m of [mood({}), mood({ progress: 1, threat: 1, exposure: 0.5, altitude: 1 }), mood({ lowEnergy: 1, exposure: 1 })]) {
      for (let b = 0; b < 8; b++) {
        const bar = composeBar(id, b, m, b);
        expect(bar.events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_BAR);
        const pcs = pitchClassesOf(id.root, bar.mode);
        for (const e of bar.events) {
          expect(e.at).toBeGreaterThanOrEqual(0);
          expect(e.at).toBeLessThan(4);
          if (e.midi !== undefined && e.layer !== 'tension') expect(pcs.has(e.midi % 12)).toBe(true);
        }
      }
    }
  });

  it('has a stinger for every event, the win ending on the tonic', () => {
    const id = identityFor(5);
    for (const k of ['relay', 'dark', 'transfer', 'scatter', 'swat', 'win', 'lose'] as const) {
      expect(composeStinger(id, k, 0, id.mode).length).toBeGreaterThan(0);
    }
    const win = composeStinger(id, 'win', 0, id.mode);
    const last = win.filter((e) => e.layer === 'pad' && e.at === 2);
    expect(last.some((e) => e.midi! % 12 === id.root % 12)).toBe(true);
  });
});

describe('mood', () => {
  it('reads the beam, energy, Moths and progress from the world', () => {
    const lit = arena(2);
    const m = moodOf(lit);
    expect(m.exposure).toBe(1);
    expect(m.lowEnergy).toBe(1);
    expect(m.calm).toBe(0);

    const safe = arena(20, Math.PI);
    for (let i = 0; i < 4; i++) spawn(safe, at(safe, 2, 0), 'shard'); // shade the player
    expect(moodOf(safe).exposure).toBe(0);
    expect(moodOf(safe).lowEnergy).toBe(0);
    spawnMoth(safe, safe.player.cell, 1);
    expect(moodOf(safe).threat).toBe(1);

    safe.relays.push({ cell: at(safe, -3, 0), drained: true }, { cell: at(safe, 0, -3), drained: false });
    expect(moodOf(safe).progress).toBe(0.5);
  });

  it('smooths changes: danger rises fast and fades slowly', () => {
    const up = smoothMood(NEUTRAL_MOOD, mood({ exposure: 1 }), 0.25);
    expect(up.exposure).toBeGreaterThan(0.6);
    const down = smoothMood(mood({ exposure: 1 }), NEUTRAL_MOOD, 0.25);
    expect(down.exposure).toBeGreaterThan(0.9);
  });
});
