import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_KEYS, actionFor, parseKeyMap, rebind } from '../src/input/keymap';

describe('key remapping', () => {
  it('defaults give every action its own key', () => {
    expect(new Set(ACTIONS.map((a) => DEFAULT_KEYS[a])).size).toBe(ACTIONS.length);
    expect(actionFor(DEFAULT_KEYS, 'H')).toBe('harvest');
    expect(actionFor(DEFAULT_KEYS, 'q')).toBeNull();
  });

  it('rebinding to a used key swaps the two', () => {
    const m = rebind(DEFAULT_KEYS, 'harvest', 'f');
    expect(m.harvest).toBe('f');
    expect(m.feed).toBe('h');
    expect(new Set(ACTIONS.map((a) => m[a])).size).toBe(ACTIONS.length);
  });

  it('refuses reserved keys and restores stored maps safely', () => {
    expect(rebind(DEFAULT_KEYS, 'harvest', 'Escape')).toBe(DEFAULT_KEYS);
    expect(parseKeyMap(null)).toEqual(DEFAULT_KEYS);
    expect(parseKeyMap({ harvest: 'e', transfer: 42 })).toMatchObject({ harvest: 'e', transfer: 'r' });
    const m = parseKeyMap({ harvest: 'r' });
    expect(m.harvest).toBe('r');
    expect(m.transfer).toBe('h');
  });
});
