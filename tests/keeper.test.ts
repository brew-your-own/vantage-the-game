import { describe, expect, it } from 'vitest';
import { applyIntent } from '../src/core/actions';
import { ECOLOGY } from '../src/core/constants';
import { hexDistance } from '../src/core/hex';
import {
  BEAM,
  beamEta,
  keeperSeesBodyAt,
  keeperSightTiles,
  lampVisibleTiles,
  playerInLampSight,
  playerLit,
} from '../src/core/keeper';
import { step } from '../src/core/sim';
import { hiddenFromLamp, pickKeeperCell, pickStartCell } from '../src/core/level';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { type World, createWorld, spawn, totalEnergy } from '../src/core/world';
import { arena } from './helpers/worlds';

/** Long simulations: slow CI runners need more than Vitest's 5 s default. */
const SLOW = 30_000;

const run = (w: World, seconds: number, dt = 0.05) => {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...step(w, dt));
  return events;
};

/** Hold the beam still while testing drain (rotation is tested separately). */
function frozenBeam<T>(fn: () => T): T {
  const speed = BEAM.speed;
  BEAM.speed = 0;
  try {
    return fn();
  } finally {
    BEAM.speed = speed;
  }
}

describe('placement', () => {
  it('puts the Keeper on the highest tile of the inner map, deterministically', () => {
    for (const seed of [17, 42, 99]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const k = pickKeeperCell(terrain, seed);
      const inner = terrain.grid.cells
        .map((c, i) => ({ i, d: hexDistance(c, { q: 0, r: 0 }) }))
        .filter(({ d }) => d <= terrain.grid.radius * 0.6);
      expect(inner.some(({ i }) => i === k)).toBe(true);
      expect(terrain.heights[k]).toBe(Math.max(...inner.map(({ i }) => terrain.heights[i])));
      expect(pickKeeperCell(terrain, seed)).toBe(k);
    }
  });

  it('starts the player hidden from the Keeper, or with a full beam turn to act', () => {
    for (const seed of [1, 2, 3, 4, 5, 42]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const world = createWorld(terrain, seed);
      expect(world.player.cell).not.toBe(world.keeper.cell);
      expect(world.stacks[world.keeper.cell]).toHaveLength(0);
      if (playerInLampSight(world)) {
        expect(beamEta(world)!).toBeGreaterThan(0.9 * ((2 * Math.PI) / BEAM.speed - (2 * BEAM.halfAngle) / BEAM.speed));
      }
    }
  });

  it('prefers a hidden low start tile when one exists', () => {
    // Seeds 1 and 4 have hidden tiles in their lowest quarter.
    for (const seed of [1, 4]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const world = createWorld(terrain, seed);
      expect(hiddenFromLamp(terrain, world.keeper.cell, world.player.cell)).toBe(true);
      expect(playerInLampSight(world)).toBe(false);
      expect(pickStartCell(terrain, seed, world.keeper.cell)).toBe(world.player.cell);
    }
  });

  it('nothing can be done on the Keeper’s tile', () => {
    const w = arena(10, Math.PI); // beam pointing away
    expect(applyIntent(w, { type: 'place', cell: w.keeper.cell, kind: 'shard' }).ok).toBe(false);
    expect(applyIntent(w, { type: 'harvest', cell: w.keeper.cell }).ok).toBe(false);
  });
});

describe('the beam', () => {
  it('drains one energy per second while lit, and the energy returns as moss', () => {
    const w = arena(5);
    const total = totalEnergy(w);
    expect(playerLit(w)).toBe(true);
    const events = frozenBeam(() => run(w, 3));
    expect(w.player.energy).toBe(2);
    expect(events.filter((e) => e.type === 'drained')).toHaveLength(3);
    expect(totalEnergy(w)).toBe(total);
  });

  it('does nothing when it points elsewhere', () => {
    const w = arena(5, Math.PI);
    expect(playerLit(w)).toBe(false);
    frozenBeam(() => run(w, 5));
    expect(w.player.energy).toBe(5);
  });

  it('is blocked by a Shard wall (shadow)', () => {
    const w = arena(5);
    const wall = w.terrain.grid.indexOf(2, 0);
    for (let i = 0; i < 4; i++) spawn(w, wall, 'shard');
    expect(playerInLampSight(w)).toBe(false);
    expect(playerLit(w)).toBe(false);
    expect(beamEta(w)).toBeNull();
    frozenBeam(() => run(w, 5));
    expect(w.player.energy).toBe(5);
  });

  it('kills the Wisp when lit with no energy left', () => {
    const w = arena(1);
    const events = frozenBeam(() => run(w, 2.5));
    expect(w.player.energy).toBe(0);
    expect(w.status).toBe('lost');
    expect(events.some((e) => e.type === 'lost')).toBe(true);
    expect(applyIntent(w, { type: 'scatter' }).ok).toBe(false);
  });

  it('predicts when it will arrive, and is right', () => {
    const w = arena(5, -1.0); // beam is 1 rad behind the player
    const eta = beamEta(w)!;
    expect(eta).toBeCloseTo((1.0 - BEAM.halfAngle) / BEAM.speed, 5);
    run(w, eta - 0.1);
    expect(playerLit(w)).toBe(false);
    run(w, 0.2);
    expect(playerLit(w)).toBe(true);
    expect(beamEta(w)).toBe(0);
  });

  it('holds the Wisp once it finds it, draining steadily', () => {
    const w = arena(50, -0.5);
    const rate = ECOLOGY.hatchRate;
    ECOLOGY.hatchRate = 0;
    try {
      run(w, 36);
    } finally {
      ECOLOGY.hatchRate = rate;
    }
    // The beam reaches the Wisp within a few seconds, then never lets go.
    const reach = (0.5 - BEAM.halfAngle) / BEAM.speed;
    expect(w.keeper.locked).toBe(true);
    expect(50 - w.player.energy).toBeGreaterThanOrEqual(Math.floor(36 - reach) - 1);
    expect(playerLit(w)).toBe(true);
  });

  it('lets go when the lamp loses sight of the Wisp, and sweeps on', () => {
    const w = arena(50, -0.5);
    run(w, 5);
    expect(w.keeper.locked).toBe(true);
    // A wall between the Keeper (0,0) and the Wisp (3,0).
    for (let i = 0; i < 8; i++) spawn(w, w.terrain.grid.indexOf(2, 0), 'shard');
    const yaw = w.keeper.yaw;
    run(w, 1);
    expect(w.keeper.locked).toBe(false);
    expect(w.keeper.yaw).toBeCloseTo(yaw + BEAM.speed, 1);
  });

  it('lets go as soon as the Wisp transfers out of the beam, even in open ground', () => {
    const w = arena(50, -0.5);
    run(w, 5);
    expect(w.keeper.locked).toBe(true);
    // Move the body to the far side of the Keeper: still in the lamp's sight, but not in the beam.
    const body = w.stacks[w.player.cell].pop()!;
    const away = w.terrain.grid.indexOf(-3, 0);
    w.stacks[away].push(body);
    w.player.cell = away;
    expect(playerInLampSight(w)).toBe(true);
    expect(playerLit(w)).toBe(false);
    const yaw = w.keeper.yaw;
    run(w, 1);
    expect(w.keeper.locked).toBe(false);
    expect(w.keeper.yaw).toBeCloseTo(yaw + BEAM.speed, 1);
  });

  it('holds an empty Husk it finds, drains it into moss, then sweeps on', () => {
    const w = arena(5, Math.PI); // pointing away from the Wisp, at (-3,0)
    const husk = w.terrain.grid.indexOf(-3, 0);
    spawn(w, husk, 'husk');
    const total = totalEnergy(w);
    const moss = () => w.stacks.filter((s) => s[0]?.kind === 'moss').length;
    const rate = ECOLOGY.hatchRate;
    ECOLOGY.hatchRate = 0;
    try {
      run(w, 1.5);
      expect(w.keeper.husk).toBe(husk);
      expect(w.keeper.yaw).toBeCloseTo(Math.PI, 1);
      expect(w.stacks[husk][0].drained).toBe(1);
      run(w, 1.6);
      expect(w.stacks[husk]).toHaveLength(0);
      expect(moss()).toBe(3);
      expect(totalEnergy(w)).toBe(total);
      expect(w.player.energy).toBe(5);
      const yaw = w.keeper.yaw;
      run(w, 1);
      expect(w.keeper.husk).toBeUndefined();
      expect(w.keeper.yaw).toBeCloseTo(yaw + BEAM.speed, 1);
    } finally {
      ECOLOGY.hatchRate = rate;
    }
  });

  it('a Husk left behind in the beam is a decoy: the beam drains it instead of following', () => {
    const w = arena(50, -0.5);
    run(w, 5);
    expect(w.keeper.locked).toBe(true);
    const old = w.player.cell;
    // Transfer to a new Husk on the far side, leaving the old one in the beam.
    const away = w.terrain.grid.indexOf(-3, 0);
    spawn(w, away, 'husk');
    w.player.cell = away;
    run(w, 0.5);
    expect(w.keeper.locked).toBe(false);
    expect(w.keeper.husk).toBe(old);
    run(w, 3);
    expect(w.stacks[old]).toHaveLength(0);
    expect(w.keeper.husk).toBeUndefined();
  });

  it('leaves a Husk for the Wisp', () => {
    const w = arena(50, 0.2);
    const husk = w.terrain.grid.indexOf(3, -1); // just beside the Wisp at (3,0)
    spawn(w, husk, 'husk');
    run(w, 0.5);
    expect(w.keeper.locked).toBe(true);
    expect(w.keeper.husk).toBeUndefined();
  });

  it('lamp visibility of tiles respects shadows', () => {
    const w = arena();
    // The player's own Husk at (3,0) already shades (4,0) behind it.
    expect(lampVisibleTiles(w)[w.terrain.grid.indexOf(4, 0)]).toBe(0);
    const behind = w.terrain.grid.indexOf(0, 4);
    expect(lampVisibleTiles(w)[behind]).toBe(1);
    for (let i = 0; i < 6; i++) spawn(w, w.terrain.grid.indexOf(0, 2), 'shard');
    expect(lampVisibleTiles(w)[behind]).toBe(0);
  });

  it('is deterministic', () => {
    const play = () => {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 9 });
      const w = createWorld(terrain, 9);
      run(w, 60);
      return [w.keeper.yaw, w.player.energy, w.rngState];
    };
    expect(play()).toEqual(play());
  }, SLOW);
});

describe("the Keeper's sight overlay", () => {
  it('agrees with the exposure check wherever the player stands', () => {
    const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 42 });
    const w = createWorld(terrain, 42);
    const sight = keeperSightTiles(w);
    const start = w.player.cell;
    expect(sight[start]).toBe(playerInLampSight(w) ? 1 : 0);
    // Move the body to a few other tiles and compare.
    const body = w.stacks[start].pop()!;
    let checked = 0;
    for (let i = 0; i < terrain.grid.count && checked < 40; i += 13) {
      if (w.stacks[i].length || i === w.keeper.cell) continue;
      w.stacks[i].push(body);
      w.player.cell = i;
      expect(playerInLampSight(w)).toBe(keeperSeesBodyAt(w, i));
      w.stacks[i].pop();
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // Both kinds of tiles exist on a real level.
    expect(sight.some((v) => v === 1)).toBe(true);
    expect(sight.some((v, i) => v === 0 && i !== w.keeper.cell)).toBe(true);
  });

  it('a Shard wall turns a tile from seen to hidden', () => {
    const w = arena(5, Math.PI);
    const spot = w.terrain.grid.indexOf(0, 3);
    expect(keeperSightTiles(w)[spot]).toBe(1);
    for (let i = 0; i < 4; i++) spawn(w, w.terrain.grid.indexOf(0, 2), 'shard');
    expect(keeperSightTiles(w)[spot]).toBe(0);
  });
});
