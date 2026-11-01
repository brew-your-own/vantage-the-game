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

/**
 * Campaign level i is open when it is the first, the one before it has been won, or it has
 * been won itself (so a reordered campaign never locks a level you already beat).
 */
export function unlocked(index: number): boolean {
  return index === 0 || bestStars(CAMPAIGN[index - 1].code) > 0 || bestStars(CAMPAIGN[index].code) > 0;
}

export function totalStars(): number {
  return CAMPAIGN.reduce((sum, s) => sum + bestStars(s.code), 0);
}

const TUTORIAL_KEY = 'vantage.tutorial.v1';

/** Has the tutorial been finished in this browser? */
export function tutorialDone(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markTutorialDone(): void {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, 'done');
  } catch {
    // Remembered for this visit only.
  }
}
