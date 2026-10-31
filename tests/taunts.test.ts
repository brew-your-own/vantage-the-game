import { describe, expect, it } from 'vitest';
import { GAP, TAUNTS, TauntDirector, type TauntTrigger } from '../src/audio/taunts';

describe('the Keeper taunts', () => {
  it('always speak the story beats, interrupting', () => {
    const d = new TauntDirector(1);
    for (const t of ['dark', 'lost', 'won'] as TauntTrigger[]) {
      const r = d.pick(t, 0);
      expect(r?.interrupt).toBe(true);
      expect(TAUNTS[t]).toContain(r!.text);
    }
  });

  it('keep a gap between ordinary taunts', () => {
    const d = new TauntDirector(2);
    expect(d.pick('start', 0)).not.toBeNull();
    expect(d.pick('lowEnergy', GAP - 0.1)).toBeNull();
    expect(d.pick('lowEnergy', GAP + 0.1)).not.toBeNull();
  });

  it('respect per-trigger cooldowns', () => {
    const d = new TauntDirector(3);
    expect(d.pick('lowEnergy', 0)).not.toBeNull();
    expect(d.pick('lowEnergy', 20)).toBeNull();
    expect(d.pick('lowEnergy', 41)).not.toBeNull();
  });

  it('never repeat a line twice in a row for a trigger', () => {
    const d = new TauntDirector(4);
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const r = d.pick('won', i)!;
      expect(r.text).not.toBe(prev);
      prev = r.text;
    }
  });

  it('are deterministic for a seed', () => {
    const run = () => {
      const d = new TauntDirector(9);
      return Array.from({ length: 40 }, (_, i) => d.pick('spotted', i * 10)?.text ?? null);
    };
    expect(run()).toEqual(run());
  });
});
