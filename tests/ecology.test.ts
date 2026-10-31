import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyIntent, canAct } from '../src/core/actions';
import { BEAM, ECOLOGY, SPIRE_GROW_TIME, SPIRE_MAX_LEVEL, SPIRE_STEP } from '../src/core/constants';
import { Rng } from '../src/core/rng';
import { step } from '../src/core/sim';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import {
  type World,
  columnTop,
  createWorld,
  playerEye,
  spawn,
  spawnMoth,
  supportY,
  topOf,
  totalEnergy,
} from '../src/core/world';
import { arena, at, flatWorld } from './helpers/worlds';

const run = (w: World, seconds: number, dt = 0.05) => {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...step(w, dt));
  return events;
};

// Keep the beam still and pointing away unless a test says otherwise.
const saved = { speed: BEAM.speed, hatch: ECOLOGY.hatchRate };
beforeEach(() => {
  BEAM.speed = 0;
});
afterEach(() => {
  BEAM.speed = saved.speed;
  ECOLOGY.hatchRate = saved.hatch;
});

/** Flat world whose Keeper beam points away from everything we test. */
function calmWorld(energy = 10): World {
  const w = flatWorld(energy);
  w.keeper.yaw = Math.PI; // keeper sits at the (5,-5) corner; the beam points off the map
  return w;
}

describe('Spires', () => {
  it('grow one level per feed, over time, and hold all energy fed', () => {
    const w = calmWorld(10);
    const c = at(w, 2, 0);
    const total = totalEnergy(w);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'seed' }).ok).toBe(true);
    expect(applyIntent(w, { type: 'feed', cell: c }).ok).toBe(true);
    expect(w.player.energy).toBe(10 - 2 - 1);
    // Growing: nothing can be stacked on it yet, and it can't be fed again.
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'husk' })).toEqual({ ok: false, reason: 'still growing' });
    expect(applyIntent(w, { type: 'feed', cell: c })).toEqual({ ok: false, reason: 'still growing' });
    const before = supportY(w, c);
    const events = run(w, SPIRE_GROW_TIME + 0.1);
    expect(events.some((e) => e.type === 'spireGrew')).toBe(true);
    expect(topOf(w, c)?.level).toBe(1);
    expect(supportY(w, c)).toBeCloseTo(before + SPIRE_STEP);
    expect(columnTop(w, c)).toBeCloseTo(before + SPIRE_STEP);
    expect(totalEnergy(w)).toBe(total);
  });

  it('stop at the maximum level', () => {
    const w = calmWorld(20);
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'seed' });
    for (let i = 0; i < SPIRE_MAX_LEVEL; i++) {
      expect(applyIntent(w, { type: 'feed', cell: c }).ok).toBe(true);
      run(w, SPIRE_GROW_TIME + 0.1);
    }
    expect(applyIntent(w, { type: 'feed', cell: c })).toEqual({ ok: false, reason: 'fully grown' });
  });

  it('give back everything fed when harvested, even mid-growth', () => {
    const w = calmWorld(10);
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'seed' });
    applyIntent(w, { type: 'feed', cell: c });
    run(w, SPIRE_GROW_TIME + 0.1);
    applyIntent(w, { type: 'feed', cell: c });
    run(w, 0.5); // still growing its 2nd level
    expect(applyIntent(w, { type: 'harvest', cell: c }).ok).toBe(true);
    expect(w.player.energy).toBe(10);
    expect(w.stacks[c]).toHaveLength(0);
  });

  it('can carry a Husk to transfer into, raising the eye', () => {
    const w = calmWorld(20);
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'seed' });
    applyIntent(w, { type: 'feed', cell: c });
    run(w, SPIRE_GROW_TIME + 0.1);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'husk' }).ok).toBe(true);
    const eyeBefore = playerEye(w).y;
    expect(applyIntent(w, { type: 'transfer', cell: c }).ok).toBe(true);
    expect(playerEye(w).y).toBeCloseTo(eyeBefore + SPIRE_STEP);
  });

  it('can be ridden: transfer onto a grown Spire, then feed it to rise', () => {
    const w = calmWorld(20);
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'seed' });
    for (let i = 0; i < 3; i++) {
      applyIntent(w, { type: 'feed', cell: c });
      run(w, SPIRE_GROW_TIME + 0.1);
    }
    // Level 3 is far above our eye: no Husk can be put on top, but we can move onto it.
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'husk' })).toEqual({ ok: false, reason: 'out of sight' });
    const eyeBefore = playerEye(w).y;
    const total = totalEnergy(w);
    expect(applyIntent(w, { type: 'transfer', cell: c }).ok).toBe(true);
    expect(playerEye(w).y).toBeCloseTo(eyeBefore + 3 * SPIRE_STEP);
    expect(totalEnergy(w)).toBe(total);
  });

  it('can be fed from on top, lifting the Wisp as it grows', () => {
    const w = calmWorld(20);
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'seed' });
    applyIntent(w, { type: 'feed', cell: c });
    run(w, SPIRE_GROW_TIME + 0.1);
    expect(applyIntent(w, { type: 'transfer', cell: c }).ok).toBe(true);
    const eye1 = playerEye(w).y;
    expect(applyIntent(w, { type: 'feed', cell: c }).ok).toBe(true);
    expect(playerEye(w).y).toBeCloseTo(eye1); // still level 1 while growing
    run(w, SPIRE_GROW_TIME + 0.1);
    expect(playerEye(w).y).toBeCloseTo(eye1 + SPIRE_STEP);
  });

  it('cannot be moved onto while growing', () => {
    const w = calmWorld(20);
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'seed' });
    applyIntent(w, { type: 'feed', cell: c });
    run(w, SPIRE_GROW_TIME + 0.1);
    applyIntent(w, { type: 'feed', cell: c });
    expect(applyIntent(w, { type: 'transfer', cell: c })).toEqual({ ok: false, reason: 'still growing' });
  });

  it('block line of sight once grown', () => {
    const w = calmWorld(30);
    const wall = at(w, 1, 0);
    const behind = at(w, 3, 0);
    spawn(w, behind, 'moss');
    expect(canAct(w, behind)).toBe(true);
    applyIntent(w, { type: 'place', cell: wall, kind: 'seed' });
    for (let i = 0; i < 2; i++) {
      applyIntent(w, { type: 'feed', cell: wall });
      run(w, SPIRE_GROW_TIME + 0.1);
    }
    expect(canAct(w, behind)).toBe(false);
  });
});

describe('Moths', () => {
  it('hatch from moss in the beam, not from moss in the dark', () => {
    ECOLOGY.hatchRate = 1000; // certain within a step
    const w = arena(5, Math.PI / 2); // beam points toward +Z (r increasing)
    const lit = w.terrain.grid.indexOf(-1, 3); // bearing ≈ 90° from the Keeper
    const dark = w.terrain.grid.indexOf(-3, 0); // due west: outside the wedge
    spawn(w, lit, 'moss');
    spawn(w, dark, 'moss');
    const total = totalEnergy(w);
    const events = run(w, 0.05);
    expect(events.some((e) => e.type === 'hatched' && e.cell === lit)).toBe(true);
    expect(w.stacks[lit]).toHaveLength(0);
    expect(w.stacks[dark]).toHaveLength(1);
    expect(w.moths.map((m) => m.cell)).toEqual([lit]);
    expect(totalEnergy(w)).toBe(total);
  });

  it('drift to moss and eat it', () => {
    const w = calmWorld(0); // a Wisp with no energy is no lure
    const moth = spawnMoth(w, at(w, -4, 2), 1);
    for (const [q, r] of [[-1, 2], [-1, 3], [0, 2]]) spawn(w, at(w, q, r), 'moss');
    const total = totalEnergy(w);
    run(w, ECOLOGY.mothStep * 8);
    expect(moth.energy).toBeGreaterThan(1);
    expect(totalEnergy(w)).toBe(total);
  });

  it('are drawn to the Wisp and drain it while sharing its tile', () => {
    const w = calmWorld(10);
    const moth = spawnMoth(w, at(w, 3, 0), 1);
    const total = totalEnergy(w);
    run(w, ECOLOGY.mothStep * 5); // enough to fly 3 tiles and start feeding
    expect(moth.cell).toBe(w.player.cell);
    expect(w.player.energy).toBeLessThan(10);
    expect(moth.energy).toBe(1 + (10 - w.player.energy));
    expect(totalEnergy(w)).toBe(total);
  });

  it('settle when full and lay their energy as moss nearby', () => {
    const w = calmWorld(0);
    const cell = at(w, -3, 3);
    const moth = spawnMoth(w, cell, ECOLOGY.layAt - 1);
    spawn(w, at(w, -2, 3), 'moss'); // one more meal makes it full
    const total = totalEnergy(w);
    const events = run(w, ECOLOGY.mothStep * 4);
    const laid = events.find((e) => e.type === 'mothLaid');
    expect(laid).toBeDefined();
    expect(w.moths).not.toContain(moth);
    const moss = w.stacks.filter((s) => s[0]?.kind === 'moss').length;
    expect(moss).toBe(ECOLOGY.layAt);
    expect(totalEnergy(w)).toBe(total);
  });

  it('settle even when the tiles around them are taken', () => {
    const w = calmWorld(0);
    const cell = at(w, -3, 3);
    // Fill everything within 3 tiles with Shards.
    const here = w.terrain.grid.cells[cell];
    w.terrain.grid.cells.forEach((c, i) => {
      const d = (Math.abs(c.q - here.q) + Math.abs(c.r - here.r) + Math.abs(c.q + c.r - here.q - here.r)) / 2;
      if (d <= 3 && i !== cell && w.stacks[i].length === 0) spawn(w, i, 'shard');
    });
    const moth = spawnMoth(w, cell, ECOLOGY.layAt);
    const total = totalEnergy(w);
    run(w, ECOLOGY.mothStep + 0.1);
    expect(w.moths).not.toContain(moth);
    expect(totalEnergy(w)).toBe(total);
  });

  it('can be swatted on your own tile for all their energy', () => {
    const w = calmWorld(5);
    spawnMoth(w, w.player.cell, 3);
    expect(applyIntent(w, { type: 'harvest', cell: w.player.cell }).ok).toBe(true);
    expect(w.player.energy).toBe(8);
    expect(w.moths).toHaveLength(0);
  });

  it('come before the stack when harvesting a tile', () => {
    const w = calmWorld(0);
    const c = at(w, 2, 0);
    spawn(w, c, 'shard');
    spawnMoth(w, c, 2);
    applyIntent(w, { type: 'harvest', cell: c });
    expect(w.player.energy).toBe(2);
    expect(topOf(w, c)?.kind).toBe('shard');
  });

  it('end the game if they drain a Wisp with nothing left', () => {
    const w = calmWorld(0);
    spawnMoth(w, w.player.cell, 1);
    const events = run(w, 1.1);
    expect(w.status).toBe('lost');
    expect(events).toContainEqual({ type: 'lost', cause: 'moth' });
  });
});

describe('the living world', () => {
  it('conserves energy through minutes of play with random actions', () => {
    BEAM.speed = saved.speed;
    for (const seed of [5, 6]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const w = createWorld(terrain, seed);
      w.player.energy = 30;
      const total = totalEnergy(w);
      const rng = new Rng(seed);
      let hatched = 0;
      for (let tick = 0; tick < 20 * 240 && w.status === 'playing'; tick++) {
        for (const e of step(w, 0.05)) if (e.type === 'hatched') hatched++;
        if (tick % 10 === 0) {
          const cell = rng.int(0, terrain.grid.count - 1);
          const roll = rng.next();
          applyIntent(
            w,
            roll < 0.4
              ? { type: 'harvest', cell }
              : roll < 0.6
                ? { type: 'place', cell, kind: rng.pick(['shard', 'seed', 'husk'] as const) }
                : roll < 0.8
                  ? { type: 'feed', cell }
                  : { type: 'transfer', cell },
          );
        }
        expect(totalEnergy(w)).toBe(total);
      }
      expect(hatched).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    BEAM.speed = saved.speed;
    const play = () => {
      const w = createWorld(generateTerrain({ ...DEFAULT_TERRAIN, seed: 12 }), 12);
      run(w, 120);
      return JSON.stringify([w.moths, w.stacks, w.player, w.rngState]);
    };
    expect(play()).toBe(play());
  });
});
