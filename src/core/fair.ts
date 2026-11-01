import { keeperSightTiles, playerInLampSight } from './keeper';
import { Rng } from './rng';
import { DEFAULT_TERRAIN, generateTerrain } from './terrain';
import { type World, type WorldOptions, createWorld } from './world';

/** Tiles out of the Keeper's sight a fair level must offer (Keeper and Relays excluded). */
export const MIN_HIDDEN = 20;

/** Tiles where a Wisp would be hidden from the Keeper (its own and Relay tiles excluded). */
export function hiddenTiles(world: World): number {
  const sight = keeperSightTiles(world);
  let hidden = 0;
  sight.forEach((v, i) => {
    if (!v && i !== world.keeper.cell && !world.relays.some((r) => r.cell === i)) hidden++;
  });
  return hidden;
}

/**
 * A level is fair when every Relay found a place, the Wisp starts out of the Keeper's
 * sight, and the land offers enough other hiding places. Many codes fail this: the
 * Keeper sees most of the map from its peak.
 */
export function isFairWorld(world: World, relays: number): boolean {
  return world.relays.length >= relays && !playerInLampSight(world) && hiddenTiles(world) >= MIN_HIDDEN;
}

export function isFairCode(code: number, options: WorldOptions): boolean {
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: code });
  return isFairWorld(createWorld(terrain, code, options), options.relays);
}

/** Largest level code handed out at random. */
export const MAX_RANDOM_CODE = 999_999;

/**
 * A random fair level code. `random` gives numbers in [0, 1) (Math.random in the game, a
 * seeded Rng in tests). Gives up after `tries` rolls and returns the last code.
 */
export function randomFairCode(options: WorldOptions, random: () => number, tries = 60): number {
  let code = 1;
  for (let i = 0; i < tries; i++) {
    code = 1 + Math.floor(random() * MAX_RANDOM_CODE);
    if (isFairCode(code, options)) return code;
  }
  return code;
}

/** Deterministic `random` for tests and scripts. */
export const seededRandom = (seed: number) => {
  const rng = new Rng(seed);
  return () => rng.next();
};
