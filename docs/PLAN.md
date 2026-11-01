# Vantage: Implementation Plan

An **original** first-person strategy game in the "energy and line-of-sight" genre that
*The Sentinel* (1986) started. It keeps the genre's core ideas (height is power, you can
only act on what you can see, and energy is conserved) and builds its own world, rules
and win condition on top of them. It is not a recreation of the original game.

Runs fully in the browser with no server and no network calls, and deploys as static
files to GitHub Pages.

---

## 1. Game design

### Premise
You are a **Wisp**, a bodiless consciousness on a terraced hexagonal plateau. On the
highest ground stands **the Keeper**, a lighthouse whose lamp sweeps the land. Whatever
its light touches loses energy. The Keeper draws its power from **Relays**, pylons
spread across the map. Drain every Relay, the lamp goes dark, and the summit is yours.

### The world
- **Hex grid** terrain with terraced heights (0–12 levels). Every tile has a flat top that
  can hold objects. Tiles are joined by bevel strips, which become **slopes** where
  neighbouring heights differ (at most 2 levels apart). Slopes can't hold objects, but they
  do block line of sight.
- Every level is generated from a **level code**, a number such as `42` (later perhaps a
  friendlier form like `K7Q-204`), via `?level=42` in the URL. Internally it seeds the random
  generator. Player-facing text always says "level code", never "seed", so it can't be
  confused with the Seed object. A level is identified by its code,
  so levels are reproducible and shareable.

### Energy (always conserved, no free energy)
| Object        | Energy | Notes                                                    |
|---------------|-------:|----------------------------------------------------------|
| Lumen moss    | 1      | Spreads through Moths, and returns from beam drain (see below). |
| Shard         | 2      | A crystal block. Shards stack to gain height.            |
| Husk          | 3      | An empty body you can move your Wisp into.               |
| Seed → Spire  | 2 + n  | Plant a Seed (2), feed it 1 per level, up to 3 levels of 1.2 units each. |
| Relay         | 6      | Drained from above. Dims the Keeper as each one falls.   |

### Player actions (point at a target, press a key)
- **Harvest** the top object on a tile whose ground you can see. The tile's own objects
  never hide it, so a tower you can't see the top of can still be taken apart. You gain
  the object's energy.
- **Place** a Shard, Husk or Seed on an empty tile, or on top of a Shard stack. You must see
  the surface it will rest on, which means you can't build on a stack taller than your eye.
- **Feed** (`F`) a Seed or Spire 1 energy to grow it one level (1.2 units) over 2 s, up to
  level 3. You can feed the Spire you're standing on, and it lifts you as it grows. That's
  a cheap but slow, exposed climb: 3.6 units for 5 energy, against 12 energy in Shards.
- **Transfer** into a Husk whose resting surface you can see, or onto a grown Spire whose
  tile you can see (Spires rise above your eye line, so you couldn't see their tops). The
  old body stays behind as an object you can harvest later, and you turn to face it.
- **Scatter** (emergency jump): costs 3 energy, which becomes a new Husk on a random empty
  tile *lower* than where you are, and you move into it. Energy stays conserved.
- Shard stacks and Husks block line of sight. Moss and Seeds don't.
- Turn and look freely (mouse look or keys). You stay rooted to one spot until you transfer.

### Threats
- **The Beam**: a 30°-wide wedge of light from the Keeper's lamp, making one full turn
  every 36 s. The Keeper stands on the highest tile in the inner 60% of the map, so the
  beam sweeps land in every direction. Terrain and objects **cast real shadows**, so you
  can hide behind a ridge or a Shard stack. You're lit when you're inside the wedge and
  the lamp has a clear line to your head or your feet.
- Standing in the light drains energy **gradually** (1 per second, about 3 per pass), which
  gives you time to react. Each drained unit falls back onto a random empty tile as
  **moss**, so energy is still conserved. If you're lit with no energy left, you lose.
- The HUD says **"hidden from the Keeper"** when the lamp can't see you. Otherwise it shows
  **"in the Keeper's sight · beam in Ns"**, then an amber countdown in the last 8 s, then
  **IN THE BEAM**. Lit tiles glow on the ground, and `K` tints every tile where a standing
  Wisp would be in the Keeper's sight, to help plan cover.
- You start on a low tile hidden from the Keeper when one exists. Otherwise the beam has
  just swept past you, giving you a full turn to act.
- **Moths**: moss in the beam has a 10%-per-second chance to hatch into a Moth worth 1.
  Every 1.2 s a Moth moves one tile toward the strongest pull of nearby moss (within 5 tiles)
  and your Wisp (within 6, stronger the more energy you hold). It eats moss it lands on, and
  drains you 1 per second while it shares your tile. At 5 energy it settles, laying its
  energy as moss on the nearest empty tiles. **This is how moss spreads**, in clusters, while
  energy stays conserved. Harvesting a tile takes its Moth first, for all its energy, and
  you can swat a Moth on your own tile. If a Moth drains you at 0 energy, you lose.
- **Relays** (1.6 tall) stand on high ground, at least 4 tiles from the Keeper and the start.
  Drain one with H: your eye must be above its top and see its top. Each drained Relay
  narrows the beam (down to 40% of its width) and slows it (down to 50% of its speed), so
  the level gets easier as you win ground. When the last one falls the lamp goes dark: no
  beam, no Moths hatch, and the tower sinks to a low plinth.

### Winning, losing, scoring
- **Lose** when your energy hits 0.
- **Win** after all Relays are drained: transfer onto the Keeper's plinth (you must see its top).
- **Score**: 1 star for winning, +1 for 10+ energy left, +1 for finishing within par
  (120 s + 60 s per Relay). Winning a campaign level unlocks the next. Best stars are saved
  in localStorage (the game still works when storage is blocked).
- **Campaign**: 20 levels picked by `npm run curate` (scripts/curate.ts): codes with a hidden
  start and at least 20 tiles hidden from the Keeper, ordered from most cover to least.
  3 Relays for levels 1–7, 4 for 8–14, 5 for 15–20. Any other level code is a free level
  with 4 Relays. The menu (M) shows the level grid, stars, and a level code box.
- **Balance**: `npm run balance` runs an idle Wisp on every campaign level for two minutes.
  With hatchRate 0.05 it loses about 3 energy to Moths, and no idle Wisp dies in that time.

### Presentation
- Low-poly, flat-shaded geometry at native resolution. A retro post-process (low resolution,
  ordered dither, palette snapping, scanlines) was tried in M7 and dropped: it hurt more
  than it added.
- Each level code picks one of 8 palettes (meadow, dune, tundra, ember, lichen, violet,
  reef, slate) for land, sky, stars and light.
- Sound effects are synthesized at runtime with WebAudio: a beam hum that swells as the beam
  approaches, blips for harvesting, thuds for placing, a whoosh for transfer, chimes for
  Relays, a cadence for the win, a falling tone for the loss. There are no audio asset
  files. U mutes.
- Pause with P (also automatic when the tab is hidden). The menu (M) has a controls &
  settings panel: every action key can be remapped (keys swap on conflict; M, Esc and
  Enter are fixed). Settings are kept in localStorage.
- Music is also generated from code and adapts to what is happening in the game. See below.
- Controls: mouse look with pointer lock, keyboard actions, and a crosshair. Keys can be
  remapped.

### Adaptive music
All music is composed and synthesized at runtime: no samples, no audio files, no MIDI
files. Each level's seed sets its own **musical identity**: key, mode, tempo (around
60–90 BPM), a 4–8 bar chord progression and a short motif. Each level sounds different
but stays the same every time you play it.

The music is built from **layers** (stems) that fade in and out and change character as
the game state changes:

| Layer       | Role                                                   |
|-------------|--------------------------------------------------------|
| Drone / pad | Always on. Slow-moving chords and the level's base mood. |
| Bass pulse  | A heartbeat-like pulse that follows the chord roots.   |
| Arpeggio    | Movement and momentum. Gets busier as you make progress. |
| Motif       | The level's melody. Played sparsely, varied each time. |
| Percussion  | Soft noise ticks and thumps. Mostly appears under pressure. |
| Tension     | Dissonant clusters, risers, and filtered noise.        |

**Mood signals.** Each tick, the game state is turned into a small set of numbers between
0 and 1. These are smoothed over time so the music never jumps abruptly.

| Signal       | Comes from                                            | What the music does                              |
|--------------|-------------------------------------------------------|--------------------------------------------------|
| `exposure`   | Being in the beam (1), or how soon the beam will reach you | A riser and opening filter as the beam approaches. In the beam: dissonant cluster, louder percussion, faster pulse. |
| `lowEnergy`  | Your energy below a threshold                         | Shifts to a darker mode (e.g. Phrygian). Layers thin out, pitch wavers slightly, a heartbeat comes in, and the tempo drifts slower. |
| `threat`     | Moths near you, and how close they are                | Staccato figures in a high register, a stuttering arpeggio. |
| `progress`   | Fraction of Relays drained                            | Moves further through the chord progression, adds more layers, brighter harmonies. |
| `altitude`   | Your height relative to the Keeper                    | Higher register, more open voicings, more reverb. |
| `calm`       | Out of the beam, safe energy, no Moths nearby         | Sparse ambient mode: just the pad and an occasional motif. |

**Event stingers**: short one-off phrases for a Relay drained, a transfer, a Scatter
jump, a Moth harvested, a win (the progression resolves to a final cadence) and a loss
(the music winds down in pitch and fades out).

**As built (M8).** `src/audio/music/`: `theory.ts` (modes, degrees, level identity from
the code: root C2–B2, a home mode among Dorian/Aeolian/Mixolydian/Lydian, 60–90 BPM, a 4–8
chord progression, a 4–6 note motif), `mood.ts` (signals and asymmetric smoothing),
`composer.ts` (pure bar and stinger composition), `instruments.ts` (saw pad, triangle bass,
square pluck, FM bell, noise drums and riser, generated reverb), `music.ts` (look-ahead
scheduler, layer buses, continuous filter/reverb/level changes). J toggles the music, U all
sound. In dev builds the backquote key opens a panel with a slider per signal and a button
per stinger, to audition the music.

**Musical rules.** Changes to harmony and layers only happen on beat or bar boundaries,
so the music stays in time. Volume, filter and reverb changes are smoothed continuously.
Stingers are timed to the next beat.

---

## 2. Tech stack

| Concern       | Choice                         | Why                                          |
|---------------|--------------------------------|----------------------------------------------|
| Language      | TypeScript (strict)            | Type safety for game rules.                  |
| Build / dev   | Vite                           | Fast dev server; static build for Pages.     |
| 3D            | Three.js (bundled from npm)    | Mature WebGL renderer; no CDN, fully local.  |
| Tests         | Vitest                         | Shares Vite config; fast unit tests.         |
| Persistence   | `localStorage`                 | Progress, settings and key bindings.         |
| Hosting       | GitHub Pages via GitHub Actions| `vite build` → `dist/` → `actions/deploy-pages`.|

`vite.config.ts` uses `base: './'`, so the build works from any sub-path
(`https://<user>.github.io/<repo>/`) and from a local `vite preview`.

---

## 3. Architecture

The game simulation is kept separate from rendering. All game rules live in `src/core` as
pure, deterministic TypeScript with no Three.js or DOM, so they can be unit tested and
replayed.

```
src/
  core/                 # pure, deterministic, unit-tested
    rng.ts              # seeded PRNG (mulberry32 / sfc32)
    hex.ts              # axial coordinates, neighbours, hex→world transform
    terrain.ts          # height-field generation: noise → terraces → smoothing, flat-tile mask
    level.ts            # level code ↔ params; placement of Keeper, Relays, moss, player start
    visibility.ts       # line of sight: ray-march eye → tile base over the height field + objects
    lighting.ts         # beam cone + shadow test (same ray-march from the lamp)
    entities.ts         # entity types, stacks per tile, energy values
    actions.ts          # harvest / place / feed / transfer / scatter, with validation
    sim.ts              # fixed-step tick (20 Hz): beam rotation, drain, moss growth, moths, spires
    state.ts            # GameState type + serialization (save, replay, tests)
  render/
    scene.ts            # renderer, camera, lights, starfield, level palette
    terrainMesh.ts      # one merged BufferGeometry for the terrain, per-level palette
    entityMeshes.ts     # instanced meshes per entity type
    beam.ts             # visible light cone + lit-tile overlay
    picking.ts          # crosshair ray → hex tile / entity
  input/
    controls.ts         # pointer lock, mouse look, key bindings → intents
  ui/
    hud.ts              # energy bar, relay count, beam warning, action hints
    menus.ts            # title, level select (level code entry), pause, win/lose
  audio/
    context.ts          # shared AudioContext; resume on first user gesture; suspend when tab hidden
    sfx.ts              # procedural sound effects
    music/
      mood.ts           # pure: GameState → MoodVector (smoothed signals in 0..1)
      theory.ts         # pure: scales, modes, chords, voice leading, seeded progressions
      composer.ts       # pure: (level identity, bar index, mood) → note events for the next bar
      scheduler.ts      # look-ahead clock: schedules ~100 ms ahead on the AudioContext clock
      instruments.ts    # WebAudio voices: subtractive pad, FM bell, plucked string, noise drum
      mixer.ts          # layer buses, generated reverb, master compressor, music/SFX volume
      music.ts          # public interface: start(level), update(mood), stinger(event), stop()
  main.ts               # bootstrap: wires core ↔ render ↔ input ↔ ui
```

Each frame: **input** turns key and mouse events into intents, **core** applies them and
advances the simulation by fixed ticks, and **render** interpolates and draws the current
state. The renderer reads state and never changes it.

### Key algorithms
- **Terrain**: value or simplex noise over hex centres, quantised to terraces. Slopes are
  marked so no flat tile sits next to a jump of more than 1 level. Seeds are re-rolled if
  connectivity or flat-tile count checks fail.
- **Line of sight**: step from the eye to the target tile's base (or the top of its stack)
  in fixed increments, sampling terrain height (bilinear in hex space) plus object heights.
  Results are cached per eye position, because the eye only moves when you transfer.
- **Shadows**: the same ray-march, run from the lamp position to each lit candidate tile
  inside the cone. It is only recomputed for tiles the cone sweeps across each tick.
- **Moth steering**: greedy hex-neighbour steps toward the highest-energy cluster within
  radius R, with a little seeded randomness.
- **Music scheduling**: a `setTimeout` loop wakes about every 25 ms and schedules notes
  ~100 ms ahead on `AudioContext.currentTime`. This keeps timing tight even when frames
  drop. The composer works one bar at a time using the latest mood. It is pure code that
  returns plain note events, so it can be tested without any audio. Voices are capped at
  32 (pads and tension always play) and short-lived nodes are cleaned up automatically. Reverb comes from a
  generated noise impulse response, not a file.

---

## 4. Milestones

Each milestone ends in something playable or testable, and gets its own commit or PR.

| #  | Milestone                    | Deliverable / done when                                                     |
|----|------------------------------|------------------------------------------------------------------------------|
| M0 | Scaffold *(done)*            | Vite + TS + Three.js, git, placeholder scene renders.                        |
| M1 | Terrain *(done)*             | Seeded hex terrain generated and rendered; debug orbit camera; tests for rng/hex/terrain determinism. |
| M2 | First-person + picking *(done)* | Wisp eye at a start tile, mouse look, crosshair picks tile/entity, LOS highlighting (green = can act, red = can't). |
| M3 | Objects & actions *(done)*   | Moss / Shard / Husk / Seed placement, harvest, stacking, transfer, scatter; energy HUD; conservation tests. |
| M4 | The Keeper & beam *(done)*   | Rotating cone, real shadows, continuous drain, lose condition, beam audio/visual warning. |
| M5 | Living world *(done)*        | Moss growth/spread, Spire growth by feeding, lit moss → Moths, Moth AI.      |
| M6 | Relays & win loop *(done)*   | Relays dim the beam, summit win, star scoring, level codes, level select, localStorage progress. |
| M7 | Look & SFX *(done)*          | Per-level palettes (retro post-process tried and dropped), procedural sound effects, title/pause menus, key remapping. |
| M8 | Adaptive music *(done)*      | Look-ahead scheduler and instruments; seeded level identity (key/mode/tempo/progression/motif); the six layers; mood signals wired from the sim; stingers; win/lose endings; music & SFX volume controls; a dev-only mood debug panel (sliders to fake each signal). Done when every row of the mood table can be clearly heard. |
| M9 | Ship *(done)*                | GitHub Actions workflow → GitHub Pages; README with play link and controls.  |
| M10| Polish (stretch)             | Tutorial level *(done)*, fair random codes *(done)*, title screen *(done)*, balance pass (game and music mix) *(done)*, accessibility (colour-blind mode, reduced motion, text size) *(done)*, gentler tutorial *(done)*; gamepad dropped (touchpad play to be checked instead). |

Music comes after M6 because it needs the full set of game signals (beam, Moths, Relays,
win/lose) to react to. `music/theory.ts` and `music/composer.ts` are pure code with no
game dependencies, so they can be started earlier, alongside M4–M6, if useful.

---

**As built (M10, part 1).** *Tutorial*: `src/tutorial.ts` holds fourteen steps (look, harvest,
Shard, stack, Husk, transfer, take back the old body, Keeper's sight, swat a Moth, plant a Seed,
grow a Spire, climb it, drain the Relay, take the summit), each completed by a game event, and skipped when the world already shows it done. It
plays level code 493 with one Relay, a half-speed beam and 15 energy (`TUTORIAL_OPTIONS`). The
code was picked by `npm run pick-tutorial`: `scripts/tutorialRoute.ts` plans the route the
tutorial teaches against the real rules (a near, clearly aimable two-Shard tower first, a
Moth the tutorial hatches from moss in view, a fully fed Spire, then climbing again as needed), and a test replays that route through the steps to the win. The
Wisp starts facing a moss two or more tiles away; the menu offers the tutorial until it is
finished. *Fair codes*: `src/core/fair.ts` (shared with `npm run curate`) requires a hidden
start, all Relays placed and at least 20 hiding tiles; random levels (N, menu) re-roll until
fair (about 1 in 5 codes is, ~45 ms per check); typed or linked harsh codes still load, with a
warning.

**As built (M10, part 2).** *Title screen*: `src/core/title.ts` raises the word VANTAGE out of
low ground (a 5×7 font, two tiles per pixel so strokes stay upright on offset hex rows), with a
hill behind it for the Keeper. The title shows that land with gold letter tops, a larger Keeper
whose beam sweeps the word (letters light up and cast shadows), a slowly drifting camera, and
the menu low and see-through in front, with a GitHub link and the build version. The version
comes from `git describe --tags` at build time (`vite.config.ts`); CI checks out full history
so tags are found, and pushing a `v*` tag redeploys.

**As built (M10, part 3).** *Balance*: `scripts/solver.ts` is a greedy bot that plays by the
real rules: with time frozen it harvests everything in reach, drains any Relay it can, else
climbs (a 1–3 Shard tower or a 2–3 level Spire) to the spot scoring best (Relays drainable,
then nearness to the next Relay, then height), and takes the summit; in real time it replays
that plan at a set pace, swats Moths after a 2.5 s reaction, never hides, and re-plans when
the world has moved on. `npm run playtest` prints a table per campaign level. It showed every
level won in one or two climbs with 55–95 energy to spare, level 20 no harder than level 1:
from one high spot every Relay could be drained. Changes: Relays must now be drained from
within a reach (a new rule, shown in the target hint), and a per-level ramp in
`difficulty()` (`src/core/levels.ts`) takes reach from 10 to 7 tiles, moss from 8% to 4% of
tiles, the beam to 1.4× speed and 1.6× drain, and Moth hatching to 2.5×. The bot now needs
2–6 climbs, and a careless player (bot at 5 s per action) loses about 15 energy on early levels
and 25–30 late, and still wins every level. `npm run curate` now orders the campaign by the
bot's time at mid difficulty, quickest first, and skips codes it cannot win; a test checks
every campaign level can be won. A level already beaten stays open if the order changes.
*Mix*: measured on the audio bus, the frequent cues (harvest, swat, drained, grew) sat no
louder than the music's loud moments, while rarer sounds were 6 dB louder. Each effect now
has a trim (`TRIM` in `src/audio/sfx.ts`) so cues land within 1 dB of each other, about 8 dB
over the music, big events 2 dB above that; a limiter guards the bus. *Accessibility*: a
colour-blind mode (blue / orange target, magenta striped Keeper's sight), a "can't act"
target that differs in shape too (dashed, unfilled) for everyone, reduced motion (defaults
to the system setting: no pulsing, bobbing or title sway) and a text size setting (100,
125, 150%). *Tutorial*: no Moths hatch until the Moth lesson is done, and the beam drains at
half rate. *Beam hold* (after playtesting): the beam stops on the Wisp when it finds it and
centres on it while the Wisp stays inside the beam; it lets go once the Wisp is out of the
beam (past its edge or in cover) or scatters, and sweeps on. It also stops on an empty Husk
it lights and drains it, one unit per drain interval, into moss on random tiles; the Husk
thins as it empties and is gone at 0, then the sweep resumes. The Wisp has priority over a
Husk, so a Husk left behind when you transfer away is a decoy that buys a few seconds.

## 5. Testing strategy
- **Unit tests (Vitest)** for everything in `src/core`: PRNG determinism, hex math, terrain
  invariants (connectivity, minimum flat tiles), LOS edge cases, rules for every action,
  and energy conservation (total energy in the world plus the player stays the same,
  except for beam drain, which is tracked).
- **Music unit tests**: the same seed always gives the same musical identity. Generated
  notes stay in the scale, except deliberate tension notes. Harmony changes land only on
  bar boundaries. The mood mapping is monotonic (e.g. more exposure never lowers tension).
  Smoothing never jumps.
- **Music smoke test**: render a few bars with `OfflineAudioContext` and check the output
  is not silent and never clips.
- **Simulation replay tests**: a seed plus a scripted list of intents must always produce
  the same final state.
- **Manual playtest** each milestone with `npm run dev`.

---

## 6. Deployment (M9)
1. In the repo settings, set Pages → Source to **GitHub Actions**.
2. Add `.github/workflows/deploy.yml`: on push to `main`, run `npm ci && npm test && npm run build`,
   then `actions/upload-pages-artifact` (from `dist/`) → `actions/deploy-pages`.
3. The relative `base` means no repo-name hard-coding is needed.

**As built (M9).** `.github/workflows/deploy.yml` (Node 24, `npm ci`, tests, build, then
`configure-pages` → `upload-pages-artifact` → `deploy-pages`; also runnable by hand via
`workflow_dispatch`). Live at https://brew-your-own.github.io/vantage-the-game/. The README
has the play link, a short how-to-play and the default controls.

---

## 7. Open questions
- Should levels be fully procedural (endless level codes), or a curated list of ~20 level codes
  with a difficulty curve, with free level-code entry as a bonus? *(Proposed: curated list plus
  free entry.)*
- Keyboard and mouse only, or touch controls too?
- How strict should the retro look be? *(Decided in M7: no retro post-process; clean low-poly.)*
- Musical direction: dark ambient and minimalist (drones, sparse motifs), or a more
  melodic 80s synth sound (arpeggios up front)? *(Proposed: dark ambient by default,
  with arpeggios coming in as you make progress.)*
