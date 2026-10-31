import { beforeEach, describe, expect, it } from 'vitest';
import { applyIntent } from '../src/core/actions';
import { BEAM, ECOLOGY, RELAY_ENERGY } from '../src/core/constants';
import { hexDistance } from '../src/core/hex';
import { beamEta, playerLit } from '../src/core/keeper';
import { step } from '../src/core/sim';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { type World, beamParams, createWorld, keeperDark, spawn, totalEnergy } from '../src/core/world';
import { arena, at, flatWorld } from './helpers/worlds';

const run = (w: World, seconds: number, dt = 0.05) => {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...step(w, dt));
  return events;
};

/** Raise the player's body on `n` Shards. */
function raise(w: World, n: number) {
  const body = w.stacks[w.player.cell].pop()!;
  for (let i = 0; i < n; i++) spawn(w, w.player.cell, 'shard');
  w.stacks[w.player.cell].push(body);
}

describe('relay placement', () => {
  it('places the requested Relays away from the Keeper and the start, deterministically', () => {
    for (const seed of [1, 2, 3, 42]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const w = createWorld(terrain, seed, { relays: 4 });
      expect(w.relays).toHaveLength(4);
      const cells = w.relays.map((r) => r.cell);
      expect(new Set(cells).size).toBe(4);
      const g = terrain.grid.cells;
      for (const c of cells) {
        expect(hexDistance(g[c], g[w.keeper.cell])).toBeGreaterThanOrEqual(4);
        expect(hexDistance(g[c], g[w.player.cell])).toBeGreaterThanOrEqual(4);
        expect(w.stacks[c]).toHaveLength(0);
      }
      expect(createWorld(terrain, seed, { relays: 4 }).relays).toEqual(w.relays);
    }
  });
});

describe('draining a Relay', () => {
  let w: World;
  let relay: number;
  beforeEach(() => {
    w = flatWorld(5);
    relay = at(w, 2, 0);
    w.relays.push({ cell: relay, drained: false }, { cell: at(w, -2, 0), drained: false });
  });

  it('needs your eye above its top', () => {
    const r = applyIntent(w, { type: 'harvest', cell: relay });
    expect(r.ok).toBe(false);
    expect(w.relays[0].drained).toBe(false);
  });

  it('gives its energy from above, once, conserving the total', () => {
    raise(w, 2);
    const total = totalEnergy(w);
    const r = applyIntent(w, { type: 'harvest', cell: relay });
    expect(r.ok).toBe(true);
    expect(r.ok && r.events).toEqual([{ type: 'relayDrained', cell: relay, energy: RELAY_ENERGY, remaining: 1 }]);
    expect(w.player.energy).toBe(5 + RELAY_ENERGY);
    expect(totalEnergy(w)).toBe(total);
    expect(applyIntent(w, { type: 'harvest', cell: relay }).ok).toBe(false);
  });

  it('is blocked by a wall in between', () => {
    raise(w, 2);
    for (let i = 0; i < 6; i++) spawn(w, at(w, 1, 0), 'shard');
    expect(applyIntent(w, { type: 'harvest', cell: relay }).ok).toBe(false);
  });

  it('nothing can be placed on a Relay', () => {
    raise(w, 2);
    expect(applyIntent(w, { type: 'place', cell: relay, kind: 'shard' }).ok).toBe(false);
    expect(applyIntent(w, { type: 'transfer', cell: relay }).ok).toBe(false);
  });
});

describe('a weakening Keeper', () => {
  it('narrows and slows the beam with each drained Relay', () => {
    const w = arena(5);
    w.relays.push({ cell: at(w, -3, 0), drained: false }, { cell: at(w, 0, -3), drained: false });
    const full = beamParams(w);
    expect(full).toEqual({ halfAngle: BEAM.halfAngle, speed: BEAM.speed });
    w.relays[0].drained = true;
    const half = beamParams(w);
    expect(half.halfAngle).toBeLessThan(full.halfAngle);
    expect(half.speed).toBeLessThan(full.speed);
  });

  it('goes dark when every Relay is drained: no beam, no turning, no hatching', () => {
    const w = arena(5);
    w.relays.push({ cell: at(w, -3, 0), drained: true });
    expect(keeperDark(w)).toBe(true);
    expect(playerLit(w)).toBe(false);
    expect(beamEta(w)).toBeNull();
    for (let i = 0; i < 10; i++) spawn(w, at(w, -2, 2 + (i % 2)), 'moss');
    const rate = ECOLOGY.hatchRate;
    ECOLOGY.hatchRate = 100;
    try {
      run(w, 5);
    } finally {
      ECOLOGY.hatchRate = rate;
    }
    expect(w.keeper.yaw).toBe(0);
    expect(w.player.energy).toBe(5);
    expect(w.moths).toHaveLength(0);
  });
});

describe('taking the summit', () => {
  it('is refused while the lamp burns', () => {
    const w = arena(5, Math.PI);
    w.relays.push({ cell: at(w, -3, 0), drained: false });
    const r = applyIntent(w, { type: 'transfer', cell: w.keeper.cell });
    expect(r.ok).toBe(false);
    expect(w.status).toBe('playing');
  });

  it('wins the level once the Keeper is dark', () => {
    const w = arena(5, Math.PI);
    w.relays.push({ cell: at(w, -3, 0), drained: true });
    raise(w, 4);
    const r = applyIntent(w, { type: 'transfer', cell: w.keeper.cell });
    expect(r.ok).toBe(true);
    expect(r.ok && r.events).toContainEqual({ type: 'won' });
    expect(w.status).toBe('won');
    expect(w.player.cell).toBe(w.keeper.cell);
    expect(applyIntent(w, { type: 'harvest', cell: at(w, 3, 0) }).ok).toBe(false);
  });
});
