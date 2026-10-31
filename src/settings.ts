import { type KeyMap, parseKeyMap } from './input/keymap';

/** Player settings, kept in this browser. Storage may be unavailable: defaults then apply. */
const KEY = 'vantage.settings.v1';

export interface Settings {
  keys: KeyMap;
  muted: boolean;
}

export function loadSettings(): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const s = window.localStorage.getItem(KEY);
    const parsed: unknown = s ? JSON.parse(s) : {};
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {
    keys: parseKeyMap(raw.keys),
    muted: raw.muted === true,
  };
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Settings last for this visit only.
  }
}
