/**
 * The route the tutorial teaches, checked against the real rules: harvest a moss, build a
 * tower of TOWER_SHARDS Shards and a Husk nearby, transfer up and harvest the old body;
 * swat the Moth the tutorial hatches; grow a Spire and climb onto it; climb again while
 * needed; drain the Relay; climb again while needed; take the summit. A tutorial level is
 * only usable if such a route exists.
 */
import { type Intent, applyIntent, occludersOf } from '../src/core/actions';
import { SPIRE_MAX_LEVEL } from '../src/core/constants';
import { isFairWorld } from '../src/core/fair';
import { hexDistance } from '../src/core/hex';
import { cellTop } from '../src/core/surface';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { castRay, visibleCells } from '../src/core/visibility';
import { type World, type WorldOptions, createWorld, isStructure, playerEye, topOf } from '../src/core/world';
import { hatchTutorialMoth } from '../src/tutorial';

/** Shards in each tower the tutorial asks for. */
export const TOWER_SHARDS = 2;
/** The first (taught) tower is this close to the start, in tiles. */
export const FIRST_TOWER_DISTANCE = 8;
/** Later towers and Spires may be this far away; every one must be clearly aimable. */
const MAX_DISTANCE = 14;
/** The first moss to harvest is this close. */
const MAX_MOSS_DISTANCE = 6;
/** Most climbs (towers and Spires) a tutorial route may need. */
export const MAX_CLIMBS = 4;

/**
 * One move of the route: a player intent, or what the game does in between: a Spire
 * finishing its growth (`grow`), or the tutorial hatching its Moth (`hatch`).
 */
export type RouteStep = Intent | { type: 'grow'; cell: number } | { type: 'hatch' };

export interface TutorialRoute {
  /** A moss tile in view from the start. */
  moss: number;
  /** Climb tiles, in order: the first is the taught tower, the second the taught Spire. */
  climbs: number[];
  /** Every step of the route, in order (replayable with applyStep). */
  steps: RouteStep[];
}

/** Applies a route step; false if it fails. */
export function applyStep(world: World, step: RouteStep): ReturnType<typeof applyIntent> {
  if (step.type === 'grow') {
    const top = topOf(world, step.cell);
    if (top?.kind !== 'seed' || !top.grow) return { ok: false, reason: 'not growing' };
    top.grow = 0;
    top.level = (top.level ?? 0) + 1;
    return { ok: true, events: [] };
  }
  if (step.type === 'hatch') {
    return hatchTutorialMoth(world) >= 0 ? { ok: true, events: [] } : { ok: false, reason: 'no moss' };
  }
  return applyIntent(world, step);
}

/** Aiming at the middle of the tile lands on its top, not on a slope in front of it. */
function clearlyAimable(world: World, cell: number): boolean {
  const eye = playerEye(world);
  const t = cellTop(world.terrain, cell);
  const d = { x: t.x - eye.x, y: t.y + 0.02 - eye.y, z: t.z - eye.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const hit = castRay(world.terrain, eye, { x: d.x / len, y: d.y / len, z: d.z / len }, occludersOf(world), world.player.cell);
  return hit?.cell === cell && hit.kind !== 'slope';
}

/** Empty, clearly aimable tiles in view, between `min` and `max` tiles away. */
function aimableTiles(world: World, min: number, max: number): number[] {
  const { grid } = world.terrain;
  const here = grid.cells[world.player.cell];
  const visible = visibleCells(world.terrain, playerEye(world), occludersOf(world), world.player.cell);
  const out: number[] = [];
  for (let i = 0; i < grid.count; i++) {
    const d = hexDistance(grid.cells[i], here);
    if (visible[i] !== 1 || d < min || d > max || isStructure(world, i)) continue;
    if (clearlyAimable(world, i)) out.push(i);
  }
  return out;
}

const towerSteps = (cell: number, oldBody: number): RouteStep[] => [
  ...Array.from({ length: TOWER_SHARDS }, (): RouteStep => ({ type: 'place', cell, kind: 'shard' })),
  { type: 'place', cell, kind: 'husk' },
  { type: 'transfer', cell },
  { type: 'harvest', cell: oldBody },
];

const spireSteps = (cell: number, oldBody: number): RouteStep[] => [
  { type: 'place', cell, kind: 'seed' },
  ...Array.from({ length: SPIRE_MAX_LEVEL }, (): RouteStep[] => [{ type: 'feed', cell }, { type: 'grow', cell }]).flat(),
  { type: 'transfer', cell },
  { type: 'harvest', cell: oldBody },
];

export function tutorialRoute(code: number, options: WorldOptions): TutorialRoute | null {
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: code });
  const fresh = () => createWorld(terrain, code, options);
  /** The world after `steps`, or null if any of them fails. */
  const replay = (steps: RouteStep[]): World | null => {
    const w = fresh();
    return steps.every((s) => applyStep(w, s).ok) ? w : null;
  };

  const w0 = fresh();
  if (w0.relays.length !== 1 || !isFairWorld(w0, 1)) return null;
  const relay = w0.relays[0].cell;
  // The lesson is to climb: the Relay must not be drainable from the start.
  if (replay([{ type: 'harvest', cell: relay }])) return null;

  const near = aimableTiles(w0, 2, MAX_MOSS_DISTANCE);
  const moss = near.find((i) => w0.stacks[i].length === 1 && w0.stacks[i][0].kind === 'moss');
  if (moss === undefined) return null;

  const steps: RouteStep[] = [{ type: 'harvest', cell: moss }];
  const climbs: number[] = [];
  /** Climbs (highest ground first) with a tower or a Spire; false if none works. */
  const climb = (build: typeof towerSteps, minDistance: number, maxDistance: number): boolean => {
    if (climbs.length >= MAX_CLIMBS) return false;
    const w = replay(steps)!;
    const from = w.player.cell;
    const eyeY = playerEye(w).y;
    const candidates = aimableTiles(w, minDistance, maxDistance)
      .filter((i) => w.stacks[i].length === 0)
      .sort((a, b) => terrain.heights[b] - terrain.heights[a]);
    for (const cell of candidates) {
      const next = [...steps, ...build(cell, from)];
      const after = replay(next);
      if (after && playerEye(after).y > eyeY + 0.5) {
        steps.splice(0, steps.length, ...next);
        climbs.push(cell);
        return true;
      }
    }
    return false;
  };

  if (!climb(towerSteps, 1, FIRST_TOWER_DISTANCE)) return null;
  // The tutorial hatches a Moth from moss in view; the Wisp swats it where it hatched.
  const hatched = replay(steps)!;
  const mothCell = hatchTutorialMoth(hatched);
  if (mothCell < 0) return null;
  steps.push({ type: 'hatch' }, { type: 'harvest', cell: mothCell });
  if (!replay(steps)) return null;
  if (!climb(spireSteps, 2, MAX_DISTANCE)) return null;

  for (const goal of [{ type: 'harvest', cell: relay }, { type: 'transfer', cell: w0.keeper.cell }] as Intent[]) {
    while (!replay([...steps, goal])) {
      if (!climb(spireSteps, 2, MAX_DISTANCE) && !climb(towerSteps, 1, MAX_DISTANCE)) return null;
    }
    steps.push(goal);
  }
  return replay(steps)?.status === 'won' ? { moss, climbs, steps } : null;
}
