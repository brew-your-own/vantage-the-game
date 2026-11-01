/**
 * A greedy bot that plays a level by the real rules, for the balance pass.
 *
 * solveLevel plans a route with time frozen: harvest everything in reach, drain any Relay
 * it can, otherwise climb (a Shard tower or a Spire) to the spot that helps most, then take
 * the summit. playRoute replays that route in real time (beam turning, Moths moving) at a
 * human-ish pace and reports what the beam and the Moths cost.
 */
import { type Intent, applyIntent, canAct } from '../src/core/actions';
import { SPIRE_MAX_LEVEL } from '../src/core/constants';
import { hexDistance } from '../src/core/hex';
import { beamEta, keeperSeesBodyAt, playerLit } from '../src/core/keeper';
import { step } from '../src/core/sim';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import {
  ENERGY,
  type World,
  type WorldOptions,
  createWorld,
  isBody,
  isStructure,
  keeperDark,
  mothsOn,
  playerEye,
  relayAt,
  topOf,
} from '../src/core/world';

/** Copies the mutable parts of a world (the terrain is shared). */
export function cloneWorld(w: World): World {
  return {
    ...w,
    stacks: w.stacks.map((s) => s.map((e) => ({ ...e }))),
    player: { ...w.player },
    keeper: { ...w.keeper },
    moths: w.moths.map((m) => ({ ...m })),
    relays: w.relays.map((r) => ({ ...r })),
  };
}

/** Furthest a climb may be built, in tiles. */
const MAX_DISTANCE = 12;
/** Climb sites tried per move (highest ground first). */
const SITES = 400;
/** Seconds before the bot swats a Moth that has reached it. */
const REACTION = 2.5;
/** Score cost of a position in the Keeper's sight (about three levels of height). */
const EXPOSED_PENALTY = 2;
/** Seconds per action while escaping the beam (a player in a hurry). */
const ESCAPE_PACE = 1.5;
/** Most climbs before the bot gives up. */
const MAX_CLIMBS = 16;

type Build = { name: string; steps: (cell: number) => Intent[] };
const BUILDS: Build[] = [
  ...[1, 2, 3].map((n) => ({
    name: `tower${n}`,
    steps: (cell: number): Intent[] => [
      ...Array.from({ length: n }, (): Intent => ({ type: 'place', cell, kind: 'shard' })),
      { type: 'place', cell, kind: 'husk' },
      { type: 'transfer', cell },
    ],
  })),
  ...[2, SPIRE_MAX_LEVEL].map((n) => ({
    name: `spire${n}`,
    steps: (cell: number): Intent[] => [
      { type: 'place', cell, kind: 'seed' },
      ...Array.from({ length: n }, (): Intent => ({ type: 'feed', cell })),
      { type: 'transfer', cell },
    ],
  })),
];

/** Applies an intent; a fed Spire finishes growing at once (time is frozen while planning). */
function apply(w: World, intent: Intent): boolean {
  const r = applyIntent(w, intent);
  if (r.ok && intent.type === 'feed') {
    const top = topOf(w, intent.cell)!;
    top.grow = 0;
    top.level = (top.level ?? 0) + 1;
  }
  return r.ok;
}

/** Harvests everything in reach, repeatedly (taking a top uncovers the next object). */
function gather(w: World, out: Intent[]): number {
  let total = 0;
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < w.stacks.length; i++) {
      if (i === w.player.cell || isStructure(w, i)) continue;
      if (!topOf(w, i) && mothsOn(w, i).length === 0) continue;
      const before = w.player.energy;
      const intent: Intent = { type: 'harvest', cell: i };
      if (apply(w, intent)) {
        out.push(intent);
        total += w.player.energy - before;
        again = true;
      }
    }
  }
  return total;
}

function drainAny(w: World, out: Intent[]): boolean {
  let any = false;
  for (const r of w.relays) {
    if (r.drained) continue;
    const intent: Intent = { type: 'harvest', cell: r.cell };
    if (apply(w, intent)) {
      out.push(intent);
      any = true;
    }
  }
  return any;
}

/**
 * How good a position is: Relays it can drain now, then nearness to the closest Relay
 * still out of reach, then height.
 */
function score(w: World): number {
  const { cells } = w.terrain.grid;
  const here = cells[w.player.cell];
  let s = playerEye(w).y;
  let nearest = Infinity;
  for (const r of w.relays) {
    if (r.drained) continue;
    if (apply(cloneWorld(w), { type: 'harvest', cell: r.cell })) s += 100;
    else nearest = Math.min(nearest, hexDistance(cells[r.cell], here));
  }
  if (nearest < Infinity) s -= 0.5 * Math.max(0, nearest - (w.relayReach ?? 99));
  if (keeperDark(w) && canAct(w, w.keeper.cell, 'surface')) s += 100;
  // Standing where the Keeper can see means being caught on its next sweep.
  else if (!keeperDark(w) && keeperSeesBodyAt(w, w.player.cell)) s -= EXPOSED_PENALTY;
  return s;
}

/** The best climb from here, or null. */
function bestClimb(w: World, visited: Set<number>): { intents: Intent[]; world: World; build: string } | null {
  const { grid, heights } = w.terrain;
  const here = grid.cells[w.player.cell];
  const sites: number[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (visited.has(i) || w.stacks[i].length > 0 || isStructure(w, i)) continue;
    if (hexDistance(grid.cells[i], here) > MAX_DISTANCE) continue;
    if (canAct(w, i, 'surface')) sites.push(i);
  }
  sites.sort((a, b) => heights[b] - heights[a]);
  const base = score(w);
  let best: { intents: Intent[]; world: World; build: string; s: number } | null = null;
  for (const cell of sites.slice(0, SITES)) {
    for (const build of BUILDS) {
      const c = cloneWorld(w);
      const intents = build.steps(cell);
      if (!intents.every((i) => apply(c, i))) continue;
      // Spend less: a small penalty per unit left standing in the climb.
      const s = score(c) - 0.05 * (w.player.energy - c.player.energy);
      if (s > base + 0.4 && (!best || s > best.s)) best = { intents, world: c, build: build.name, s };
    }
  }
  return best;
}

export interface Plan {
  won: boolean;
  /** Why it stopped, when it did not win. */
  stuck?: string;
  intents: Intent[];
  climbs: string[];
  /** Energy at the summit (or when stuck). */
  energyLeft: number;
  /** Lowest energy along the way. */
  lowest: number;
}

export function makeWorld(code: number, options: WorldOptions): World {
  return createWorld(generateTerrain({ ...DEFAULT_TERRAIN, seed: code }), code, options);
}

/** Plans a route from the given world (which it changes) with time frozen. */
export function solveFrom(start: World): Plan {
  let w = start;
  const intents: Intent[] = [];
  const climbs: string[] = [];
  const visited = new Set<number>([w.player.cell]);
  let lowest = w.player.energy;
  const done = (won: boolean, stuck?: string): Plan => ({ won, stuck, intents, climbs, energyLeft: w.player.energy, lowest });
  while (climbs.length <= MAX_CLIMBS) {
    gather(w, intents);
    drainAny(w, intents);
    gather(w, intents);
    if (keeperDark(w) && apply(w, { type: 'transfer', cell: w.keeper.cell })) {
      intents.push({ type: 'transfer', cell: w.keeper.cell });
      return done(true);
    }
    const climb = bestClimb(w, visited);
    if (!climb) return done(false, `no climb (energy ${w.player.energy}, ${w.relays.filter((r) => !r.drained).length} Relays left)`);
    intents.push(...climb.intents);
    climbs.push(climb.build);
    w = climb.world;
    visited.add(w.player.cell);
    lowest = Math.min(lowest, w.player.energy);
  }
  return done(false, 'too many climbs');
}

export const solveLevel = (code: number, options: WorldOptions): Plan => solveFrom(makeWorld(code, options));

export interface Playthrough {
  won: boolean;
  lost: boolean;
  seconds: number;
  /** Energy lost to the beam and to Moths. */
  beam: number;
  moth: number;
  energyLeft: number;
  /** Times the bot had to re-plan (a Moth ate moss it counted on, or landed in the way). */
  replans: number;
  /** Times the beam held the bot and it had to get out of sight. */
  escapes: number;
  /** Times the bot moved into cover just before the beam came round. */
  dodges: number;
}

/**
 * How to get out of the beam's hold, nearest first: transfer into a body the Keeper can't
 * see, else place a Husk where it can't see and transfer into it, else scatter.
 */
function escapePlan(w: World, allowScatter = true): Intent[] {
  const { cells } = w.terrain.grid;
  const here = cells[w.player.cell];
  const near = (a: number, b: number) => hexDistance(cells[a], here) - hexDistance(cells[b], here);
  const hidden: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (i !== w.player.cell && !isStructure(w, i) && !keeperSeesBodyAt(w, i)) hidden.push(i);
  }
  hidden.sort(near);
  for (const i of hidden) {
    const top = topOf(w, i);
    if (isBody(top) && canAct(w, i, top?.kind === 'husk' ? 'surface' : 'ground')) return [{ type: 'transfer', cell: i }];
  }
  if (w.player.energy >= ENERGY.husk) {
    for (const i of hidden) {
      const top = topOf(w, i);
      if ((!top || top.kind === 'shard') && canAct(w, i, 'surface')) {
        return [
          { type: 'place', cell: i, kind: 'husk' },
          { type: 'transfer', cell: i },
        ];
      }
    }
  }
  return allowScatter ? [{ type: 'scatter' }] : [];
}

/**
 * Plays a level in real time: `pace` seconds per action, waiting for Spires to grow,
 * swatting any Moth that reaches the Wisp, getting out of sight when the beam holds it
 * (after REACTION seconds), and re-planning when the world has moved on.
 */
export function playLevel(
  code: number,
  options: WorldOptions,
  pace = 3,
  maxReplans = 12,
  trace?: (line: string) => void,
): Playthrough {
  const w = makeWorld(code, options);
  let beam = 0;
  let moth = 0;
  let replans = 0;
  let escapes = 0;
  let dodges = 0;
  let mothTime = 0;
  let heldTime = 0;
  let escaping = false;
  const held = () => heldTime >= REACTION && !escaping;
  /** Runs the simulation; stops early when the beam has held the bot long enough to react. */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds && w.status === 'playing'; t += 0.05) {
      for (const e of step(w, 0.05)) {
        if (e.type === 'drained') beam++;
        if (e.type === 'leeched') moth++;
      }
      // A player notices a Moth on them after a moment, then swats it.
      mothTime = mothsOn(w, w.player.cell).length > 0 ? mothTime + 0.05 : 0;
      if (mothTime >= REACTION) applyIntent(w, { type: 'harvest', cell: w.player.cell });
      heldTime = w.keeper.locked && playerLit(w) ? heldTime + 0.05 : 0;
      if (held()) return;
    }
  };
  const escape = (plan = escapePlan(w)) => {
    escaping = true;
    escapes++;
    for (const intent of plan) {
      const r = applyIntent(w, intent);
      trace?.(`${w.time.toFixed(1)}s energy ${w.player.energy} ESCAPE ${JSON.stringify(intent)} ${r.ok ? 'ok' : r.reason}`);
      if (!r.ok) break;
      run(Math.min(pace, ESCAPE_PACE));
    }
    escaping = false;
    heldTime = 0;
  };
  let queue = solveFrom(cloneWorld(w)).intents;
  while (w.status === 'playing' && queue.length > 0) {
    if (held()) {
      escape();
      if (replans++ >= maxReplans * 4) break;
      queue = solveFrom(cloneWorld(w)).intents;
      continue;
    }
    // The beam is about to sweep over: get into cover first, if there is any to be had.
    const eta = beamEta(w);
    if (eta !== null && eta > 0 && eta < pace + 1) {
      const plan = escapePlan(w, false);
      if (plan.length > 0) {
        escape(plan);
        dodges++;
        if (replans++ >= maxReplans * 4) break;
        queue = solveFrom(cloneWorld(w)).intents;
        continue;
      }
    }
    const intent = queue.shift()!;
    const r = applyIntent(w, intent);
    trace?.(`${w.time.toFixed(1)}s energy ${w.player.energy} lit ${playerLit(w)} ${JSON.stringify(intent)} ${r.ok ? 'ok' : r.reason}`);
    if (!r.ok) {
      // A harvest that finds nothing is harmless; anything else needs a new plan.
      if (intent.type === 'harvest' && !relayAt(w, intent.cell)) continue;
      if (replans++ >= maxReplans * 4) break;
      queue = solveFrom(cloneWorld(w)).intents;
      continue;
    }
    run(pace);
    if (intent.type === 'feed') {
      while (w.status === 'playing' && topOf(w, intent.cell)?.grow && !held()) run(0.05);
    }
  }
  return {
    won: w.status === 'won',
    lost: w.status === 'lost',
    seconds: Math.round(w.time),
    beam,
    moth,
    energyLeft: w.player.energy,
    replans,
    escapes: escapes - dodges,
    dodges,
  };
}
