/** Seeded, deterministic pseudo-random number generator (mulberry32). */
export class Rng {
  private state_: number;

  constructor(seed: number) {
    this.state_ = seed >>> 0;
  }

  /** Internal state; `new Rng(rng.state)` resumes the same sequence. */
  get state(): number {
    return this.state_;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state_ = (this.state_ + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() from empty array');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Independent child generator, so sub-systems don't perturb each other's sequences. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic hash of an integer lattice point to a float in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
