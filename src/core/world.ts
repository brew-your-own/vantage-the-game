import {
  BEAM,
  EYE_HEIGHT,
  HUSK_HEIGHT,
  KEEPER_HEIGHT,
  PLINTH_HEIGHT,
  RELAY_ENERGY,
  RELAY_HEIGHT,
  SHARD_HEIGHT,
  SPIRE_STEP,
} from './constants';
import { hiddenFromLamp, pickKeeperCell, pickRelayCells, pickStartCell } from './level';
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
  /** Seed/Spire: completed growth levels (0 = still a Seed). */
  level?: number;
  /** Seed/Spire: energy fed into it so far (each feed buys one level). */
  fed?: number;
  /** Seed/Spire: seconds left until the current growth level completes (0 = not growing). */
  grow?: number;
  /** Moss: seconds spent in the beam (for display; hatching is a per-second chance). */
  lit?: number;
}

/** A Moth: drifts from tile to tile toward energy, eats moss, and drains the Wisp. */
export interface Moth {
  readonly id: number;
  cell: number;
  /** Tile it came from, for smooth rendering of the current move. */
  prevCell: number;
  energy: number;
  /** Seconds since its last move. */
  clock: number;
  /** Seconds spent on the Wisp's tile since it last drained a unit. */
  leechClock: number;
}

/** Energy stored in an entity (a Spire holds everything fed into it). */
export function entityEnergy(e: Entity): number {
  return ENERGY[e.kind] + (e.fed ?? 0);
}

/** Solid height an entity adds to its tile's column. */
export function entityHeight(e: Entity): number {
  switch (e.kind) {
    case 'shard':
      return SHARD_HEIGHT;
    case 'seed':
      return (e.level ?? 0) * SPIRE_STEP;
    case 'husk':
      return HUSK_HEIGHT;
    case 'moss':
      return 0;
  }
}

/**
 * Does this entity hold things up? Shards, and Spires with at least one grown level
 * (a growing Spire still holds up its completed levels; nothing new can be put on it).
 */
export function isSupport(e: Entity): boolean {
  return e.kind === 'shard' || (e.kind === 'seed' && (e.level ?? 0) > 0);
}

/** Can the Wisp inhabit this entity? Husks, and grown Spires (it stands on top). */
export function isBody(e: Entity | undefined): boolean {
  return e?.kind === 'husk' || (e?.kind === 'seed' && (e.level ?? 0) > 0);
}

export interface Player {
  /** Cell of the Wisp's current body: a Husk, or a grown Spire, on top of that cell's stack. */
  cell: number;
  energy: number;
}

export interface Keeper {
  /** The tile the tower stands on. Nothing else can be placed there. */
  readonly cell: number;
  /** Horizontal direction of the beam's centre, radians (bearing = atan2(dz, dx)). */
  yaw: number;
}

export type GameStatus = 'playing' | 'lost' | 'won';

/** A pylon feeding the Keeper's lamp. Drained from above, it gives up its energy. */
export interface Relay {
  readonly cell: number;
  drained: boolean;
}

/** Per-level settings beyond the terrain (see core/levels.ts). */
export interface WorldOptions {
  /** Number of Relays to place. */
  relays: number;
  /** Beam turning speed multiplier (the tutorial uses a slower beam). Default 1. */
  beamScale?: number;
  /** Energy the Wisp starts with. Default START_ENERGY. */
  startEnergy?: number;
}

export const DEFAULT_OPTIONS: WorldOptions = { relays: 4 };

/**
 * Everything that changes during play. Each cell holds a stack of objects, bottom first:
 * zero or more Shards, optionally topped by one Husk, Seed or Moss.
 */
export interface World {
  readonly terrain: Terrain;
  readonly stacks: Entity[][];
  readonly player: Player;
  readonly keeper: Keeper;
  readonly moths: Moth[];
  readonly relays: Relay[];
  status: GameStatus;
  /** Simulated seconds since the level started. */
  time: number;
  /** Seconds spent in the beam since the last unit of energy was drained. */
  drainClock: number;
  /** RNG state for gameplay randomness (Scatter, drain moss, later moths). */
  rngState: number;
  nextId: number;
  /** Beam speed multiplier from WorldOptions; absent means 1. */
  beamScale?: number;
}

export const START_ENERGY = 10;
/** Fraction of tiles that start with moss on them. */
const MOSS_DENSITY = 0.1;

export function createWorld(terrain: Terrain, seed: number, options: WorldOptions = DEFAULT_OPTIONS): World {
  const stacks: Entity[][] = terrain.grid.cells.map(() => []);
  const keeperCell = pickKeeperCell(terrain, seed);
  const startCell = pickStartCell(terrain, seed, keeperCell);
  const rng = new Rng((seed ^ 0x3c6ef372) >>> 0);
  let yaw = rng.range(0, Math.PI * 2);
  if (!hiddenFromLamp(terrain, keeperCell, startCell)) {
    // No hiding place to start in: the beam has just swept past, giving a full turn to act.
    const k = cellTop(terrain, keeperCell);
    const p = cellTop(terrain, startCell);
    yaw = Math.atan2(p.z - k.z, p.x - k.x) + BEAM.halfAngle + 0.05;
  }
  const world: World = {
    terrain,
    stacks,
    player: { cell: startCell, energy: options.startEnergy ?? START_ENERGY },
    keeper: { cell: keeperCell, yaw },
    moths: [],
    relays: pickRelayCells(terrain, seed, keeperCell, startCell, options.relays).map((cell) => ({
      cell,
      drained: false,
    })),
    status: 'playing',
    time: 0,
    drainClock: 0,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    nextId: 1,
    beamScale: options.beamScale ?? 1,
  };
  spawn(world, world.player.cell, 'husk');

  for (let i = 0; i < terrain.grid.count; i++) {
    if (i !== world.player.cell && !isStructure(world, i) && rng.next() < MOSS_DENSITY) spawn(world, i, 'moss');
  }
  return world;
}

/** The Relay standing on `cell`, if any. */
export function relayAt(world: World, cell: number): Relay | undefined {
  return world.relays.find((r) => r.cell === cell);
}

/** Tiles occupied by the Keeper or a Relay: nothing can be placed or laid there. */
export function isStructure(world: World, cell: number): boolean {
  return cell === world.keeper.cell || relayAt(world, cell) !== undefined;
}

/** Once every Relay is drained the lamp goes out: no beam, and the summit can be taken. */
export function keeperDark(world: World): boolean {
  return world.relays.length > 0 && world.relays.every((r) => r.drained);
}

/** The beam weakens as Relays are drained: narrower and slower. */
export function beamParams(world: World): { halfAngle: number; speed: number } {
  const total = world.relays.length;
  const left = world.relays.filter((r) => !r.drained).length;
  const f = total === 0 ? 1 : left / total;
  return {
    halfAngle: BEAM.halfAngle * (0.4 + 0.6 * f),
    speed: BEAM.speed * (0.5 + 0.5 * f) * (world.beamScale ?? 1),
  };
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

/**
 * World Y of the surface on which the next object would rest: the top of the supporting
 * objects (Shards, grown Spires) at the bottom of the stack.
 */
export function supportY(world: World, cell: number): number {
  let y = cellTop(world.terrain, cell).y;
  if (cell === world.keeper.cell) return y + (keeperDark(world) ? PLINTH_HEIGHT : KEEPER_HEIGHT);
  if (relayAt(world, cell)) return y + RELAY_HEIGHT;
  for (const e of world.stacks[cell]) {
    if (!isSupport(e)) break;
    y += entityHeight(e);
  }
  return y;
}

/** World Y of the top of the solid column on a cell (blocks sight), or -Infinity if none. */
export function columnTop(world: World, cell: number): number {
  const base = cellTop(world.terrain, cell).y;
  if (cell === world.keeper.cell) return base + (keeperDark(world) ? PLINTH_HEIGHT : KEEPER_HEIGHT);
  if (relayAt(world, cell)) return base + RELAY_HEIGHT;
  let y = base;
  let top = -Infinity;
  for (const e of world.stacks[cell]) {
    const h = entityHeight(e);
    if (h > 0) {
      y += h;
      top = y;
    }
  }
  return top;
}

export function mothsOn(world: World, cell: number): Moth[] {
  return world.moths.filter((m) => m.cell === cell);
}

export function spawnMoth(world: World, cell: number, energy: number): Moth {
  const m: Moth = { id: world.nextId++, cell, prevCell: cell, energy, clock: 0, leechClock: 0 };
  world.moths.push(m);
  return m;
}

/** Eye position of the Wisp in its current body. */
export function playerEye(world: World): { x: number; y: number; z: number } {
  const top = cellTop(world.terrain, world.player.cell);
  return { x: top.x, y: supportY(world, world.player.cell) + EYE_HEIGHT, z: top.z };
}

/** Total energy in the world: the player's reserve plus everything in objects and Moths. */
export function totalEnergy(world: World): number {
  let sum = world.player.energy;
  for (const stack of world.stacks) for (const e of stack) sum += entityEnergy(e);
  for (const m of world.moths) sum += m.energy;
  for (const r of world.relays) if (!r.drained) sum += RELAY_ENERGY;
  return sum;
}
