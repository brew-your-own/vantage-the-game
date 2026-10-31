import { hashString } from '../core/rng';

/** Colours of a level: land, sky and light. Plain numbers so it is testable without WebGL. */
export interface LevelPalette {
  name: string;
  tops: [number, number, number];
  flat: number;
  slope: number;
  skirt: number;
  sky: number;
  stars: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
}

export const PALETTES: readonly LevelPalette[] = [
  {
    name: 'meadow',
    tops: [0x3f8f4a, 0x4c9e55, 0x357d40], flat: 0x2f6e38, slope: 0x8a6a3c, skirt: 0x4a3a28,
    sky: 0x05060f, stars: 0xbfc8ff, hemiSky: 0xc8d8ff, hemiGround: 0x302018, sun: 0xfff2dd,
  },
  {
    name: 'dune',
    tops: [0xc9a35a, 0xd6b46a, 0xb8914c], flat: 0xa8833f, slope: 0x7a4f2a, skirt: 0x4f3220,
    sky: 0x120812, stars: 0xffd8b0, hemiSky: 0xffe0c0, hemiGround: 0x3a2014, sun: 0xffd9a0,
  },
  {
    name: 'tundra',
    tops: [0xc8d6e0, 0xd8e4ec, 0xb4c4d0], flat: 0x9fb2c0, slope: 0x5a6a7c, skirt: 0x33404f,
    sky: 0x020812, stars: 0xd0f0ff, hemiSky: 0xd0e8ff, hemiGround: 0x202838, sun: 0xe8f4ff,
  },
  {
    name: 'ember',
    tops: [0x5a3a3a, 0x6a4442, 0x4c3030], flat: 0x402828, slope: 0xc0502a, skirt: 0x301818,
    sky: 0x0f0303, stars: 0xffb090, hemiSky: 0xffc0a0, hemiGround: 0x401008, sun: 0xffa070,
  },
  {
    name: 'lichen',
    tops: [0x6a8a3a, 0x7a9a44, 0x5a7a30], flat: 0x4e6a2c, slope: 0x5a5a6a, skirt: 0x34343f,
    sky: 0x060a04, stars: 0xe0ffc0, hemiSky: 0xe0f0c8, hemiGround: 0x283018, sun: 0xf0ffd0,
  },
  {
    name: 'violet',
    tops: [0x6a4f9a, 0x7a5caa, 0x5a428a], flat: 0x4c3a78, slope: 0x2f8a8a, skirt: 0x2a2048,
    sky: 0x07030f, stars: 0xe0c8ff, hemiSky: 0xe0d0ff, hemiGround: 0x201030, sun: 0xf0e0ff,
  },
  {
    name: 'reef',
    tops: [0x2f8a7a, 0x3a9a88, 0x267a6c], flat: 0x206a5e, slope: 0xd08a6a, skirt: 0x3a2a30,
    sky: 0x020a0e, stars: 0xc0fff0, hemiSky: 0xc8fff0, hemiGround: 0x102828, sun: 0xfff0e0,
  },
  {
    name: 'slate',
    tops: [0x6a707a, 0x787e88, 0x5c626c], flat: 0x50565f, slope: 0x9a7a4a, skirt: 0x2c2f36,
    sky: 0x040406, stars: 0xf0f0f0, hemiSky: 0xe8e8f0, hemiGround: 0x282420, sun: 0xfff8f0,
  },
];

/** The palette for a level code: always the same for a code, spread over the set. */
export function paletteFor(code: number): LevelPalette {
  return PALETTES[hashString(`palette:${code}`) % PALETTES.length];
}
