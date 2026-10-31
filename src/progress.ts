import { CAMPAIGN } from './core/levels';

/** Best stars per level code, kept in this browser only. Storage may be unavailable. */
const KEY = 'vantage.progress.v1';

type Progress = Record<string, number>;

function load(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Progress) : {};
  } catch {
    return {};
  }
}

let progress = load();

export function bestStars(code: number): number {
  return progress[String(code)] ?? 0;
}

/** Records a result; returns true when it beat the previous best. */
export function recordStars(code: number, stars: number): boolean {
  if (stars <= bestStars(code)) return false;
  progress = { ...progress, [String(code)]: stars };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Private mode or blocked storage: progress lasts for this visit only.
  }
  return true;
}

/** Campaign level i is open when it is the first, or the one before it has been won. */
export function unlocked(index: number): boolean {
  return index === 0 || bestStars(CAMPAIGN[index - 1].code) > 0;
}

export function totalStars(): number {
  return CAMPAIGN.reduce((sum, s) => sum + bestStars(s.code), 0);
}
