import { BEAM, EYE_HEIGHT } from './constants';

export { BEAM };
import { lampPosition } from './level';
import { cellTop } from './surface';
import { type Vec3, segmentClear } from './visibility';
import { type World, beamParams, columnTop, entityEnergy, keeperDark, playerEye, supportY } from './world';


const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Horizontal bearing from the Keeper's tile to a point (radians, atan2(dz, dx)). */
export function bearingFromKeeper(world: World, p: { x: number; z: number }): number {
  const k = cellTop(world.terrain, world.keeper.cell);
  return Math.atan2(p.z - k.z, p.x - k.x);
}

/** Is a horizontal bearing inside the beam's wedge right now? */
export function inBeamWedge(world: World, bearing: number): boolean {
  if (keeperDark(world)) return false;
  const d = wrap(bearing - world.keeper.yaw + Math.PI) - Math.PI;
  return Math.abs(d) <= beamParams(world).halfAngle;
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
  return keeperSeesBodyAt(world, world.player.cell);
}

/**
 * Would the Keeper see a Wisp standing on `cell` (on top of its Shards)? Checks the head
 * and the feet, like playerInLampSight, so it can be used to plan where to hide.
 */
export function keeperSeesBodyAt(world: World, cell: number): boolean {
  if (cell === world.keeper.cell) return true;
  const top = cellTop(world.terrain, cell);
  const base = supportY(world, cell);
  const head = { x: top.x, y: base + EYE_HEIGHT, z: top.z };
  const feet = { x: top.x, y: base + 0.3, z: top.z };
  return lampCanSee(world, head, cell) || lampCanSee(world, feet, cell);
}

/** keeperSeesBodyAt for every tile (the Keeper's own tile excluded). */
export function keeperSightTiles(world: World): Uint8Array {
  const out = new Uint8Array(world.terrain.grid.count);
  for (let i = 0; i < out.length; i++) {
    if (i !== world.keeper.cell) out[i] = keeperSeesBodyAt(world, i) ? 1 : 0;
  }
  return out;
}

/** Is there an empty Husk (not the Wisp's body) on `cell` that the beam lights right now? */
export function huskInBeam(world: World, cell: number): boolean {
  const stack = world.stacks[cell];
  if (cell === world.player.cell || stack[stack.length - 1]?.kind !== 'husk') return false;
  return inBeamWedge(world, bearingFromKeeper(world, cellTop(world.terrain, cell))) && keeperSeesBodyAt(world, cell);
}

/** The first empty Husk the beam lights, if any. */
export function findLitHusk(world: World): number | undefined {
  for (let i = 0; i < world.stacks.length; i++) if (huskInBeam(world, i)) return i;
  return undefined;
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
  if (keeperDark(world) || !playerInLampSight(world)) return null;
  const bearing = bearingFromKeeper(world, playerEye(world));
  if (inBeamWedge(world, bearing)) return 0;
  const beam = beamParams(world);
  // Busy draining a Husk, the beam waits until the Husk is empty, then sweeps on from there.
  const husk = world.keeper.husk;
  const stack = husk === undefined ? [] : world.stacks[husk];
  const hold = husk === undefined ? 0 : (entityEnergy(stack[stack.length - 1]) * BEAM.drainInterval - world.drainClock) / (world.drainScale ?? 1);
  return hold + wrap(bearing - beam.halfAngle - world.keeper.yaw) / beam.speed;
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
