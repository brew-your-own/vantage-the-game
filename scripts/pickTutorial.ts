/**
 * Lists level codes that work for the tutorial (see tutorialRoute.ts), fewest climbs first.
 *
 *   npx tsx scripts/pickTutorial.ts [last code, default 800]
 */
import { TUTORIAL_OPTIONS } from '../src/core/levels';
import { tutorialRoute } from './tutorialRoute';

const last = Number(process.argv[2] ?? 800);
const found: { code: number; climbs: number[]; moss: number }[] = [];
for (let code = 1; code <= last; code++) {
  const route = tutorialRoute(code, TUTORIAL_OPTIONS);
  if (route) found.push({ code, climbs: route.climbs, moss: route.moss });
}
found.sort((a, b) => a.climbs.length - b.climbs.length);
for (const f of found) console.log(f.code, 'climbs', f.climbs.join(' → '), 'moss', f.moss);
console.log(`${found.length} usable codes`);
