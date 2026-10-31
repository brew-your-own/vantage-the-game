import { lampPosition } from './level';
import { Rng } from './rng';
import { cellTop } from './surface';
import { type Vec3, segmentClear } from './visibility';
import { type World, columnTop, playerEye, spawn, supportY } from './world';

/** Beam tuning. Relays (M6) will narrow and slow the beam as they are drained. */
export const BEAM = {
  /** Half of the beam's horizontal width, radians (15°). */
  halfAngle: (15 * Math.PI) / 180,
  /** Rotation speed, radians per second (one full turn every 36 s). */
  speed: (2 * Math.PI) / 36,
  /** Seconds in the beam per unit of energy drained. */
  drainInterval: 1,
};

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Horizontal bearing from the Keeper's tile to a point (radians, atan2(dz, dx)). */
export function bearingFromKeeper(world: World, p: { x: number; z: number }): number {
  const k = cellTop(world.terrain, world.keeper.cell);
  return Math.atan2(p.z - k.z, p.x - k.x);
}

/** Is a horizontal bearing inside the beam's wedge right now? */
export function inBeamWedge(world: World, bearing: number): boolean {
  const d = wrap(bearing - world.keeper.yaw + Math.PI) - Math.PI;
  return Math.abs(d) <= BEAM.halfAngle;
}

/** Occluders for light: object columns, with the Keeper's own tower ignored. */
function lightOccluders(world: World) {
  return { columnTop: (cell: number) => columnTop(world, cell) };
}

/** Is there a clear line from the lamp to `p`? Objects on `ownCell` don't cast shadow on it. */
export function lampCanSee(world: World, p: Vec3, ownCell: number): boolean {
  const lamp = lampPosition(world.terrain, world.keeper.cell);
  return segmentClear(world.terrain, lamp, p, lightOccluders(world), world.keeper.cell, -1, ownCell);
}

/**
 * Can the lamp see the Wisp at all (ignoring where the beam currently points)?
 * Checks the head and the feet of the current body.
 */
export function playerInLampSight(world: World): boolean {
  const cell = world.player.cell;
  const eye = playerEye(world);
  const feet = { x: eye.x, y: supportY(world, cell) + 0.3, z: eye.z };
  return lampCanSee(world, eye, cell) || lampCanSee(world, feet, cell);
}

/** Is the player lit by the beam right now? */
export function playerLit(world: World): boolean {
  return inBeamWedge(world, bearingFromKeeper(world, playerEye(world))) && playerInLampSight(world);
}

/**
 * Seconds until the beam reaches the player: 0 when lit, null if the lamp can't see the
 * player at all (shadowed), otherwise the time until the beam's leading edge arrives.
 */
export function beamEta(world: World): number | null {
  if (!playerInLampSight(world)) return null;
  const bearing = bearingFromKeeper(world, playerEye(world));
  if (inBeamWedge(world, bearing)) return 0;
  return wrap(bearing - BEAM.halfAngle - world.keeper.yaw) / BEAM.speed;
}

/** Is a tile's top lit right now? `inSight` is the precomputed lamp visibility of the tile. */
export function tileLit(world: World, cell: number, inSight: boolean): boolean {
  return inSight && inBeamWedge(world, bearingFromKeeper(world, cellTop(world.terrain, cell)));
}

/** Lamp visibility of every tile's top (changes only when objects change). */
export function lampVisibleTiles(world: World): Uint8Array {
  const out = new Uint8Array(world.terrain.grid.count);
  for (let i = 0; i < out.length; i++) {
    if (i === world.keeper.cell) continue;
    const t = cellTop(world.terrain, i);
    out[i] = lampCanSee(world, { x: t.x, y: t.y + 0.02, z: t.z }, i) ? 1 : 0;
  }
  return out;
}

export type SimEvent =
  | { type: 'drained'; energy: number; mossCell: number }
  | { type: 'lost' };

/** Fixed simulation step. Rotates the beam and drains the player while lit. */
export function step(world: World, dt: number): SimEvent[] {
  if (world.status !== 'playing') return [];
  const events: SimEvent[] = [];
  world.time += dt;
  world.keeper.yaw = wrap(world.keeper.yaw + BEAM.speed * dt);

  if (!playerLit(world)) {
    world.drainClock = 0;
    return events;
  }
  world.drainClock += dt;
  while (world.drainClock >= BEAM.drainInterval) {
    world.drainClock -= BEAM.drainInterval;
    if (world.player.energy <= 0) {
      world.status = 'lost';
      events.push({ type: 'lost' });
      break;
    }
    // Energy is conserved: the drained unit falls back to the land as moss.
    world.player.energy -= 1;
    const mossCell = randomEmptyCell(world);
    if (mossCell >= 0) spawn(world, mossCell, 'moss');
    events.push({ type: 'drained', energy: 1, mossCell });
  }
  return events;
}

function randomEmptyCell(world: World): number {
  const rng = new Rng(world.rngState);
  const n = world.terrain.grid.count;
  let found = -1;
  for (let attempt = 0; attempt < 64 && found < 0; attempt++) {
    const c = rng.int(0, n - 1);
    if (world.stacks[c].length === 0 && c !== world.keeper.cell) found = c;
  }
  world.rngState = rng.state;
  return found;
}
