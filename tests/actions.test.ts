import { describe, expect, it } from 'vitest';
import { SCATTER_COST, applyIntent, canAct, occludersOf } from '../src/core/actions';
import { Rng } from '../src/core/rng';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { castRay, canSeeCell, eyeAt } from '../src/core/visibility';
import {
  ENERGY,
  type EntityKind,
  isBody,
  createWorld,
  playerEye,
  spawn,
  supportY,
  topOf,
  totalEnergy,
} from '../src/core/world';
import { at, flatWorld } from './helpers/worlds';

describe('harvest', () => {
  it('takes the top object and its energy', () => {
    const w = flatWorld(5);
    const c = at(w, 2, 0);
    spawn(w, c, 'moss');
    const before = totalEnergy(w);
    expect(applyIntent(w, { type: 'harvest', cell: c }).ok).toBe(true);
    expect(w.player.energy).toBe(6);
    expect(w.stacks[c]).toHaveLength(0);
    expect(totalEnergy(w)).toBe(before);
  });

  it('takes stacks one object at a time, from the top', () => {
    const w = flatWorld(0);
    const c = at(w, 2, 0);
    spawn(w, c, 'shard');
    spawn(w, c, 'husk');
    applyIntent(w, { type: 'harvest', cell: c });
    expect(w.player.energy).toBe(ENERGY.husk);
    expect(topOf(w, c)?.kind).toBe('shard');
  });

  it('refuses empty tiles, your own tile, and hidden tiles', () => {
    const w = flatWorld();
    expect(applyIntent(w, { type: 'harvest', cell: at(w, 1, 0) }).ok).toBe(false);
    expect(applyIntent(w, { type: 'harvest', cell: w.player.cell }).ok).toBe(false);

    // A tall wall of shards at (1,0) hides the moss at (3,0).
    const hidden = at(w, 3, 0);
    spawn(w, hidden, 'moss');
    for (let i = 0; i < 5; i++) spawn(w, at(w, 1, 0), 'shard');
    const r = applyIntent(w, { type: 'harvest', cell: hidden });
    expect(r).toEqual({ ok: false, reason: 'out of sight' });
  });
});

describe('place', () => {
  it('spends energy to create objects', () => {
    const w = flatWorld(10);
    const c = at(w, 2, -1);
    const before = totalEnergy(w);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'shard' }).ok).toBe(true);
    expect(w.player.energy).toBe(10 - ENERGY.shard);
    expect(totalEnergy(w)).toBe(before);
  });

  it('stacks on shards only', () => {
    const w = flatWorld(20);
    const c = at(w, 2, 0);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'shard' }).ok).toBe(true);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'shard' }).ok).toBe(true);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'husk' }).ok).toBe(true);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'shard' })).toEqual({ ok: false, reason: 'occupied by husk' });
    expect(w.stacks[c].map((e) => e.kind)).toEqual(['shard', 'shard', 'husk']);
  });

  it('refuses without enough energy, on moss, or where you stand', () => {
    const w = flatWorld(1);
    expect(applyIntent(w, { type: 'place', cell: at(w, 1, 0), kind: 'shard' }).ok).toBe(false);
    w.player.energy = 10;
    spawn(w, at(w, 1, 0), 'moss');
    expect(applyIntent(w, { type: 'place', cell: at(w, 1, 0), kind: 'shard' }).ok).toBe(false);
    expect(applyIntent(w, { type: 'place', cell: w.player.cell, kind: 'shard' }).ok).toBe(false);
    expect(applyIntent(w, { type: 'place', cell: at(w, 2, 0), kind: 'moss' }).ok).toBe(false);
  });

  it('cannot place on top of a stack taller than your eye', () => {
    const w = flatWorld(30);
    const c = at(w, 1, 0);
    for (let i = 0; i < 4; i++) applyIntent(w, { type: 'place', cell: c, kind: 'shard' });
    expect(supportY(w, c)).toBeGreaterThan(playerEye(w).y);
    expect(applyIntent(w, { type: 'place', cell: c, kind: 'shard' })).toEqual({ ok: false, reason: 'out of sight' });
    // ...but its tile is in view, so the tower can still be taken apart.
    expect(applyIntent(w, { type: 'harvest', cell: c }).ok).toBe(true);
  });
});

describe('transfer', () => {
  it('moves the Wisp into a visible husk; the old body stays', () => {
    const w = flatWorld(10);
    const start = w.player.cell;
    const c = at(w, 2, 0);
    applyIntent(w, { type: 'place', cell: c, kind: 'shard' });
    applyIntent(w, { type: 'place', cell: c, kind: 'husk' });
    const before = totalEnergy(w);
    expect(applyIntent(w, { type: 'transfer', cell: c }).ok).toBe(true);
    expect(w.player.cell).toBe(c);
    expect(topOf(w, start)?.kind).toBe('husk');
    expect(totalEnergy(w)).toBe(before);
    // Standing on a shard raises the eye by one shard.
    expect(playerEye(w).y).toBeCloseTo(eyeAt(w.terrain, c).y + supportY(w, c) - supportY(w, start));
    // And the old body can now be harvested for its energy.
    expect(applyIntent(w, { type: 'harvest', cell: start }).ok).toBe(true);
  });

  it('requires a husk', () => {
    const w = flatWorld();
    const c = at(w, 2, 0);
    spawn(w, c, 'moss');
    expect(applyIntent(w, { type: 'transfer', cell: c })).toEqual({ ok: false, reason: 'no husk or spire there' });
  });
});

describe('scatter', () => {
  it('lands on a lower empty tile and conserves energy', () => {
    const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 21 });
    const w = createWorld(terrain, 21);
    // Stand somewhere high first.
    let highest = 0;
    terrain.heights.forEach((h, i) => {
      if (h > terrain.heights[highest]) highest = i;
    });
    w.stacks[w.player.cell].length = 0;
    w.stacks[highest].length = 0;
    w.player.cell = highest;
    spawn(w, highest, 'husk');

    const before = totalEnergy(w);
    const r = applyIntent(w, { type: 'scatter' });
    expect(r.ok).toBe(true);
    expect(w.player.cell).not.toBe(highest);
    expect(terrain.heights[w.player.cell]).toBeLessThan(terrain.heights[highest]);
    expect(w.player.energy).toBe(10 - SCATTER_COST);
    expect(totalEnergy(w)).toBe(before);
  });

  it('is deterministic and fails without energy', () => {
    const run = () => {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 8 });
      const w = createWorld(terrain, 8);
      w.player.energy = 100;
      w.player.cell = w.terrain.heights.indexOf(Math.max(...w.terrain.heights));
      applyIntent(w, { type: 'scatter' });
      return w.player.cell;
    };
    expect(run()).toBe(run());
    const w = flatWorld(2);
    expect(applyIntent(w, { type: 'scatter' }).ok).toBe(false);
  });
});

describe('occlusion and picking', () => {
  it('object columns block sight but not of their own cell', () => {
    const w = flatWorld(20);
    const wall = at(w, 1, 0);
    const behind = at(w, 3, 0);
    const occ = occludersOf(w);
    const eye = playerEye(w);
    expect(canSeeCell(w.terrain, eye, behind, occ, w.player.cell)).toBe(true);
    spawn(w, wall, 'shard');
    spawn(w, wall, 'husk');
    expect(canSeeCell(w.terrain, eye, behind, occ, w.player.cell)).toBe(false);
    expect(canAct(w, wall)).toBe(true);
  });

  it('rays hit object columns before the terrain behind them', () => {
    const w = flatWorld(20);
    const wall = at(w, 2, 0);
    spawn(w, wall, 'shard');
    spawn(w, wall, 'husk');
    const eye = playerEye(w);
    const hit = castRay(w.terrain, eye, { x: 1, y: 0, z: 0 }, occludersOf(w), w.player.cell);
    expect(hit?.kind).toBe('object');
    expect(hit?.cell).toBe(wall);
    // Looking straight down ignores our own body.
    const down = castRay(w.terrain, eye, { x: 0, y: -1, z: 0 }, occludersOf(w), w.player.cell);
    expect(down?.cell).toBe(w.player.cell);
    expect(down?.kind).toBe('top');
  });
});

describe('createWorld', () => {
  it('is deterministic, places the player in a husk, and scatters moss', () => {
    const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 3 });
    const a = createWorld(terrain, 3);
    const b = createWorld(terrain, 3);
    expect(a.stacks.map((s) => s.map((e) => e.kind))).toEqual(b.stacks.map((s) => s.map((e) => e.kind)));
    expect(topOf(a, a.player.cell)?.kind).toBe('husk');
    const moss = a.stacks.filter((s) => s[0]?.kind === 'moss').length;
    expect(moss).toBeGreaterThan(20);
  });
});

describe('energy conservation (fuzz)', () => {
  it('holds over thousands of random intents', () => {
    for (const seed of [1, 2, 3]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const w = createWorld(terrain, seed);
      const rng = new Rng(seed * 77);
      const total = totalEnergy(w);
      const kinds: EntityKind[] = ['shard', 'husk', 'seed'];
      let succeeded = 0;
      const reasons: Record<string, number> = {};
      for (let step = 0; step < 3000; step++) {
        // Pick nearby cells, and aim harvests/transfers at cells that hold something,
        // so that a good share of intents are legal.
        const near = terrain.grid.cells[w.player.cell];
        const nearby: number[] = [];
        for (let dq = -3; dq <= 3; dq++)
          for (let dr = -3; dr <= 3; dr++) {
            const c = terrain.grid.indexOf(near.q + dq, near.r + dr);
            if (c >= 0) nearby.push(c);
          }
        const occupied = nearby.filter((c) => c !== w.player.cell && w.stacks[c].length > 0);
        if (occupied.length === 0) occupied.push(...nearby);
        const roll = rng.next();
        const result = applyIntent(
          w,
          roll < 0.45
            ? { type: 'harvest', cell: rng.pick(occupied) }
            : roll < 0.8
              ? { type: 'place', cell: rng.pick(nearby), kind: rng.pick(kinds) }
              : roll < 0.97
                ? { type: 'transfer', cell: rng.pick(occupied) }
                : { type: 'scatter' },
        );
        if (result.ok) succeeded++;
        else reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
        expect(totalEnergy(w)).toBe(total);
        expect(w.player.energy).toBeGreaterThanOrEqual(0);
        expect(isBody(topOf(w, w.player.cell))).toBe(true);
      }
      expect(succeeded, JSON.stringify(reasons)).toBeGreaterThan(300);
    }
  });
});
