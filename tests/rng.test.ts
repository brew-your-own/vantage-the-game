import { describe, expect, it } from 'vitest';
import { Rng, hash2, hashString } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    const a = Array.from({ length: 10 }, ((r) => () => r.next())(new Rng(1)));
    const b = Array.from({ length: 10 }, ((r) => () => r.next())(new Rng(2)));
    expect(a).not.toEqual(b);
  });

  it('stays in range and is roughly uniform', () => {
    const rng = new Rng(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(850);
  });

  it('int() is inclusive and bounded', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('fork() is deterministic and independent of later parent use', () => {
    const a = new Rng(9).fork();
    const p = new Rng(9);
    const b = p.fork();
    p.next();
    expect(a.next()).toBe(b.next());
  });
});

describe('hashes', () => {
  it('hashString is stable', () => {
    expect(hashString('vantage')).toBe(hashString('vantage'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('hash2 is stable and in [0,1)', () => {
    expect(hash2(3, -4, 11)).toBe(hash2(3, -4, 11));
    expect(hash2(3, -4, 11)).not.toBe(hash2(4, -3, 11));
    for (let i = -50; i < 50; i++) {
      const v = hash2(i, i * 7, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
