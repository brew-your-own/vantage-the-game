import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../src/core/levels';
import { PALETTES, paletteFor } from '../src/render/palettes';

describe('level palettes', () => {
  it('are stable per level code and varied across the campaign', () => {
    expect(paletteFor(42)).toBe(paletteFor(42));
    const used = new Set(CAMPAIGN.map((s) => paletteFor(s.code).name));
    expect(used.size).toBeGreaterThanOrEqual(5);
  });

  it('have distinct names and valid colours', () => {
    expect(new Set(PALETTES.map((p) => p.name)).size).toBe(PALETTES.length);
    for (const p of PALETTES) {
      for (const c of [...p.tops, p.flat, p.slope, p.skirt, p.sky, p.stars, p.hemiSky, p.hemiGround, p.sun]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});
