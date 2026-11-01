import { describe, expect, it } from 'vitest';
import { FONT, KEEPER_LEVEL, LETTER_LEVEL, titleLand } from '../src/core/title';
import { createWorld } from '../src/core/world';

describe('the title land', () => {
  const land = titleLand();

  it('raises the letters of the word above the ground around them', () => {
    const pixels = [...'VANTAGE'].reduce((n, ch) => n + FONT[ch].join('').split('#').length - 1, 0);
    expect(land.letters.length).toBe(pixels * 4);
    for (const i of land.letters) expect(land.terrain.heights[i]).toBeGreaterThanOrEqual(LETTER_LEVEL);
    const ground = land.terrain.heights.filter((_, i) => !land.letters.includes(i));
    expect(Math.min(...ground)).toBeLessThan(LETTER_LEVEL);
  });

  it('puts the Keeper on the highest tile, behind the word', () => {
    const { terrain, keeperCell } = land;
    expect(terrain.heights[keeperCell]).toBe(KEEPER_LEVEL);
    expect(Math.max(...terrain.heights)).toBe(KEEPER_LEVEL);
    const rows = land.letters.map((i) => terrain.grid.cells[i].r);
    expect(terrain.grid.cells[keeperCell].r).toBeLessThan(Math.min(...rows));
  });

  it('can host a world with the Keeper where the title wants it', () => {
    const w = createWorld(land.terrain, 1, { relays: 0, keeperCell: land.keeperCell });
    expect(w.keeper.cell).toBe(land.keeperCell);
  });
});
