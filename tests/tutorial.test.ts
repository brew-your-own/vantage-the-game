import { describe, expect, it } from 'vitest';
import { isFairCode, randomFairCode, seededRandom } from '../src/core/fair';
import { CAMPAIGN, TUTORIAL, TUTORIAL_OPTIONS } from '../src/core/levels';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { createWorld } from '../src/core/world';
import { step as simStep } from '../src/core/sim';
import { MOTH_STEP, STEPS, type TutorialSignal, advance, tutorialHatchScale } from '../src/tutorial';
import { MAX_CLIMBS, applyStep, tutorialRoute } from '../scripts/tutorialRoute';

const SLOW = 30_000;

describe('the tutorial', () => {
  it('is a fair level, separate from the campaign', () => {
    expect(isFairCode(TUTORIAL.code, TUTORIAL_OPTIONS)).toBe(true);
    expect(CAMPAIGN.some((s) => s.code === TUTORIAL.code)).toBe(false);
  });

  it('can be won by doing exactly what its steps say', () => {
    const route = tutorialRoute(TUTORIAL.code, TUTORIAL_OPTIONS);
    expect(route).not.toBeNull();
    const w = createWorld(generateTerrain({ ...DEFAULT_TERRAIN, seed: TUTORIAL.code }), TUTORIAL.code, TUTORIAL_OPTIONS);
    let step = 0;
    const signal = (s: TutorialSignal) => (step = advance(step, w, s));
    expect(route!.climbs.length).toBeLessThanOrEqual(MAX_CLIMBS);
    signal({ type: 'looked' });
    for (const s of route!.steps) {
      if (s.type === 'hatch') {
        // The sight overlay comes just before the Moth; the game hatches it on that step.
        signal({ type: 'keeperSight' });
        expect(STEPS[step].needsMoth).toBe(true);
      }
      const r = applyStep(w, s);
      expect(r.ok, JSON.stringify(s)).toBe(true);
      if (r.ok) for (const ev of r.events) signal(ev);
    }
    expect(w.status).toBe('won');
    expect(step).toBe(STEPS.length);
  }, SLOW);

  it('hatches no Moths of its own accord until the Moth lesson is done', () => {
    const w = createWorld(generateTerrain({ ...DEFAULT_TERRAIN, seed: TUTORIAL.code }), TUTORIAL.code, TUTORIAL_OPTIONS);
    let hatched = 0;
    for (let t = 0; t < 300; t += 0.05) {
      w.player.energy = 15;
      hatched += simStep(w, 0.05).filter((e) => e.type === 'hatched').length;
    }
    expect(hatched).toBe(0);
    expect(tutorialHatchScale(0)).toBe(0);
    expect(tutorialHatchScale(MOTH_STEP)).toBe(0);
    expect(tutorialHatchScale(MOTH_STEP + 1)).toBe(1);
  }, SLOW);

  it('never gets stuck when things are done early', () => {
    const w = createWorld(generateTerrain({ ...DEFAULT_TERRAIN, seed: TUTORIAL.code }), TUTORIAL.code, TUTORIAL_OPTIONS);
    w.relays[0].drained = true;
    const relayStep = STEPS.findIndex((s) => s.title === 'Drain the Relay');
    expect(advance(relayStep, w)).toBe(relayStep + 1);
  });
});

describe('random level codes', () => {
  it('are always fair', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 5; i++) expect(isFairCode(randomFairCode({ relays: 4 }, random), { relays: 4 })).toBe(true);
  }, SLOW);
});
