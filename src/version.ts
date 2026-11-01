// Filled in at build time by vite.config.ts (git describe).
declare const __VERSION__: string;
declare const __COMMIT__: string;
declare const __TAG__: string;

export const REPO_URL = 'https://github.com/brew-your-own/vantage-the-game';

/** The running build: a tag (v1.2.0), a tag plus commits (v1.2.0-3-gabc1234), or a short hash. */
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

/** Where the version label links to: the tag's release, else the commit. */
export function versionUrl(): string {
  if (typeof __TAG__ === 'string' && __TAG__) return `${REPO_URL}/releases/tag/${__TAG__}`;
  if (typeof __COMMIT__ === 'string' && __COMMIT__) return `${REPO_URL}/commit/${__COMMIT__}`;
  return REPO_URL;
}
