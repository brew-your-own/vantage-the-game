import { BEAM, ECOLOGY } from './constants';
import { hexDistance } from './hex';
import { bearingFromKeeper, inBeamWedge, lampCanSee, playerLit } from './keeper';
import { Rng } from './rng';
import { cellTop } from './surface';
import { type Moth, type World, columnTop, spawn, spawnMoth, supportY } from './world';

export type LossCause = 'beam' | 'moth';

export type SimEvent =
  | { type: 'drained'; energy: number; mossCell: number }
  | { type: 'leeched'; cell: number }
  | { type: 'hatched'; cell: number }
  | { type: 'mothAte'; cell: number }
  | { type: 'mothLaid'; cell: number; moss: number }
  | { type: 'spireGrew'; cell: number; level: number }
  | { type: 'lost'; cause: LossCause };

/**
 * One fixed simulation step: the beam turns and drains, Spires grow, lit moss hatches,
 * Moths move, eat, drain and lay. Energy is conserved by every rule.
 */
export function step(world: World, dt: number): SimEvent[] {
  if (world.status !== 'playing') return [];
  const events: SimEvent[] = [];
  const rng = new Rng(world.rngState);
  world.time += dt;
  world.keeper.yaw = (world.keeper.yaw + BEAM.speed * dt) % (Math.PI * 2);

  beamDrain(world, dt, rng, events);
  growSpires(world, dt, events);
  hatchMoss(world, dt, rng, events);
  moveMoths(world, dt, rng, events);

  world.rngState = rng.state;
  return events;
}

/** Spends one unit of the Wisp's energy, or ends the game if there is none left. */
function drainWisp(world: World, cause: LossCause, events: SimEvent[]): boolean {
  if (world.status !== 'playing') return false;
  if (world.player.energy <= 0) {
    world.status = 'lost';
    events.push({ type: 'lost', cause });
    return false;
  }
  world.player.energy -= 1;
  return true;
}

function beamDrain(world: World, dt: number, rng: Rng, events: SimEvent[]): void {
  if (!playerLit(world)) {
    world.drainClock = 0;
    return;
  }
  world.drainClock += dt;
  while (world.drainClock >= BEAM.drainInterval && world.status === 'playing') {
    world.drainClock -= BEAM.drainInterval;
    if (!drainWisp(world, 'beam', events)) break;
    // The drained unit falls back to the land as moss.
    const mossCell = randomEmptyCell(world, rng);
    if (mossCell >= 0) spawn(world, mossCell, 'moss');
    events.push({ type: 'drained', energy: 1, mossCell });
  }
}

function growSpires(world: World, dt: number, events: SimEvent[]): void {
  world.stacks.forEach((stack, cell) => {
    const top = stack[stack.length - 1];
    if (top?.kind !== 'seed' || !top.grow) return;
    top.grow -= dt;
    if (top.grow <= 0) {
      top.grow = 0;
      top.level = (top.level ?? 0) + 1;
      events.push({ type: 'spireGrew', cell, level: top.level });
    }
  });
}

/** Moss in the beam has a small chance per second of hatching into a Moth. */
function hatchMoss(world: World, dt: number, rng: Rng, events: SimEvent[]): void {
  world.stacks.forEach((stack, cell) => {
    const top = stack[stack.length - 1];
    if (top?.kind !== 'moss' || stack.length !== 1) return;
    const t = cellTop(world.terrain, cell);
    if (!inBeamWedge(world, bearingFromKeeper(world, t))) return;
    if (!lampCanSee(world, { x: t.x, y: t.y + 0.05, z: t.z }, cell)) return;
    top.lit = (top.lit ?? 0) + dt;
    if (rng.next() < ECOLOGY.hatchRate * dt) {
      stack.pop();
      spawnMoth(world, cell, 1);
      events.push({ type: 'hatched', cell });
    }
  });
}

function moveMoths(world: World, dt: number, rng: Rng, events: SimEvent[]): void {
  const mossCells: number[] = [];
  world.stacks.forEach((s, i) => {
    if (s.length === 1 && s[0].kind === 'moss') mossCells.push(i);
  });

  for (const moth of [...world.moths]) {
    // Draining the Wisp when sharing its tile.
    if (moth.cell === world.player.cell) {
      moth.leechClock += dt;
      while (moth.leechClock >= ECOLOGY.leechInterval && world.status === 'playing') {
        moth.leechClock -= ECOLOGY.leechInterval;
        if (!drainWisp(world, 'moth', events)) break;
        moth.energy += 1;
        events.push({ type: 'leeched', cell: moth.cell });
      }
    } else {
      moth.leechClock = 0;
    }

    moth.clock += dt;
    if (moth.clock < ECOLOGY.mothStep) continue;
    moth.clock = 0;
    moth.prevCell = moth.cell;
    moth.cell = chooseStep(world, moth, mossCells, rng);

    // Eat moss on arrival.
    const stack = world.stacks[moth.cell];
    if (stack.length === 1 && stack[0].kind === 'moss') {
      stack.pop();
      moth.energy += 1;
      mossCells.splice(mossCells.indexOf(moth.cell), 1);
      events.push({ type: 'mothAte', cell: moth.cell });
    }
    if (moth.energy >= ECOLOGY.layAt) layMoss(world, moth, rng, mossCells, events);
  }
}

/** Greedy step toward the strongest pull of nearby moss and the Wisp, with a little jitter. */
function chooseStep(world: World, moth: Moth, mossCells: number[], rng: Rng): number {
  const { grid } = world.terrain;
  const options = [moth.cell];
  for (let d = 0; d < 6; d++) {
    const n = grid.neighbor(moth.cell, d);
    if (n >= 0 && n !== world.keeper.cell) options.push(n);
  }
  const wisp = grid.cells[world.player.cell];
  let best = moth.cell;
  let bestScore = -Infinity;
  for (const c of options) {
    const here = grid.cells[c];
    let score = rng.next() * 0.05;
    for (const m of mossCells) {
      const d = hexDistance(here, grid.cells[m]);
      if (d <= ECOLOGY.mossSense) score += 1 / (1 + d);
    }
    const dw = hexDistance(here, wisp);
    if (dw <= ECOLOGY.wispSense) score += (0.3 * world.player.energy) / (1 + dw);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // With nothing to sense, wander.
  if (bestScore < 0.05 + 1e-9) best = options[rng.int(0, options.length - 1)];
  return best;
}

/**
 * A full Moth settles: its energy becomes moss on empty tiles around it, preferring tiles
 * within ECOLOGY.layRadius (in random order), then the nearest empty tiles beyond.
 */
function layMoss(world: World, moth: Moth, rng: Rng, mossCells: number[], events: SimEvent[]): void {
  const { grid } = world.terrain;
  const here = grid.cells[moth.cell];
  const spots: { cell: number; d: number; tie: number }[] = [];
  grid.cells.forEach((c, i) => {
    if (world.stacks[i].length === 0 && i !== world.keeper.cell && i !== world.player.cell) {
      spots.push({ cell: i, d: Math.max(hexDistance(c, here), ECOLOGY.layRadius), tie: rng.next() });
    }
  });
  spots.sort((a, b) => a.d - b.d || a.tie - b.tie);
  let laid = 0;
  while (moth.energy > 0 && laid < spots.length) {
    const cell = spots[laid].cell;
    spawn(world, cell, 'moss');
    mossCells.push(cell);
    moth.energy -= 1;
    laid++;
  }
  if (moth.energy === 0) world.moths.splice(world.moths.indexOf(moth), 1);
  events.push({ type: 'mothLaid', cell: moth.cell, moss: laid });
}

function randomEmptyCell(world: World, rng: Rng): number {
  const n = world.terrain.grid.count;
  for (let attempt = 0; attempt < 64; attempt++) {
    const c = rng.int(0, n - 1);
    if (world.stacks[c].length === 0 && c !== world.keeper.cell) return c;
  }
  return -1;
}

/** World Y at which a Moth on `cell` hovers: a little above whatever stands there. */
export function mothHoverY(world: World, cell: number): number {
  const column = columnTop(world, cell);
  return Math.max(supportY(world, cell) + 0.9, column + 0.5);
}
