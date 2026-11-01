import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Output of a git command, or null outside a git checkout. */
function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

// The build's version, shown on the title screen: the tag if this commit has one
// (v1.2.0), else the nearest tag plus commits since (v1.2.0-3-gabc1234), else the short hash.
const version = git('describe --tags --always') ?? 'dev';
const commit = git('rev-parse HEAD') ?? '';
const tag = git('describe --tags --exact-match') ?? '';

// Relative base so the build works both locally and under a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  define: {
    __VERSION__: JSON.stringify(version),
    __COMMIT__: JSON.stringify(commit),
    __TAG__: JSON.stringify(tag),
  },
});
