import { describe, expect, it } from 'vitest';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { buildTerrainGeometry } from '../src/render/terrainMesh';

const SEEDS = [1, 2, 3, 42, 1234, 99999, 424242];

describe('generateTerrain', () => {
  it('is deterministic per seed', () => {
    for (const seed of SEEDS) {
      const a = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const b = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      expect(a.heights).toEqual(b.heights);
    }
  });

  it('differs across seeds', () => {
    const a = generateTerrain({ ...DEFAULT_TERRAIN, seed: 1 });
    const b = generateTerrain({ ...DEFAULT_TERRAIN, seed: 2 });
    expect(a.heights).not.toEqual(b.heights);
  });

  for (const seed of SEEDS) {
    it(`respects invariants (seed ${seed})`, () => {
      const t = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const { grid, heights, params } = t;
      expect(heights.length).toBe(grid.count);

      const levels = new Set<number>();
      for (let i = 0; i < grid.count; i++) {
        expect(heights[i]).toBeLessThanOrEqual(params.maxHeight);
        levels.add(heights[i]);
        for (let d = 0; d < 6; d++) {
          const j = grid.neighbor(i, d);
          if (j >= 0) expect(Math.abs(heights[i] - heights[j])).toBeLessThanOrEqual(params.maxStep);
        }
      }
      // Enough relief to be interesting.
      expect(levels.size).toBeGreaterThanOrEqual(5);
    });
  }
});

describe('buildTerrainGeometry', () => {
  it('produces a finite, non-empty triangle soup', () => {
    const geo = buildTerrainGeometry(generateTerrain({ ...DEFAULT_TERRAIN, seed: 7 }));
    const pos = geo.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    expect(pos.count % 3).toBe(0);
    expect(geo.getAttribute('color').count).toBe(pos.count);
    for (const v of pos.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
  });
});
