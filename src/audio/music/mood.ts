import { hexDistance } from '../../core/hex';
import { beamEta, playerLit } from '../../core/keeper';
import { lampPosition } from '../../core/level';
import { type World, keeperDark, playerEye } from '../../core/world';

/** The game state as the music hears it: every signal in 0..1. */
export interface Mood {
  /** In the beam (1), or how soon it arrives. */
  exposure: number;
  /** Energy running out. */
  lowEnergy: number;
  /** Moths near you. */
  threat: number;
  /** Fraction of Relays drained. */
  progress: number;
  /** Height relative to the Keeper's lamp. */
  altitude: number;
  /** Safe: out of the beam, enough energy, no Moths near. */
  calm: number;
}

export const NEUTRAL_MOOD: Mood = { exposure: 0, lowEnergy: 0, threat: 0, progress: 0, altitude: 0, calm: 1 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Seconds of warning over which exposure rises before the beam arrives. */
export const EXPOSURE_WARNING = 8;

/** Raw mood from the world, without smoothing. */
export function moodOf(world: World): Mood {
  const dark = keeperDark(world);
  let exposure = 0;
  if (!dark && world.status === 'playing') {
    if (playerLit(world)) exposure = 1;
    else {
      const eta = beamEta(world);
      if (eta !== null) exposure = eta < EXPOSURE_WARNING ? 0.15 + 0.6 * (1 - eta / EXPOSURE_WARNING) : 0.1;
    }
  }
  const e = world.player.energy;
  const lowEnergy = clamp01((8 - e) / 6);

  const me = world.terrain.grid.cells[world.player.cell];
  let threat = 0;
  for (const m of world.moths) {
    const d = hexDistance(me, world.terrain.grid.cells[m.cell]);
    if (d <= 3) threat += 1 - d / 4;
  }
  threat = clamp01(threat);

  const total = world.relays.length;
  const progress = total === 0 ? 0 : world.relays.filter((r) => r.drained).length / total;

  const lamp = lampPosition(world.terrain, world.keeper.cell);
  const altitude = clamp01((playerEye(world).y - (lamp.y - 6)) / 8);

  const calm = (1 - exposure) * (1 - lowEnergy) * (1 - threat);
  return { exposure, lowEnergy, threat, progress, altitude, calm };
}

/** Seconds to cover ~63% of a change. Danger arrives fast and fades slowly. */
const RISE: Mood = { exposure: 0.25, lowEnergy: 1, threat: 0.6, progress: 2, altitude: 2, calm: 2.5 };
const FALL: Mood = { exposure: 2.5, lowEnergy: 2, threat: 3, progress: 2, altitude: 2, calm: 0.6 };

/** Moves `current` toward `target` over `dt` seconds, so the music never jumps. */
export function smoothMood(current: Mood, target: Mood, dt: number): Mood {
  const out = { ...current };
  for (const k of Object.keys(current) as (keyof Mood)[]) {
    const tau = target[k] > current[k] ? RISE[k] : FALL[k];
    out[k] = current[k] + (target[k] - current[k]) * (1 - Math.exp(-dt / tau));
  }
  return out;
}
