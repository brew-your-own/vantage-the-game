import { type ActionEvent, occludersOf } from './core/actions';
import { hexDistance } from './core/hex';
import { canSeeCell } from './core/visibility';
import { type World, keeperDark, playerEye, spawnMoth, topOf } from './core/world';
import type { GameAction } from './input/keymap';

/** Things the tutorial listens for: rule events, plus looking around and the sight overlay. */
export type TutorialSignal = ActionEvent | { type: 'looked' } | { type: 'keeperSight' };

/** Key label for an action, as currently bound (e.g. "H"). */
export type KeyName = (action: GameAction) => string;

export interface TutorialStep {
  title: string;
  text: (k: KeyName) => string;
  /** This signal completes the step. */
  done: (s: TutorialSignal, w: World) => boolean;
  /** The world already shows the step is done (so doing things early never blocks). */
  satisfied?: (w: World) => boolean;
  /** The step needs a Moth in play: the game hatches one (see hatchTutorialMoth). */
  needsMoth?: boolean;
}

const shardsOn = (w: World, cell: number) => w.stacks[cell].filter((e) => e.kind === 'shard').length;

/** The tutorial steps; tests/tutorial.test.ts checks the level can be won by following them. */
export const STEPS: readonly TutorialStep[] = [
  {
    title: 'Look around',
    text: () => 'Click the view to take the mouse, then move it to look around. Esc gives the mouse back.',
    done: (s) => s.type === 'looked',
  },
  {
    title: 'Harvest',
    text: (k) =>
      `Energy is everything here. Aim at a tile with green moss: the outline turns green when you can reach it. Press ${k('harvest')} or click to harvest it.`,
    done: (s) => s.type === 'harvested',
  },
  {
    title: 'Place a Shard',
    text: (k) => `Aim at an empty tile you can see and press ${k('shard')} to place a Shard. It costs 2 energy.`,
    done: (s) => s.type === 'placed' && s.kind === 'shard',
  },
  {
    title: 'Stack it',
    text: (k) => `Aim at the top of your Shard and press ${k('shard')} again. Shards stack, and each one lifts what stands on it.`,
    done: () => false,
    satisfied: (w) => w.stacks.some((_, i) => shardsOn(w, i) >= 2),
  },
  {
    title: 'Place a Husk',
    text: (k) => `Now press ${k('husk')} on top of the stack to place a Husk: an empty body (3 energy) you can move into.`,
    done: (s) => s.type === 'placed' && s.kind === 'husk',
  },
  {
    title: 'Transfer',
    text: (k) => `Aim at the Husk and press ${k('transfer')} to transfer into it. You will see further from up there.`,
    done: (s) => s.type === 'transferred',
  },
  {
    title: 'Take back your old body',
    text: (k) => `Your old body is still down there. Aim at it and press ${k('harvest')}: its 3 energy comes back to you.`,
    done: (s) => s.type === 'harvested' && s.kind === 'husk',
  },
  {
    title: 'Watch the Keeper',
    text: (k) =>
      `The Keeper's beam sweeps the land. When it finds you it stops and holds you, draining you, until you get ` +
      `out of it: transfer past its edge (behind it is safest) or into cover, or press ${k('scatter')} to scatter. ` +
      `It stops on empty Husks too, and drains them into moss. Press ${k('keeperSight')} to show ` +
      `the tiles it can see in red (${k('keeperSight')} again hides them). The top right tells you when it is coming.`,
    done: (s) => s.type === 'keeperSight',
  },
  {
    title: 'Swat a Moth',
    text: (k) =>
      `Moss the beam lights can hatch into a Moth. One just hatched nearby: Moths drift toward energy and feed on yours ` +
      `when they reach you. Aim at it and press ${k('harvest')} to swat it, even on your own tile: its energy is yours.`,
    done: (s) => s.type === 'harvested' && s.kind === 'moth',
    needsMoth: true,
  },
  {
    title: 'Plant a Seed',
    text: (k) =>
      `Towers are not the only way up. Aim at an empty tile further away and press ${k('seed')} to plant a Seed (2 energy).`,
    done: (s) => s.type === 'placed' && s.kind === 'seed',
    satisfied: (w) => w.stacks.some((st) => st.some((e) => e.kind === 'seed')),
  },
  {
    title: 'Grow a Spire',
    text: (k) =>
      `Aim at the Seed and press ${k('feed')} to feed it 1 energy: it grows into a Spire, two levels taller per feed. ` +
      `Feed it up to three times.`,
    done: (s) => s.type === 'fed',
    satisfied: (w) => w.stacks.some((st) => st.some((e) => e.kind === 'seed' && (e.fed ?? 0) > 0)),
  },
  {
    title: 'Climb the Spire',
    text: (k) =>
      `When it stops growing, aim at the Spire and press ${k('transfer')} to move on top of it. ` +
      `Then take back your old body with ${k('harvest')}.`,
    done: (s, w) => s.type === 'transferred' && topOf(w, s.to)?.kind === 'seed',
    satisfied: (w) => topOf(w, w.player.cell)?.kind === 'seed',
  },
  {
    title: 'Drain the Relay',
    text: (k) =>
      `Find the Relay: a dark pillar with a gold light. To drain it you must be higher than its top, and within ` +
      `10 tiles. Aim at it and press ${k('harvest')}. If it says to climb higher or get closer, grow a Spire or build ` +
      `a tower toward it, and move up.`,
    done: (s) => s.type === 'relayDrained',
    satisfied: (w) => keeperDark(w),
  },
  {
    title: 'Take the summit',
    text: (k) => `The Keeper is dark. Aim at its summit and press ${k('transfer')} to take it.`,
    done: (s) => s.type === 'won',
  },
];

/** Index of the step that teaches Moths. */
export const MOTH_STEP = STEPS.findIndex((s) => s.needsMoth);

/**
 * Moth hatching during the tutorial: none until the Moth lesson is done (the lesson hatches
 * its own Moth), so nothing feeds on a new player who is still reading; normal after.
 */
export const tutorialHatchScale = (step: number) => (step > MOTH_STEP ? 1 : 0);

/**
 * The step after `index` once `signal` (if any) has happened in `world`: completes the
 * current step, then skips any steps the world already satisfies.
 */
export function advance(index: number, world: World, signal?: TutorialSignal): number {
  let i = index;
  if (i < STEPS.length && signal && STEPS[i].done(signal, world)) i++;
  while (i < STEPS.length && STEPS[i].satisfied?.(world)) i++;
  return i;
}

/**
 * Hatches a Moth for the tutorial from the nearest moss the Wisp can see (as the beam
 * would: the moss's energy becomes the Moth's). Returns its tile, or -1 if no moss is left.
 */
export function hatchTutorialMoth(world: World): number {
  const { grid } = world.terrain;
  const here = grid.cells[world.player.cell];
  const eye = playerEye(world);
  const occ = occludersOf(world);
  let best = -1;
  let bestScore = Infinity;
  world.stacks.forEach((stack, i) => {
    if (stack.length !== 1 || stack[0].kind !== 'moss' || i === world.player.cell) return;
    const d = hexDistance(grid.cells[i], here);
    // Visible moss first, not right next to the Wisp; then any moss, nearest first.
    const seen = d >= 2 && canSeeCell(world.terrain, eye, i, occ, world.player.cell, 'ground');
    const score = (seen ? 0 : 1000) + d;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best < 0) return -1;
  world.stacks[best].pop();
  spawnMoth(world, best, 1);
  return best;
}
