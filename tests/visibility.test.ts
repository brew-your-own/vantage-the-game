import { describe, expect, it } from 'vitest';
import { LEVEL_HEIGHT } from '../src/core/constants';
import { HexGrid } from '../src/core/hex';
import { pickStartCell } from '../src/core/level';
import { Rng } from '../src/core/rng';
import { cellTop, sampleSurface } from '../src/core/surface';
import { DEFAULT_TERRAIN, type Terrain, generateTerrain } from '../src/core/terrain';
import { canSeeCell, castRay, eyeAt, visibleCells } from '../src/core/visibility';
import { BASE_Y, buildTerrainGeometry } from '../src/render/terrainMesh';

/** Terrain with heights from a function of the cell. */
function makeTerrain(radius: number, height: (q: number, r: number) => number): Terrain {
  const grid = new HexGrid(radius);
  const heights = new Uint8Array(grid.cells.map((c) => height(c.q, c.r)));
  return { grid, heights, params: { seed: 0, radius, maxHeight: 12, maxStep: 12 } };
}

describe('sampleSurface', () => {
  it('matches the rendered mesh everywhere', () => {
    for (const seed of [3, 42, 777]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const pos = buildTerrainGeometry(terrain).getAttribute('position').array as Float32Array;
      const rng = new Rng(seed);
      let checked = 0;
      for (let t = 0; t < pos.length; t += 9) {
        const ys = [pos[t + 1], pos[t + 4], pos[t + 7]];
        if (ys.some((y) => y === BASE_Y)) continue; // skirt / underside
        if (rng.next() > 0.2) continue; // sample a subset for speed
        let a = rng.next(), b = rng.next();
        if (a + b > 1) [a, b] = [1 - a, 1 - b];
        const c = 1 - a - b;
        const x = a * pos[t] + b * pos[t + 3] + c * pos[t + 6];
        const y = a * ys[0] + b * ys[1] + c * ys[2];
        const z = a * pos[t + 2] + b * pos[t + 5] + c * pos[t + 8];
        const s = sampleSurface(terrain, x, z);
        expect(s).not.toBeNull();
        expect(s!.y).toBeCloseTo(y, 4);
        checked++;
      }
      expect(checked).toBeGreaterThan(1000);
    }
  });

  it('classifies tops, flat bevels and slopes', () => {
    const t = makeTerrain(2, (q) => (q > 0 ? 2 : 0));
    const top = cellTop(t, t.grid.indexOf(0, 0));
    expect(sampleSurface(t, top.x, top.z)!.region).toBe('top');
    // Toward the east (edge 0) the neighbour (1,0) is higher: slope.
    expect(sampleSurface(t, top.x + 0.8, top.z)!.region).toBe('slope');
    // Toward the west (edge 3) the neighbour (-1,0) is level: flat bevel.
    expect(sampleSurface(t, top.x - 0.8, top.z)!.region).toBe('flat');
  });

  it('returns null outside the map', () => {
    expect(sampleSurface(makeTerrain(2, () => 0), 100, 0)).toBeNull();
  });
});

describe('line of sight', () => {
  it('sees every tile on flat ground', () => {
    const t = makeTerrain(5, () => 1);
    const vis = visibleCells(t, eyeAt(t, t.grid.indexOf(0, 0)));
    expect([...vis].every((v) => v === 1)).toBe(true);
  });

  it('a wall hides what is behind it', () => {
    // Ridge at q = 1, level 6; viewer at q = 0 (level 0); target at q = 3.
    const t = makeTerrain(5, (q) => (q === 1 ? 6 : 0));
    const eye = eyeAt(t, t.grid.indexOf(0, 0));
    expect(canSeeCell(t, eye, t.grid.indexOf(3, 0))).toBe(false);
    expect(canSeeCell(t, eye, t.grid.indexOf(-3, 0))).toBe(true);
  });

  it('cannot see the top of a higher tile from below, but can from above', () => {
    const t = makeTerrain(4, (q) => (q >= 2 ? 6 : 0));
    const low = t.grid.indexOf(-2, 0);
    const foot = t.grid.indexOf(1, 0);
    const edge = t.grid.indexOf(2, 0);
    const back = t.grid.indexOf(4, 0);
    expect(canSeeCell(t, eyeAt(t, low), edge)).toBe(false);
    expect(canSeeCell(t, eyeAt(t, edge), low)).toBe(true);
    // Standing back from the cliff edge, the tile at its foot is hidden.
    expect(canSeeCell(t, eyeAt(t, back), foot)).toBe(false);
  });

  it('can always see its own tile', () => {
    const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 5 });
    for (const cell of [0, 100, 300]) expect(canSeeCell(terrain, eyeAt(terrain, cell), cell)).toBe(true);
  });
});

describe('castRay', () => {
  it('looking straight down hits the tile below', () => {
    const t = makeTerrain(3, () => 2);
    const cell = t.grid.indexOf(1, -1);
    const eye = eyeAt(t, cell);
    const hit = castRay(t, eye, { x: 0, y: -1, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.surface.cell).toBe(cell);
    expect(hit!.point.y).toBeCloseTo(2 * LEVEL_HEIGHT, 4);
  });

  it('misses when looking up', () => {
    const t = makeTerrain(3, () => 0);
    expect(castRay(t, eyeAt(t, 0), { x: 0, y: 1, z: 0 })).toBeNull();
  });
});

describe('pickStartCell', () => {
  it('is deterministic and low', () => {
    const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 11 });
    const a = pickStartCell(terrain, 11);
    expect(pickStartCell(terrain, 11)).toBe(a);
    const sorted = [...terrain.heights].sort((x, y) => x - y);
    expect(terrain.heights[a]).toBeLessThanOrEqual(sorted[Math.floor(sorted.length / 4)]);
  });
});
