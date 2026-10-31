/**
 * Balance harness: an idle Wisp on each campaign level. Reports energy lost to Moths and
 * the beam over two minutes, and the Moth count. Used to tune ECOLOGY.
 *
 *   npm run balance
 */
import { ECOLOGY } from '../src/core/constants';
import { CAMPAIGN } from '../src/core/levels';
import { step } from '../src/core/sim';
import { DEFAULT_TERRAIN, generateTerrain } from '../src/core/terrain';
import { createWorld } from '../src/core/world';

const SECONDS = 120;
const overrides = process.argv.slice(2).map((a) => a.split('='));
for (const [k, v] of overrides) (ECOLOGY as Record<string, number>)[k] = Number(v);

let lostSum = 0;
let deaths = 0;
const rows: string[] = [];
for (const spec of CAMPAIGN) {
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: spec.code });
  const w = createWorld(terrain, spec.code, { relays: spec.relays });
  let leeched = 0;
  let drained = 0;
  let firstLeech = -1;
  for (let t = 0; t < SECONDS; t += 0.05) {
    w.player.energy = 10; // topped up so it never dies and the Moths see a typical Wisp
    w.status = 'playing';
    for (const e of step(w, 0.05)) {
      if (e.type === 'leeched') {
        leeched++;
        if (firstLeech < 0) firstLeech = t;
      }
      if (e.type === 'drained') drained++;
    }
  }
  lostSum += leeched + drained;
  if (leeched + drained >= 10) deaths++;
  rows.push(`${spec.code}\tleech ${leeched}\tbeam ${drained}\tfirst ${firstLeech.toFixed(0)}s\tmoths ${w.moths.length}`);
}
console.log(rows.join('\n'));
console.log(`mean loss ${(lostSum / CAMPAIGN.length).toFixed(1)} / ${SECONDS}s; idle deaths (start energy 10): ${deaths}/${CAMPAIGN.length}`);
