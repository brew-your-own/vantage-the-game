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
- **Hex grid** terrain with terraced heights (0–12 levels) and slopes between terraces.
- Only **flat hex tiles** can hold objects. Slopes are visible but you can't act on them.
- Every level comes from a **seed**. A level is identified by a short code such as `K7Q-204`,
  so levels are reproducible and shareable.

### Energy (always conserved, no free energy)
| Object        | Energy | Notes                                                    |
|---------------|-------:|----------------------------------------------------------|
| Lumen moss    | 1      | Grows and spreads slowly onto nearby empty flat tiles.   |
| Shard         | 2      | A crystal block. Shards stack to gain height.            |
| Husk          | 3      | An empty body you can move your Wisp into.               |
| Seed → Spire  | 2 + n  | Plant a Seed, then feed it n energy to grow it 1–3 levels.|
| Relay         | 6      | Drained from above. Dims the Keeper as each one falls.   |

### Player actions (point at a target, press a key)
- **Harvest** an object whose base tile you can see: you gain its energy.
- **Place** a Shard, Husk or Seed on a flat tile you can see, or on top of a Shard stack.
- **Feed** a Spire to make it grow. Growth is gradual (≈2 s per level), so you have to
  commit to it while the beam might be coming.
- **Transfer** into a Husk or onto a Spire top you can see. The old body stays behind as
  a Husk you can harvest later.
- **Scatter** (emergency jump): costs 3 energy and drops you at a random tile that is
  *lower* than where you are.
- Turn and look freely (mouse look or keys). You stay rooted to one spot until you transfer.

### Threats
- **The Beam**: a cone of light from the Keeper that sweeps at a set rotation speed.
  Terrain and objects **cast real shadows**: we raycast the height field, so you can hide
  behind a ridge or a Shard stack. Standing in the light drains energy **continuously**
  (≈1 per second), not all at once, which gives you time to react.
- **Moths**: lit moss slowly turns into Moths. A Moth drifts toward the largest nearby
  cluster of energy, eats moss, and leeches energy from your Wisp if it reaches your tile.
  You can harvest a Moth if you can see the tile it's on.
- Each drained Relay narrows and slows the beam, so the level gets easier as you win ground.

### Winning, losing, scoring
- **Lose** when your energy hits 0.
- **Win** after all Relays are drained: transfer onto the Keeper's summit tile.
- **Score**: stars (1–3) based on leftover energy and time taken. Stars unlock later
  level tiers. Progress is saved locally.

### Presentation
- Low-poly, flat-shaded geometry. A low internal resolution scaled up, an ordered-dither
  post-process, and a limited palette that changes per level for an 80s look.
- Sound effects are synthesized at runtime with WebAudio (beam hum, harvest blips,
  transfer whoosh). There are no audio asset files.
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
    level.ts            # seed code ↔ params; placement of Keeper, Relays, moss, player start
    visibility.ts       # line of sight: ray-march eye → tile base over the height field + objects
    lighting.ts         # beam cone + shadow test (same ray-march from the lamp)
    entities.ts         # entity types, stacks per tile, energy values
    actions.ts          # harvest / place / feed / transfer / scatter, with validation
    sim.ts              # fixed-step tick (20 Hz): beam rotation, drain, moss growth, moths, spires
    state.ts            # GameState type + serialization (save, replay, tests)
  render/
    scene.ts            # renderer, camera, low-res render target, dither pass
    terrainMesh.ts      # one merged BufferGeometry for the terrain, per-level palette
    entityMeshes.ts     # instanced meshes per entity type
    beam.ts             # visible light cone + lit-tile overlay
    picking.ts          # crosshair ray → hex tile / entity
  input/
    controls.ts         # pointer lock, mouse look, key bindings → intents
  ui/
    hud.ts              # energy bar, relay count, beam warning, action hints
    menus.ts            # title, level select (seed entry), pause, win/lose
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
  about 24 and short-lived nodes are cleaned up automatically. Reverb comes from a
  generated noise impulse response, not a file.

---

## 4. Milestones

Each milestone ends in something playable or testable, and gets its own commit or PR.

| #  | Milestone                    | Deliverable / done when                                                     |
|----|------------------------------|------------------------------------------------------------------------------|
| M0 | Scaffold *(done)*            | Vite + TS + Three.js, git, placeholder scene renders.                        |
| M1 | Terrain                      | Seeded hex terrain generated and rendered; debug orbit camera; tests for rng/hex/terrain determinism. |
| M2 | First-person + picking       | Wisp eye at a start tile, mouse look, crosshair picks tile/entity, LOS highlighting (green = can act, red = can't). |
| M3 | Objects & actions            | Moss / Shard / Husk / Seed placement, harvest, stacking, transfer, scatter; energy HUD; conservation tests. |
| M4 | The Keeper & beam            | Rotating cone, real shadows, continuous drain, lose condition, beam audio/visual warning. |
| M5 | Living world                 | Moss growth/spread, Spire growth by feeding, lit moss → Moths, Moth AI.      |
| M6 | Relays & win loop            | Relays dim the beam, summit win, star scoring, seed codes, level select, localStorage progress. |
| M7 | Look & SFX                   | Low-res + dither post-process, per-level palettes, procedural sound effects, title/pause menus, key remapping. |
| M8 | Adaptive music               | Look-ahead scheduler and instruments; seeded level identity (key/mode/tempo/progression/motif); the six layers; mood signals wired from the sim; stingers; win/lose endings; music & SFX volume controls; a dev-only mood debug panel (sliders to fake each signal). Done when every row of the mood table can be clearly heard. |
| M9 | Ship                         | GitHub Actions workflow → GitHub Pages; README with play link and controls.  |
| M10| Polish (stretch)             | Tutorial level, balance pass (game and music mix), accessibility (colour-blind palettes, reduced motion), gamepad. |

Music comes after M6 because it needs the full set of game signals (beam, Moths, Relays,
win/lose) to react to. `music/theory.ts` and `music/composer.ts` are pure code with no
game dependencies, so they can be started earlier, alongside M4–M6, if useful.

---

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

---

## 7. Open questions
- Should levels be fully procedural (endless seeds), or a curated list of ~20 seeds with a
  difficulty curve, with free seed entry as a bonus? *(Proposed: curated list plus free entry.)*
- Keyboard and mouse only, or touch controls too?
- How strict should the retro look be (very low resolution and harsh dither) versus a
  cleaner modern low-poly style? We could offer both as a setting.
- Musical direction: dark ambient and minimalist (drones, sparse motifs), or a more
  melodic 80s synth sound (arpeggios up front)? *(Proposed: dark ambient by default,
  with arpeggios coming in as you make progress.)*
