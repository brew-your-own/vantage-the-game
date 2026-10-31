/** Remappable game actions and their keys. Pure: storage is handled by the caller. */
export const ACTIONS = [
  'harvest',
  'shard',
  'husk',
  'seed',
  'feed',
  'transfer',
  'scatter',
  'yourView',
  'keeperSight',
  'orbit',
  'pause',
  'mute',
  'newLevel',
] as const;
export type GameAction = (typeof ACTIONS)[number];

export type KeyMap = Record<GameAction, string>;

export const ACTION_LABELS: Record<GameAction, string> = {
  harvest: 'harvest / drain',
  shard: 'place shard',
  husk: 'place husk',
  seed: 'place seed',
  feed: 'feed a spire',
  transfer: 'transfer',
  scatter: 'scatter',
  yourView: 'your view overlay',
  keeperSight: "Keeper's sight overlay",
  orbit: 'orbit view',
  pause: 'pause',
  mute: 'sound on/off',
  newLevel: 'random new level',
};

export const DEFAULT_KEYS: KeyMap = {
  harvest: 'h',
  shard: '1',
  husk: '2',
  seed: '3',
  feed: 'f',
  transfer: 'r',
  scatter: 'x',
  yourView: 'v',
  keeperSight: 'k',
  orbit: 'o',
  pause: 'p',
  mute: 'u',
  newLevel: 'n',
};

/** Keys that stay fixed: menu, confirm, back. */
export const RESERVED_KEYS = new Set(['m', 'escape', 'enter']);

/** Normalises a KeyboardEvent.key: letters lower-case, space named. */
export const normaliseKey = (key: string) => (key === ' ' ? 'space' : key.length === 1 ? key.toLowerCase() : key.toLowerCase());

export function actionFor(map: KeyMap, key: string): GameAction | null {
  const k = normaliseKey(key);
  for (const a of ACTIONS) if (map[a] === k) return a;
  return null;
}

/**
 * Binds `key` to `action`. If another action had that key, the two swap, so every action
 * keeps exactly one key. Reserved keys are refused (returns the map unchanged).
 */
export function rebind(map: KeyMap, action: GameAction, key: string): KeyMap {
  const k = normaliseKey(key);
  if (RESERVED_KEYS.has(k)) return map;
  const next = { ...map };
  const other = actionFor(map, k);
  if (other && other !== action) next[other] = map[action];
  next[action] = k;
  return next;
}

/** Restores a stored map, falling back to defaults for anything missing or invalid. */
export function parseKeyMap(raw: unknown): KeyMap {
  let map = { ...DEFAULT_KEYS };
  if (raw && typeof raw === 'object') {
    for (const a of ACTIONS) {
      const k = (raw as Record<string, unknown>)[a];
      if (typeof k === 'string' && k.length > 0) map = rebind(map, a, k);
    }
  }
  return map;
}

export const keyLabel = (k: string) => (k.length === 1 ? k.toUpperCase() : k);
