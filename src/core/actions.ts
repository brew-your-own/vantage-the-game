import { Rng } from './rng';
import { cellTop } from './surface';
import { type SightTarget, canSeeCell, segmentClear } from './visibility';
import { hexDistance } from './hex';
import { RELAY_ENERGY, SPIRE_FEED_COST, SPIRE_GROW_TIME, SPIRE_MAX_LEVEL } from './constants';
import {
  ENERGY,
  type EntityKind,
  PLACEABLE,
  type World,
  columnTop,
  entityEnergy,
  isBody,
  isStructure,
  keeperDark,
  relayAt,
  isSupport,
  mothsOn,
  playerEye,
  spawn,
  supportY,
  topOf,
} from './world';

export type Intent =
  | { type: 'harvest'; cell: number }
  | { type: 'place'; cell: number; kind: EntityKind }
  | { type: 'feed'; cell: number }
  | { type: 'transfer'; cell: number }
  | { type: 'scatter' };

export type ActionEvent =
  | { type: 'harvested'; cell: number; kind: EntityKind | 'moth'; energy: number }
  | { type: 'fed'; cell: number; level: number }
  | { type: 'placed'; cell: number; kind: EntityKind; energy: number }
  | { type: 'transferred'; from: number; to: number }
  | { type: 'relayDrained'; cell: number; energy: number; remaining: number }
  | { type: 'won' }
  | { type: 'scattered'; from: number; to: number };

export type ActionResult = { ok: true; events: ActionEvent[] } | { ok: false; reason: string };

/** Energy cost of a Scatter jump: exactly the Husk it creates at the landing tile. */
export const SCATTER_COST = ENERGY.husk;

const fail = (reason: string): ActionResult => ({ ok: false, reason });

/** Occlusion view of the world for line-of-sight checks. */
export function occludersOf(world: World) {
  return {
    columnTop: (cell: number) => columnTop(world, cell),
    supportY: (cell: number) => supportY(world, cell),
  };
}

/**
 * Can the player see `cell` well enough to act on it?
 * 'ground' (see the tile) allows harvesting; 'surface' (see the top of its Shards) allows
 * building there or transferring into a Husk there.
 */
export function canAct(world: World, cell: number, sight: SightTarget = 'ground'): boolean {
  if (cell === world.player.cell) return false;
  return canSeeCell(world.terrain, playerEye(world), cell, occludersOf(world), world.player.cell, sight);
}

/**
 * Validates and applies an intent, mutating the world. Energy is always conserved:
 * every unit the player gains or spends moves to or from an object.
 */
export function applyIntent(world: World, intent: Intent): ActionResult {
  if (world.status !== 'playing') return fail('the game is over');
  if (intent.type !== 'scatter' && intent.cell === world.keeper.cell) {
    if (intent.type === 'transfer') return takeSummit(world);
    return fail('the Keeper stands there');
  }
  if (intent.type !== 'scatter' && relayAt(world, intent.cell)) {
    if (intent.type === 'harvest' && mothsOn(world, intent.cell).length === 0) return drainRelay(world, intent.cell);
    if (intent.type !== 'harvest') return fail('a Relay stands there');
  }
  switch (intent.type) {
    case 'harvest':
      return harvest(world, intent.cell);
    case 'place':
      return place(world, intent.cell, intent.kind);
    case 'feed':
      return feed(world, intent.cell);
    case 'transfer':
      return transfer(world, intent.cell);
    case 'scatter':
      return scatter(world);
  }
}

/**
 * Takes a Moth on the tile if there is one (the richest first), otherwise the top object.
 * A Moth can be swatted even on your own tile.
 */
function harvest(world: World, cell: number): ActionResult {
  const moths = mothsOn(world, cell);
  if (moths.length > 0) {
    if (cell !== world.player.cell && !canAct(world, cell)) return fail('out of sight');
    const moth = moths.reduce((a, b) => (b.energy > a.energy ? b : a));
    world.moths.splice(world.moths.indexOf(moth), 1);
    world.player.energy += moth.energy;
    return { ok: true, events: [{ type: 'harvested', cell, kind: 'moth', energy: moth.energy }] };
  }
  if (cell === world.player.cell) return fail('cannot harvest where you stand');
  const top = topOf(world, cell);
  if (!top) return fail('nothing to harvest');
  if (!canAct(world, cell)) return fail('out of sight');
  world.stacks[cell].pop();
  const energy = entityEnergy(top);
  world.player.energy += energy;
  return { ok: true, events: [{ type: 'harvested', cell, kind: top.kind, energy }] };
}

function place(world: World, cell: number, kind: EntityKind): ActionResult {
  if (!PLACEABLE.includes(kind)) return fail(`cannot create ${kind}`);
  if (cell === world.player.cell) return fail('cannot build where you stand');
  const top = topOf(world, cell);
  if (top?.kind === 'seed' && top.grow) return fail('still growing');
  if (top && !isSupport(top)) return fail(`occupied by ${top.kind}`);
  const energy = ENERGY[kind];
  if (world.player.energy < energy) return fail(`needs ${energy} energy`);
  if (!canAct(world, cell, 'surface')) return fail('out of sight');
  world.player.energy -= energy;
  spawn(world, cell, kind);
  return { ok: true, events: [{ type: 'placed', cell, kind, energy }] };
}

/**
 * Feeds a Seed/Spire one unit of energy; it grows one level over SPIRE_GROW_TIME.
 * The Spire you stand on can be fed too: it lifts you as it grows.
 */
function feed(world: World, cell: number): ActionResult {
  const top = topOf(world, cell);
  if (top?.kind !== 'seed') return fail('nothing to feed');
  if (top.grow) return fail('still growing');
  if ((top.level ?? 0) >= SPIRE_MAX_LEVEL) return fail('fully grown');
  if (world.player.energy < SPIRE_FEED_COST) return fail(`needs ${SPIRE_FEED_COST} energy`);
  if (cell !== world.player.cell && !canAct(world, cell)) return fail('out of sight');
  world.player.energy -= SPIRE_FEED_COST;
  top.fed = (top.fed ?? 0) + SPIRE_FEED_COST;
  top.grow = SPIRE_GROW_TIME;
  return { ok: true, events: [{ type: 'fed', cell, level: (top.level ?? 0) + 1 }] };
}

/** Is the Relay on `cell` close enough to drain (see WorldOptions.relayReach)? */
export function inRelayReach(world: World, cell: number): boolean {
  if (world.relayReach === undefined) return true;
  const { cells } = world.terrain.grid;
  return hexDistance(cells[cell], cells[world.player.cell]) <= world.relayReach;
}

/**
 * Drains a Relay. It must be within reach, and your eye must be above its top, with a clear view of its top:
 * Relays are fed from the Keeper and only give way to a Wisp standing higher.
 */
function drainRelay(world: World, cell: number): ActionResult {
  const relay = relayAt(world, cell)!;
  if (relay.drained) return fail('already drained');
  if (!inRelayReach(world, cell)) return fail(`too far: drain it from within ${world.relayReach} tiles`);
  const eye = playerEye(world);
  const top = supportY(world, cell);
  if (eye.y <= top) return fail('climb higher than the Relay to drain it');
  const centre = cellTop(world.terrain, cell);
  const t = { x: centre.x, y: top + 0.01, z: centre.z };
  if (!segmentClear(world.terrain, eye, t, occludersOf(world), world.player.cell, -1, cell)) {
    return fail('out of sight');
  }
  relay.drained = true;
  world.player.energy += RELAY_ENERGY;
  const remaining = world.relays.filter((r) => !r.drained).length;
  return { ok: true, events: [{ type: 'relayDrained', cell, energy: RELAY_ENERGY, remaining }] };
}

/** With the lamp dark, transferring onto the Keeper's plinth wins the level. */
function takeSummit(world: World): ActionResult {
  if (!keeperDark(world)) return fail('the Keeper still burns: drain every Relay first');
  if (!canAct(world, world.keeper.cell, 'surface')) return fail('climb higher to see the summit');
  world.player.cell = world.keeper.cell;
  world.status = 'won';
  return { ok: true, events: [{ type: 'won' }] };
}

/**
 * Moves the Wisp into a Husk (you must see the surface it stands on) or onto a grown,
 * still Spire (seeing its tile is enough: Spires rise above your eye line).
 */
function transfer(world: World, cell: number): ActionResult {
  if (cell === world.player.cell) return fail('already here');
  const top = topOf(world, cell);
  if (top?.kind === 'seed' && top.grow) return fail('still growing');
  if (!isBody(top)) return fail('no husk or spire there');
  if (!canAct(world, cell, top?.kind === 'husk' ? 'surface' : 'ground')) return fail('out of sight');
  const from = world.player.cell;
  world.player.cell = cell; // the old body stays behind as an ordinary Husk
  return { ok: true, events: [{ type: 'transferred', from, to: cell }] };
}

/**
 * Emergency jump: spends SCATTER_COST to grow a new Husk on a random empty tile lower than
 * your current body, and moves into it. Needs no line of sight, and shakes off the beam.
 */
function scatter(world: World): ActionResult {
  if (world.player.energy < SCATTER_COST) return fail(`needs ${SCATTER_COST} energy`);
  const from = world.player.cell;
  const myBase = supportY(world, from);
  const candidates: number[] = [];
  for (let i = 0; i < world.terrain.grid.count; i++) {
    if (world.stacks[i].length === 0 && !isStructure(world, i) && cellTop(world.terrain, i).y < myBase) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return fail('nowhere lower to go');
  const rng = new Rng(world.rngState);
  const to = rng.pick(candidates);
  world.rngState = rng.state;
  world.player.energy -= SCATTER_COST;
  spawn(world, to, 'husk');
  world.player.cell = to;
  // The Keeper loses you: the beam sweeps on from where it held you.
  world.keeper.locked = false;
  world.keeper.husk = undefined;
  return {
    ok: true,
    events: [
      { type: 'placed', cell: to, kind: 'husk', energy: SCATTER_COST },
      { type: 'scattered', from, to },
    ],
  };
}
