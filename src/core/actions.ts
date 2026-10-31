import { Rng } from './rng';
import { cellTop } from './surface';
import { type SightTarget, canSeeCell } from './visibility';
import { ENERGY, type EntityKind, PLACEABLE, type World, columnTop, playerEye, spawn, supportY, topOf } from './world';

export type Intent =
  | { type: 'harvest'; cell: number }
  | { type: 'place'; cell: number; kind: EntityKind }
  | { type: 'transfer'; cell: number }
  | { type: 'scatter' };

export type ActionEvent =
  | { type: 'harvested'; cell: number; kind: EntityKind; energy: number }
  | { type: 'placed'; cell: number; kind: EntityKind; energy: number }
  | { type: 'transferred'; from: number; to: number }
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
  switch (intent.type) {
    case 'harvest':
      return harvest(world, intent.cell);
    case 'place':
      return place(world, intent.cell, intent.kind);
    case 'transfer':
      return transfer(world, intent.cell);
    case 'scatter':
      return scatter(world);
  }
}

function harvest(world: World, cell: number): ActionResult {
  if (cell === world.player.cell) return fail('cannot harvest where you stand');
  const top = topOf(world, cell);
  if (!top) return fail('nothing to harvest');
  if (!canAct(world, cell)) return fail('out of sight');
  world.stacks[cell].pop();
  const energy = ENERGY[top.kind];
  world.player.energy += energy;
  return { ok: true, events: [{ type: 'harvested', cell, kind: top.kind, energy }] };
}

function place(world: World, cell: number, kind: EntityKind): ActionResult {
  if (!PLACEABLE.includes(kind)) return fail(`cannot create ${kind}`);
  if (cell === world.player.cell) return fail('cannot build where you stand');
  const top = topOf(world, cell);
  if (top && top.kind !== 'shard') return fail(`occupied by ${top.kind}`);
  const energy = ENERGY[kind];
  if (world.player.energy < energy) return fail(`needs ${energy} energy`);
  if (!canAct(world, cell, 'surface')) return fail('out of sight');
  world.player.energy -= energy;
  spawn(world, cell, kind);
  return { ok: true, events: [{ type: 'placed', cell, kind, energy }] };
}

function transfer(world: World, cell: number): ActionResult {
  if (cell === world.player.cell) return fail('already here');
  if (topOf(world, cell)?.kind !== 'husk') return fail('no husk there');
  if (!canAct(world, cell, 'surface')) return fail('out of sight');
  const from = world.player.cell;
  world.player.cell = cell; // the old body stays behind as an ordinary Husk
  return { ok: true, events: [{ type: 'transferred', from, to: cell }] };
}

/**
 * Emergency jump: spends SCATTER_COST to grow a new Husk on a random empty tile lower than
 * your current body, and moves into it. Needs no line of sight.
 */
function scatter(world: World): ActionResult {
  if (world.player.energy < SCATTER_COST) return fail(`needs ${SCATTER_COST} energy`);
  const from = world.player.cell;
  const myBase = supportY(world, from);
  const candidates: number[] = [];
  for (let i = 0; i < world.terrain.grid.count; i++) {
    if (world.stacks[i].length === 0 && cellTop(world.terrain, i).y < myBase) candidates.push(i);
  }
  if (candidates.length === 0) return fail('nowhere lower to go');
  const rng = new Rng(world.rngState);
  const to = rng.pick(candidates);
  world.rngState = rng.state;
  world.player.energy -= SCATTER_COST;
  spawn(world, to, 'husk');
  world.player.cell = to;
  return {
    ok: true,
    events: [
      { type: 'placed', cell: to, kind: 'husk', energy: SCATTER_COST },
      { type: 'scattered', from, to },
    ],
  };
}
