import { describe, expect, it } from 'vitest';
import { LETTER_LEVEL, titleLand } from '../src/core/title';
import { INTRO, beamSpin, introFrame, introPlan, keeperForm, waveIn } from '../src/core/titleIntro';

describe('the title opening', () => {
  const land = titleLand();
  const plan = introPlan(land);
  const n = plan.cells.length;
  const frame = (t: number, wave = 1) => {
    const h = new Float32Array(n);
    const g = new Float32Array(n);
    const r = new Float32Array(n);
    introFrame(plan, t, wave, h, g, r);
    return { h, g, r };
  };

  it('keeps the ground as it was under the word and the hill', () => {
    const raised = new Set([...land.letters, ...land.hill]);
    land.ground.forEach((g, i) => {
      expect(g).toBeLessThanOrEqual(2);
      if (!raised.has(i)) expect(land.terrain.heights[i]).toBe(g);
    });
  });

  it('moves every letter and hill tile', () => {
    const cells = new Set(plan.cells);
    for (const i of [...land.letters, ...land.hill]) expect(cells.has(i)).toBe(true);
  });

  it('starts from flat ground, with no Keeper and no beam', () => {
    const { h, r } = frame(0);
    plan.cells.forEach((c, j) => expect(h[j]).toBeCloseTo(land.ground[c]));
    for (const i of [...land.letters, ...land.hill]) expect(r[plan.cells.indexOf(i)]).toBe(0);
    expect(keeperForm(0)).toBe(0);
    expect(beamSpin(plan, 0)).toBe(0);
  });

  it('raises the hill before the Keeper forms, and the word after', () => {
    const { h } = frame(INTRO.keeperStart);
    plan.cells.forEach((c, j) => {
      if (land.hill.includes(c)) expect(h[j]).toBeCloseTo(land.terrain.heights[c], 1);
    });
    expect(INTRO.lettersStart).toBeGreaterThan(INTRO.keeperStart);
  });

  it('stands the whole land at its final heights once the word is up, without the wave', () => {
    const { h, g, r } = frame(plan.lettersEnd, 0);
    plan.cells.forEach((c, j) => expect(h[j]).toBeCloseTo(land.terrain.heights[c], 3));
    expect(Math.min(...r)).toBe(1);
    expect(Math.max(...g)).toBeCloseTo(0);
  });

  it('turns the beam before the wave starts, and the wave only ever lifts letters', () => {
    const t = plan.lettersEnd + INTRO.beamDelay + 0.3;
    expect(beamSpin(plan, t)).toBeGreaterThan(0);
    expect(waveIn(plan, t)).toBe(0);
    const letters = new Set(land.letters);
    for (let s = 0; s < 8; s += 0.37) {
      const { h } = frame(plan.lettersEnd + 3 + s);
      plan.cells.forEach((c, j) => {
        if (letters.has(c)) expect(h[j]).toBeGreaterThanOrEqual(LETTER_LEVEL - 1e-4);
      });
    }
  });
});
