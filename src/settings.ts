import { type KeyMap, parseKeyMap } from './input/keymap';

/** Player settings, kept in this browser. Storage may be unavailable: defaults then apply. */
const KEY = 'vantage.settings.v1';

export interface Settings {
  keys: KeyMap;
  muted: boolean;
  music: boolean;
  /** The Keeper's spoken taunts. */
  voice: boolean;
  /** Blue / orange instead of green / red, and a striped Keeper's-sight overlay. */
  colorBlind: boolean;
  /** No pulsing, bobbing or swaying. Defaults to the system's reduced-motion setting. */
  reducedMotion: boolean;
  /** Scale of all on-screen text. */
  textSize: number;
}

/** Text sizes the menu cycles through. */
export const TEXT_SIZES = [1, 1.25, 1.5];

function systemReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
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
    music: raw.music !== false,
    voice: raw.voice !== false,
    colorBlind: raw.colorBlind === true,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : systemReducedMotion(),
    textSize: TEXT_SIZES.includes(raw.textSize as number) ? (raw.textSize as number) : 1,
  };
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Settings last for this visit only.
  }
}
