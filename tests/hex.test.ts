import { describe, expect, it } from 'vitest';
import { DIRECTIONS, HexGrid, SQRT3, cornerOffset, hexDistance, hexToWorld, worldToHex } from '../src/core/hex';

describe('hex math', () => {
  it('round-trips hex → world → hex', () => {
    for (let q = -6; q <= 6; q++)
      for (let r = -6; r <= 6; r++) {
        const w = hexToWorld(q, r, 1.3);
        expect(worldToHex(w.x, w.z, 1.3)).toEqual({ q, r });
      }
  });

  it('neighbours are one step away and at angle 60°·i', () => {
    DIRECTIONS.forEach((d, i) => {
      expect(hexDistance({ q: 0, r: 0 }, d)).toBe(1);
      const w = hexToWorld(d.q, d.r, 1);
      expect(Math.hypot(w.x, w.z)).toBeCloseTo(SQRT3);
      expect(Math.atan2(w.z, w.x)).toBeCloseTo(Math.atan2(Math.sin((i * Math.PI) / 3), Math.cos((i * Math.PI) / 3)));
    });
  });

  it('across edge i, my corner i is the neighbour corner i+4 and corner i+1 is its i+3', () => {
    for (let i = 0; i < 6; i++) {
      const n = hexToWorld(DIRECTIONS[i].q, DIRECTIONS[i].r, 1);
      const mine0 = cornerOffset(i, 1), theirs0 = cornerOffset(i + 4, 1);
      const mine1 = cornerOffset(i + 1, 1), theirs1 = cornerOffset(i + 3, 1);
      expect(mine0.x).toBeCloseTo(n.x + theirs0.x);
      expect(mine0.z).toBeCloseTo(n.z + theirs0.z);
      expect(mine1.x).toBeCloseTo(n.x + theirs1.x);
      expect(mine1.z).toBeCloseTo(n.z + theirs1.z);
    }
  });
});

describe('HexGrid', () => {
  it('has 3R(R+1)+1 cells and consistent lookups', () => {
    for (const R of [0, 1, 5, 14]) {
      const g = new HexGrid(R);
      expect(g.count).toBe(3 * R * (R + 1) + 1);
      g.cells.forEach((c, i) => expect(g.indexOf(c.q, c.r)).toBe(i));
    }
  });

  it('returns -1 outside the map', () => {
    const g = new HexGrid(3);
    expect(g.indexOf(4, 0)).toBe(-1);
    expect(g.indexOf(3, 1)).toBe(-1);
    expect(g.indexOf(100, -100)).toBe(-1);
  });

  it('neighbour relation is symmetric', () => {
    const g = new HexGrid(5);
    for (let i = 0; i < g.count; i++)
      for (let d = 0; d < 6; d++) {
        const j = g.neighbor(i, d);
        if (j >= 0) expect(g.neighbor(j, (d + 3) % 6)).toBe(i);
      }
  });
});
