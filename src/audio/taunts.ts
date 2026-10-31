import { Rng } from '../core/rng';

/** Game moments the Keeper may comment on. Pure: no speech or timing APIs here. */
export type TauntTrigger =
  | 'start'
  | 'spotted'
  | 'burn'
  | 'leeched'
  | 'lowEnergy'
  | 'relay'
  | 'dark'
  | 'scatter'
  | 'swat'
  | 'transfer'
  | 'lost'
  | 'won';

export const TAUNTS: Record<TauntTrigger, readonly string[]> = {
  start: [
    'Another little light. Climb, if you can.',
    'I have watched this land for a thousand turns. Come.',
    'You are small, and I am patient.',
    'Every light ends up in my lamp.',
  ],
  spotted: [
    'There you are.',
    'I see you.',
    'Found you.',
    'Stand still. Let me look at you.',
    'The light finds everyone.',
  ],
  burn: ['Your warmth is mine.', 'Burn a little longer.', 'Give it to me.', 'Feel that? That is me.'],
  leeched: ['My moths are hungry.', 'Feed them.', 'Even the moths want you.'],
  lowEnergy: ['You are fading.', 'So dim now.', 'Almost out, little light.', 'I can barely see you. Soon, not at all.'],
  relay: [
    'Leave my Relays alone.',
    'You take what is mine.',
    'One less. It changes nothing.',
    'Thief.',
    'I felt that.',
  ],
  dark: ['Dark. But I am still here.', 'You put out my lamp. Now come and face me.', 'Blind. Not beaten.'],
  scatter: ['Run, little light.', 'Scatter all you like.', 'Running only wastes you.'],
  swat: ['That moth was mine.', 'Cruel little light.'],
  transfer: ['A new shell. The same light.', 'Higher and higher.', 'I see where you went.', 'Climbing, are we?'],
  lost: ['Your light is mine.', 'Gone. As they all go.', 'Rest now, in my lamp.'],
  won: ['The summit. Take it, then.', 'So. You climbed.', 'Watch well. It is your turn.'],
};

/** Seconds before the same trigger may speak again. */
export const COOLDOWN: Record<TauntTrigger, number> = {
  start: 0,
  spotted: 20,
  burn: 25,
  leeched: 25,
  lowEnergy: 40,
  relay: 0,
  dark: 0,
  scatter: 15,
  swat: 20,
  transfer: 30,
  lost: 0,
  won: 0,
};

/** Chance a trigger speaks when allowed (frequent events stay occasional). */
export const CHANCE: Record<TauntTrigger, number> = {
  start: 1,
  spotted: 0.8,
  burn: 0.35,
  leeched: 0.5,
  lowEnergy: 1,
  relay: 0.9,
  dark: 1,
  scatter: 0.6,
  swat: 0.5,
  transfer: 0.3,
  lost: 1,
  won: 1,
};

/** Story beats: always speak, interrupting whatever is being said. */
export const PRIORITY: ReadonlySet<TauntTrigger> = new Set(['dark', 'lost', 'won']);

/** Minimum gap (seconds) between any two non-priority taunts. */
export const GAP = 7;

export interface Taunt {
  text: string;
  interrupt: boolean;
}

/**
 * Decides when the Keeper speaks and what it says: global gap, per-trigger cooldown and
 * chance, and never the same line twice in a row for a trigger. Deterministic per seed.
 */
export class TauntDirector {
  private rng: Rng;
  private lastAny = -Infinity;
  private lastBy = new Map<TauntTrigger, number>();
  private lastLine = new Map<TauntTrigger, string>();

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x7a17);
  }

  /** `now` is the level clock in seconds. Returns the line to say, or null to stay silent. */
  pick(trigger: TauntTrigger, now: number): Taunt | null {
    const priority = PRIORITY.has(trigger);
    if (!priority) {
      if (now - this.lastAny < GAP) return null;
      if (now - (this.lastBy.get(trigger) ?? -Infinity) < COOLDOWN[trigger]) return null;
      if (this.rng.next() >= CHANCE[trigger]) return null;
    }
    const lines = TAUNTS[trigger];
    const prev = this.lastLine.get(trigger);
    const pool = lines.length > 1 ? lines.filter((l) => l !== prev) : lines;
    const text = this.rng.pick(pool);
    this.lastAny = now;
    this.lastBy.set(trigger, now);
    this.lastLine.set(trigger, text);
    return { text, interrupt: priority };
  }
}
