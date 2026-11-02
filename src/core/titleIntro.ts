import { hexDistance } from './hex';
import type { TitleLand } from './title';

/**
 * The title screen's opening, in seconds from when it appears: the Keeper's hill heaves up
 * out of flat ground, the Keeper materialises on top (a shockwave rolls out from it), the
 * word grows out of the ground letter by letter, the beam starts to turn, and then a wave
 * keeps running through the word. Pure: heights and glow are a function of time.
 */
export const INTRO = {
  /** The hill starts to rise; inner rings lead, each ring this much behind the last. */
  hillStart: 0.5,
  hillRise: 1.9,
  hillRing: 0.06,
  /** A column of light falls on the summit and the Keeper forms in it. */
  keeperStart: 2.9,
  keeperForm: 0.9,
  /** The shockwave leaves the summit as the Keeper lands; tiles per second, and life. */
  shockDelay: 0.35,
  shockSpeed: 17,
  shockLife: 1.6,
  shockAmp: 0.9,
  /** Letters: the sweep runs left to right (and a little top to bottom), each tile rising for `letterRise`. */
  lettersStart: 3.9,
  letterSweep: 2.0,
  letterRows: 0.25,
  letterRise: 0.75,
  /** After the word is up: the beam spins up, then the wave fades in. */
  beamDelay: 0.15,
  beamRamp: 1.6,
  waveDelay: 0.7,
  waveRamp: 1.5,
};

/** The running wave through the word (tunable from the dev console: __vantage.titleWave). */
export const WAVE = {
  /** Seconds between crests. */
  period: 3.6,
  /** Height of a crest, in terrain levels, and its half-width in tiles. */
  amp: 1.6,
  width: 5,
  /** A low swell under the crest, so the word never sits quite still. */
  swell: 0.22,
  /** How much a crest's tiles brighten. */
  glow: 0.75,
};

/** Tiles of ground the shockwave reaches; it has died out by then. */
const SHOCK_REACH = Math.ceil(INTRO.shockSpeed * INTRO.shockLife) + 1;

const HILL = 1;
const LETTER = 2;

export interface IntroPlan {
  /** Tiles that move during the intro, and per tile (same order): */
  cells: number[];
  kind: Uint8Array;
  from: Float32Array;
  to: Float32Array;
  /** Seconds after its phase starts that a tile begins to rise. */
  delay: Float32Array;
  /** Tiles from the Keeper (the shockwave's distance). */
  dist: Float32Array;
  /** Letters: position across the word in tiles (from its left edge), and row from its top. */
  across: Float32Array;
  row: Float32Array;
  /** Word width in tiles. */
  span: number;
  /** When the word is fully up. */
  lettersEnd: number;
}

export function introPlan(land: TitleLand): IntroPlan {
  const { grid, heights } = land.terrain;
  const k = grid.cells[land.keeperCell];
  const letters = new Set(land.letters);
  const hill = new Set(land.hill);
  const cells: number[] = [];
  grid.cells.forEach((c, i) => {
    if (letters.has(i) || hill.has(i) || hexDistance(c, k) <= SHOCK_REACH) cells.push(i);
  });
  const n = cells.length;
  const plan: IntroPlan = {
    cells,
    kind: new Uint8Array(n),
    from: new Float32Array(n),
    to: new Float32Array(n),
    delay: new Float32Array(n),
    dist: new Float32Array(n),
    across: new Float32Array(n),
    row: new Float32Array(n),
    span: 1,
    lettersEnd: 0,
  };
  // Word extent: x = q + r/2 runs across the word in tile units.
  const xs = land.letters.map((i) => grid.cells[i].q + grid.cells[i].r / 2);
  const rs = land.letters.map((i) => grid.cells[i].r);
  const x0 = Math.min(...xs);
  const r0 = Math.min(...rs);
  plan.span = Math.max(...xs) - x0 || 1;
  const rowSpan = Math.max(...rs) - r0 || 1;
  cells.forEach((i, j) => {
    const c = grid.cells[i];
    plan.from[j] = land.ground[i];
    plan.to[j] = heights[i];
    plan.dist[j] = hexDistance(c, k);
    if (hill.has(i)) {
      plan.kind[j] = HILL;
      plan.delay[j] = plan.dist[j] * INTRO.hillRing;
    } else if (letters.has(i)) {
      plan.kind[j] = LETTER;
      plan.across[j] = c.q + c.r / 2 - x0;
      plan.row[j] = c.r - r0;
      plan.delay[j] = (plan.across[j] / plan.span) * INTRO.letterSweep + (plan.row[j] / rowSpan) * INTRO.letterRows;
    }
  });
  plan.lettersEnd = INTRO.lettersStart + INTRO.letterSweep + INTRO.letterRows + INTRO.letterRise;
  return plan;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
/** Overshoots a little, then settles: a tile that punches up and sinks back to its level. */
const easeOutBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};
/** A cheap per-tile, per-moment shake in [−1, 1]. */
const jitter = (j: number, t: number) => Math.sin(j * 12.9898 + Math.floor(t * 24) * 78.233);

/** 0 before the beam turns, 1 at full speed. */
export const beamSpin = (plan: IntroPlan, t: number) =>
  clamp01((t - plan.lettersEnd - INTRO.beamDelay) / INTRO.beamRamp);

/** 0 until the wave starts, 1 once it is at full height. */
export const waveIn = (plan: IntroPlan, t: number) =>
  clamp01((t - plan.lettersEnd - INTRO.beamDelay - INTRO.waveDelay) / INTRO.waveRamp);

/** How hard the ground is shaking (0–1): while the hill heaves up. */
export function rumble(t: number): number {
  const s = (t - INTRO.hillStart) / (INTRO.hillRise + 0.4);
  return s <= 0 || s >= 1 ? 0 : Math.sin(Math.PI * s) ** 0.7;
}

/** The Keeper's materialisation, 0 (absent) to 1 (whole). */
export const keeperForm = (t: number) => clamp01((t - INTRO.keeperStart) / INTRO.keeperForm);

/**
 * Heights (in levels, fractional), glow (0–1, letters only) and rise (0 = still the bare
 * ground, 1 = risen) of the plan's tiles at time t. `wave` scales the running wave (0 turns
 * it off, e.g. for reduced motion).
 */
export function introFrame(
  plan: IntroPlan,
  t: number,
  wave: number,
  heights: Float32Array,
  glow: Float32Array,
  rise: Float32Array,
): void {
  const shockT = t - INTRO.keeperStart - INTRO.shockDelay;
  const shockFade = shockT > 0 && shockT < INTRO.shockLife ? (1 - shockT / INTRO.shockLife) ** 2 : 0;
  const front = shockT * INTRO.shockSpeed;
  const shake = rumble(t);
  const w = wave * waveIn(plan, t);
  // The crest enters left of the word and leaves right of it, then comes round again.
  const tw = t - plan.lettersEnd;
  const lead = WAVE.width * 2.5;
  const cycle = (((tw / WAVE.period) % 1) + 1) % 1;
  const crestX = -lead + cycle * (plan.span + 2 * lead);

  for (let j = 0; j < plan.cells.length; j++) {
    const from = plan.from[j];
    const to = plan.to[j];
    let h = from;
    let g = 0;
    let r = 1;
    const kind = plan.kind[j];
    if (kind === HILL) {
      const p = clamp01((t - INTRO.hillStart - plan.delay[j]) / INTRO.hillRise);
      h = from + (to - from) * easeOutCubic(p);
      r = p;
      if (p > 0 && p < 1) h += 0.18 * shake * jitter(j, t);
    } else if (kind === LETTER) {
      const p = clamp01((t - INTRO.lettersStart - plan.delay[j]) / INTRO.letterRise);
      h = from + (to - from) * easeOutBack(p);
      r = Math.min(1, p * 2.5);
      // Each tile flares as it breaks the ground, cooling as it settles.
      if (p > 0) g = 0.85 * (1 - p) ** 1.5;
      if (w > 0) {
        const dx = (plan.across[j] - crestX) / WAVE.width;
        const crest = Math.exp(-dx * dx);
        const swell = 0.5 + 0.5 * Math.sin(plan.across[j] * 0.21 - plan.row[j] * 0.15 - t * 2.1);
        h += w * (WAVE.amp * crest + WAVE.swell * swell);
        g = Math.max(g, w * WAVE.glow * crest);
      }
    } else {
      // Plain ground: only the rumble and the shockwave stir it.
      if (shake > 0 && plan.dist[j] < 12) h += 0.06 * shake * jitter(j, t) * (1 - plan.dist[j] / 12);
    }
    if (shockFade > 0 && kind !== HILL) {
      const d = plan.dist[j] - front;
      if (d > -4 && d < 2) h += INTRO.shockAmp * shockFade * Math.exp(-d * d * 0.5) * Math.cos(d * 0.9);
    }
    heights[j] = h;
    glow[j] = g;
    rise[j] = r;
  }
}
