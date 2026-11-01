import { CAMPAIGN_CODES } from './campaignData';
import type { World, WorldOptions } from './world';

/** What makes a level: its code (terrain seed), how many Relays, and the par time. */
export interface LevelSpec {
  code: number;
  relays: number;
  /** Seconds; finishing within par earns a star. */
  par: number;
}

/** Energy you need left at the summit for the energy star. */
export const ENERGY_STAR = 10;

export const parFor = (relays: number) => 120 + 60 * relays;

/** Relays per campaign level: 3 for the first third, then 4, then 5. */
export function relaysForIndex(index: number): number {
  return index < 7 ? 3 : index < 14 ? 4 : 5;
}

/** The hand-picked campaign, easiest first. */
export const CAMPAIGN: readonly LevelSpec[] = CAMPAIGN_CODES.map((code, i) => {
  const relays = relaysForIndex(i);
  return { code, relays, par: parFor(relays) };
});

/** The spec for any level code: the campaign's when it is part of it, a default otherwise. */
export function specFor(code: number): LevelSpec {
  return CAMPAIGN.find((s) => s.code === code) ?? { code, relays: 4, par: parFor(4) };
}

/** Index of a code in the campaign, or -1 for a free code. */
export const campaignIndex = (code: number) => CAMPAIGN.findIndex((s) => s.code === code);

/** Stars for a won level: one for winning, one for energy left, one for time within par. */
export function starsFor(world: World, spec: LevelSpec): number {
  if (world.status !== 'won') return 0;
  return 1 + (world.player.energy >= ENERGY_STAR ? 1 : 0) + (world.time <= spec.par ? 1 : 0);
}

/**
 * The tutorial: one Relay, a half-speed beam and extra energy, on a level whose route is
 * checked by tests (scripts/tutorialRoute.ts). Picked with scripts/pickTutorial.ts.
 */
export const TUTORIAL_OPTIONS: WorldOptions = { relays: 1, beamScale: 0.5, startEnergy: 15 };
export const TUTORIAL: LevelSpec = { code: 493, relays: 1, par: 600 };
