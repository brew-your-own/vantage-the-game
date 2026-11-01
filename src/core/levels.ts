import { CAMPAIGN_CODES } from './campaignData';
import type { World, WorldOptions } from './world';

/** What makes a level: its code (terrain seed), its world options, and the par time. */
export interface LevelSpec {
  code: number;
  relays: number;
  /** Seconds; finishing within par earns a star. */
  par: number;
  /** How the world is set up (Relays, reach, moss, beam, Moths). */
  options: WorldOptions;
}

/** Energy you need left at the summit for the energy star. */
export const ENERGY_STAR = 10;

export const parFor = (relays: number) => 120 + 60 * relays;

/** Relays per campaign level: 3 for the first third, then 4, then 5. */
export function relaysForIndex(index: number): number {
  return index < 7 ? 3 : index < 14 ? 4 : 5;
}

/**
 * The difficulty ramp, from 0 (first campaign level) to 1 (last): Relays must be drained
 * from closer, there is less moss to live on, the beam turns faster and drains harder, and
 * lit moss hatches more Moths. Tuned with the playtest bot (npm run playtest).
 */
export function difficulty(t: number, relays: number): WorldOptions {
  return {
    relays,
    relayReach: Math.round(10 - 3 * t),
    mossDensity: 0.08 - 0.04 * t,
    beamScale: 1 + 0.4 * t,
    drainScale: 1 + 0.6 * t,
    hatchScale: 1 + 1.5 * t,
  };
}

const spec = (code: number, relays: number, t: number): LevelSpec => ({
  code,
  relays,
  par: parFor(relays),
  options: difficulty(t, relays),
});

/** The hand-picked campaign, easiest first. */
export const CAMPAIGN: readonly LevelSpec[] = CAMPAIGN_CODES.map((code, i) =>
  spec(code, relaysForIndex(i), i / (CAMPAIGN_CODES.length - 1)),
);

/** The spec for any level code: the campaign's when it is part of it, mid-campaign otherwise. */
export function specFor(code: number): LevelSpec {
  return CAMPAIGN.find((s) => s.code === code) ?? spec(code, 4, 0.5);
}

/** Index of a code in the campaign, or -1 for a free code. */
export const campaignIndex = (code: number) => CAMPAIGN.findIndex((s) => s.code === code);

/** Stars for a won level: one for winning, one for energy left, one for time within par. */
export function starsFor(world: World, spec: LevelSpec): number {
  if (world.status !== 'won') return 0;
  return 1 + (world.player.energy >= ENERGY_STAR ? 1 : 0) + (world.time <= spec.par ? 1 : 0);
}

/**
 * The tutorial: one Relay (drained from within 10 tiles, like the first campaign level), a
 * half-speed beam that drains at half rate, no Moths until they are taught, and extra energy, on a level whose route is checked by tests
 * (scripts/tutorialRoute.ts). Picked with scripts/pickTutorial.ts.
 */
export const TUTORIAL_OPTIONS: WorldOptions = {
  relays: 1,
  beamScale: 0.5,
  drainScale: 0.5,
  // No Moths hatch until the Moth step is done (see tutorialHatchScale in src/tutorial.ts).
  hatchScale: 0,
  startEnergy: 15,
  relayReach: 10,
};
export const TUTORIAL: LevelSpec = { code: 493, relays: 1, par: 600, options: TUTORIAL_OPTIONS };
