import { EYE_HEIGHT, HUSK_HEIGHT, KEEPER_HEIGHT, SHARD_HEIGHT } from './constants';
import { pickKeeperCell, pickStartCell } from './level';
import { Rng } from './rng';
import { cellTop } from './surface';
import type { Terrain } from './terrain';

export type EntityKind = 'moss' | 'shard' | 'husk' | 'seed';

/** Energy stored in each kind of object. Creating one costs exactly this; harvesting returns it. */
export const ENERGY: Readonly<Record<EntityKind, number>> = {
  moss: 1,
  shard: 2,
  husk: 3,
  seed: 2,
};

/** Kinds the player can create. */
export const PLACEABLE: readonly EntityKind[] = ['shard', 'husk', 'seed'];

export interface Entity {
  readonly id: number;
  readonly kind: EntityKind;
}

export interface Player {
  /** Cell the Wisp's current body (a Husk on top of that cell's stack) stands on. */
  cell: number;
  energy: number;
}

export interface Keeper {
  /** The tile the tower stands on. Nothing else can be placed there. */
  readonly cell: number;
  /** Horizontal direction of the beam's centre, radians (bearing = atan2(dz, dx)). */
  yaw: number;
}

export type GameStatus = 'playing' | 'lost';

/**
 * Everything that changes during play. Each cell holds a stack of objects, bottom first:
 * zero or more Shards, optionally topped by one Husk, Seed or Moss.
 */
export interface World {
  readonly terrain: Terrain;
  readonly stacks: Entity[][];
  readonly player: Player;
  readonly keeper: Keeper;
  status: GameStatus;
  /** Simulated seconds since the level started. */
  time: number;
  /** Seconds spent in the beam since the last unit of energy was drained. */
  drainClock: number;
  /** RNG state for gameplay randomness (Scatter, drain moss, later moths). */
  rngState: number;
  nextId: number;
}

export const START_ENERGY = 10;
/** Fraction of tiles that start with moss on them. */
const MOSS_DENSITY = 0.1;

export function createWorld(terrain: Terrain, seed: number): World {
  const stacks: Entity[][] = terrain.grid.cells.map(() => []);
  const keeperCell = pickKeeperCell(terrain, seed);
  const rng = new Rng((seed ^ 0x3c6ef372) >>> 0);
  const world: World = {
    terrain,
    stacks,
    player: { cell: pickStartCell(terrain, seed, keeperCell), energy: START_ENERGY },
    keeper: { cell: keeperCell, yaw: rng.range(0, Math.PI * 2) },
    status: 'playing',
    time: 0,
    drainClock: 0,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    nextId: 1,
  };
  spawn(world, world.player.cell, 'husk');

  for (let i = 0; i < terrain.grid.count; i++) {
    if (i !== world.player.cell && i !== keeperCell && rng.next() < MOSS_DENSITY) spawn(world, i, 'moss');
  }
  return world;
}

export function spawn(world: World, cell: number, kind: EntityKind): Entity {
  const e = { id: world.nextId++, kind };
  world.stacks[cell].push(e);
  return e;
}

export function topOf(world: World, cell: number): Entity | undefined {
  const s = world.stacks[cell];
  return s[s.length - 1];
}

function shardCount(stack: readonly Entity[]): number {
  let n = 0;
  while (n < stack.length && stack[n].kind === 'shard') n++;
  return n;
}

/** World Y of the surface on which the next object would rest (top of the Shards). */
export function supportY(world: World, cell: number): number {
  return cellTop(world.terrain, cell).y + shardCount(world.stacks[cell]) * SHARD_HEIGHT;
}

/** World Y of the top of the solid column on a cell (blocks sight), or -Infinity if none. */
export function columnTop(world: World, cell: number): number {
  if (cell === world.keeper.cell) return cellTop(world.terrain, cell).y + KEEPER_HEIGHT;
  const stack = world.stacks[cell];
  const shards = shardCount(stack);
  const hasHusk = stack.length > shards && stack[shards].kind === 'husk';
  if (shards === 0 && !hasHusk) return -Infinity;
  return cellTop(world.terrain, cell).y + shards * SHARD_HEIGHT + (hasHusk ? HUSK_HEIGHT : 0);
}

/** Eye position of the Wisp in its current body. */
export function playerEye(world: World): { x: number; y: number; z: number } {
  const top = cellTop(world.terrain, world.player.cell);
  return { x: top.x, y: supportY(world, world.player.cell) + EYE_HEIGHT, z: top.z };
}

/** Total energy in the world: the player's reserve plus everything stored in objects. */
export function totalEnergy(world: World): number {
  let sum = world.player.energy;
  for (const stack of world.stacks) for (const e of stack) sum += ENERGY[e.kind];
  return sum;
}
