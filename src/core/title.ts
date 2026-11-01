import { HexGrid } from './hex';
import { fbm } from './noise';
import type { Terrain } from './terrain';

/** 5×7 bitmap letters for the title word ('#' = raised tile). */
export const FONT: Record<string, readonly string[]> = {
  V: ['#...#', '#...#', '#...#', '##.##', '.#.#.', '.###.', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};
const GLYPH_W = 5;
const GLYPH_H = 7;
const SPACING = 1;
/** Tiles per font pixel, each way: two keeps strokes straight despite the hex rows' offset. */
const SCALE = 2;

/** Terrain level of the letters and of the Keeper's hill. */
export const LETTER_LEVEL = 6;
export const KEEPER_LEVEL = 9;
/** Hex row of the word's top edge: the word sits a little in front of the map's centre. */
const TOP_ROW = -(GLYPH_H * SCALE) / 2 + 1;
/** The Keeper stands this many rows behind the word's top, centred. */
const KEEPER_GAP = 11;

export interface TitleLand {
  terrain: Terrain;
  /** Tiles that form the letters. */
  letters: number[];
  keeperCell: number;
}

/** Axial cell of tile (x, y) of the word, x across and y down, centred on x = 0. */
function wordCell(x: number, y: number, wordWidth: number): { q: number; r: number } {
  const r = TOP_ROW + y;
  // Offset rows: x = q + r/2 stays within half a tile of the column, so strokes stay upright.
  return { q: x - Math.floor(wordWidth / 2) - Math.floor(r / 2), r };
}

/**
 * The title screen's land: the word raised out of low, rolling ground, and a hill behind
 * it for the Keeper, whose beam sweeps across the letters. Pure and deterministic.
 */
export function titleLand(word = 'VANTAGE'): TitleLand {
  const glyphs = [...word].map((ch) => FONT[ch]);
  const wordWidth = (glyphs.length * (GLYPH_W + SPACING) - SPACING) * SCALE;
  // Wide enough for the word, with a margin, on its rows furthest from the centre.
  const lowestRow = TOP_ROW + GLYPH_H * SCALE - 1;
  const radius = Math.ceil((wordWidth + 6 + Math.max(-TOP_ROW, lowestRow)) / 2);
  const grid = new HexGrid(radius);
  const heights = new Uint8Array(grid.count);
  // Low ground: gentle noise, levels 0–2.
  grid.cells.forEach(({ q, r }, i) => {
    const v = fbm(q * 0.12 + 31.4, r * 0.12 - 7.7, 0x7171e);
    heights[i] = Math.max(0, Math.min(2, Math.round(v * 3)));
  });

  const letters: number[] = [];
  glyphs.forEach((glyph, g) => {
    for (let row = 0; row < GLYPH_H; row++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (glyph[row][c] !== '#') continue;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            const x = (g * (GLYPH_W + SPACING) + c) * SCALE + dx;
            const { q, r } = wordCell(x, row * SCALE + dy, wordWidth);
            const i = grid.indexOf(q, r);
            if (i < 0) throw new Error(`title letter off the map at (${q}, ${r})`);
            heights[i] = LETTER_LEVEL;
            letters.push(i);
          }
        }
      }
    }
  });

  // The Keeper's hill: a cone of terraces behind the word.
  const kr = TOP_ROW - KEEPER_GAP;
  const keeper = { q: -Math.floor(kr / 2), r: kr };
  grid.cells.forEach((c, i) => {
    const d = (Math.abs(c.q - keeper.q) + Math.abs(c.r - keeper.r) + Math.abs(c.q + c.r - keeper.q - keeper.r)) / 2;
    const hill = KEEPER_LEVEL - Math.ceil(d * 1.2);
    if (hill > heights[i]) heights[i] = hill;
  });
  const keeperCell = grid.indexOf(keeper.q, keeper.r);

  return {
    terrain: { params: { seed: 0, radius, maxHeight: KEEPER_LEVEL, maxStep: KEEPER_LEVEL }, grid, heights },
    letters,
    keeperCell,
  };
}
