/**
 * Plays every campaign level with the solver bot and prints a balance table: the frozen-time
 * plan (can it be won, how many climbs, energy to spare) and a real-time run at `pace`
 * seconds per action (time, energy lost to the beam and to Moths).
 *
 *   npm run playtest [-- pace=3 relayReach=8 mossDensity=0.05 beamScale=1.2 hatchScale=1.5]
 *
 * Option overrides apply to every level; ECOLOGY and BEAM constants can be overridden too.
 */
import { BEAM, ECOLOGY } from '../src/core/constants';
import { CAMPAIGN } from '../src/core/levels';
import type { WorldOptions } from '../src/core/world';
import { playLevel, solveLevel } from './solver';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
const pace = args.pace ?? 3;
const overrides: Partial<WorldOptions> = {};
for (const [k, v] of Object.entries(args)) {
  if (k === 'pace') continue;
  if (k in ECOLOGY) (ECOLOGY as Record<string, number>)[k] = v;
  else if (k in BEAM) (BEAM as Record<string, number>)[k] = v;
  else (overrides as Record<string, number>)[k] = v;
}

const pad = (v: unknown, n: number) => String(v).padStart(n);
console.log('lvl  code R reach  moss | plan: won climbs left low | real: won  secs  par beam moth left replans escapes dodges');
let wins = 0;
let realWins = 0;
CAMPAIGN.forEach((spec, i) => {
  const options = { ...spec.options, ...overrides };
  const plan = solveLevel(spec.code, options);
  const play = playLevel(spec.code, options, pace);
  wins += plan.won ? 1 : 0;
  realWins += play.won ? 1 : 0;
  console.log(
    [
      pad(i + 1, 3),
      pad(spec.code, 5),
      spec.relays,
      pad(options.relayReach ?? '-', 5),
      pad((options.mossDensity ?? 0.1).toFixed(3), 5),
      '|',
      pad(plan.won ? 'yes' : 'NO', 9),
      pad(plan.climbs.length, 6),
      pad(plan.energyLeft, 4),
      pad(plan.lowest, 3),
      '|',
      pad(play.won ? 'yes' : play.lost ? 'DIED' : 'stuck', 9),
      pad(play.seconds, 5),
      pad(spec.par, 4),
      pad(play.beam, 4),
      pad(play.moth, 4),
      pad(play.energyLeft, 4),
      pad(play.replans, 7),
      pad(play.escapes, 7),
      pad(play.dodges, 6),
      plan.won ? '' : ` ${plan.stuck}`,
    ].join(' '),
  );
});
console.log(`planned wins ${wins}/${CAMPAIGN.length}, real-time wins ${realWins}/${CAMPAIGN.length}`);
