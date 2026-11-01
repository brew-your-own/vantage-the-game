import { describe, expect, it } from 'vitest';
import { playerInLampSight } from '../src/core/keeper';
import { CAMPAIGN, ENERGY_STAR, campaignIndex, specFor, starsFor } from '../src/core/levels';
import { solveLevel } from '../scripts/solver';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { createWorld } from '../src/core/world';
import { arena } from './helpers/worlds';

describe('the campaign', () => {
  it('has 20 distinct levels with 3 to 5 Relays, rising', () => {
    expect(CAMPAIGN).toHaveLength(20);
    expect(new Set(CAMPAIGN.map((s) => s.code)).size).toBe(20);
    const relays = CAMPAIGN.map((s) => s.relays);
    expect(relays[0]).toBe(3);
    expect(relays[19]).toBe(5);
    for (let i = 1; i < relays.length; i++) expect(relays[i]).toBeGreaterThanOrEqual(relays[i - 1]);
  });

  it('gets harder: closer reach, less moss, a faster and harsher beam, more Moths', () => {
    const first = CAMPAIGN[0].options;
    const last = CAMPAIGN[CAMPAIGN.length - 1].options;
    expect(last.relayReach!).toBeLessThan(first.relayReach!);
    expect(last.mossDensity!).toBeLessThan(first.mossDensity!);
    expect(last.beamScale!).toBeGreaterThan(first.beamScale!);
    expect(last.drainScale!).toBeGreaterThan(first.drainScale!);
    expect(last.hatchScale!).toBeGreaterThan(first.hatchScale!);
  });

  it('every level can be won (by the playtest bot, with time frozen)', () => {
    for (const spec of CAMPAIGN) expect(solveLevel(spec.code, spec.options).won, `code ${spec.code}`).toBe(true);
  }, 120_000);

  it('every level starts hidden from the Keeper with all its Relays placed', () => {
    for (const spec of CAMPAIGN) {
      const w = createWorld(generateTerrain({ ...DEFAULT_TERRAIN, seed: spec.code }), spec.code, spec.options);
      expect(w.relays).toHaveLength(spec.relays);
      expect(playerInLampSight(w)).toBe(false);
    }
  });

  it('free codes get a default spec', () => {
    expect(campaignIndex(999_999)).toBe(-1);
    expect(specFor(999_999)).toMatchObject({ code: 999_999, relays: 4 });
    expect(specFor(CAMPAIGN[3].code)).toBe(CAMPAIGN[3]);
  });
});

describe('stars', () => {
  const spec = { code: 1, relays: 3, par: 300, options: { relays: 3 } };
  it('none until won, then one per goal', () => {
    const w = arena(ENERGY_STAR);
    expect(starsFor(w, spec)).toBe(0);
    w.status = 'won';
    w.time = 100;
    expect(starsFor(w, spec)).toBe(3);
    w.time = 301;
    expect(starsFor(w, spec)).toBe(2);
    w.player.energy = ENERGY_STAR - 1;
    expect(starsFor(w, spec)).toBe(1);
  });
});
