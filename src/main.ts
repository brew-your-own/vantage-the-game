import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type ActionResult, type Intent, SCATTER_COST, applyIntent, inRelayReach, occludersOf } from './core/actions';
import { cellTop } from './core/surface';
import { DEFAULT_TERRAIN, generateTerrain } from './core/terrain';
import { beamEta, keeperSightTiles, lampVisibleTiles, playerLit } from './core/keeper';
import {
  CAMPAIGN,
  ENERGY_STAR,
  type LevelSpec,
  TUTORIAL,
  campaignIndex,
  specFor,
  starsFor,
} from './core/levels';
import { isFairCode, randomFairCode } from './core/fair';
import { STEPS, type TutorialSignal, advance, hatchTutorialMoth, tutorialHatchScale } from './tutorial';
import { type LossCause, step } from './core/sim';
import { castRay, visibleCells } from './core/visibility';
import { RELAY_ENERGY, SPIRE_FEED_COST } from './core/constants';
import {
  ENERGY,
  type World,
  beamParams,
  createWorld,
  entityEnergy,
  keeperDark,
  mothsOn,
  playerEye,
  relayAt,
  topOf,
} from './core/world';
import { bestStars, markTutorialDone, recordStars, totalStars, tutorialDone, unlocked } from './progress';
import { LookControls } from './input/controls';
import { EntityView } from './render/entityMeshes';
import { MothView } from './render/mothView';
import { KeeperView } from './render/keeperView';
import { RelayView } from './render/relayView';
import { type LevelPalette, PALETTES, paletteFor } from './render/palettes';
import { titleLand } from './core/title';
import { WAVE, beamSpin, rumble } from './core/titleIntro';
import { TitleIntroView } from './render/titleIntro';
import { REPO_URL, VERSION, versionUrl } from './version';
import { Sfx } from './audio/sfx';
import { Music } from './audio/music/music';
import { type Mood, NEUTRAL_MOOD, moodOf, smoothMood } from './audio/music/mood';
import { MoodPanel } from './audio/music/moodPanel';
import { TauntDirector, type TauntTrigger } from './audio/taunts';
import { KeeperVoice } from './audio/voice';
import { ACTIONS, ACTION_LABELS, DEFAULT_KEYS, type GameAction, actionFor, keyLabel, rebind } from './input/keymap';
import { TEXT_SIZES, loadSettings, saveSettings } from './settings';
import { TargetHighlight, VisibilityOverlay, createWispMarker } from './render/overlays';
import { access, wobble } from './render/access';
import { GameScene } from './render/scene';
import { buildTerrainGeometry } from './render/terrainMesh';

// M8: adaptive music on top of M7 (palettes, sound effects, pause, key remapping).
// URL: ?level=<level code> (the old ?seed= is still accepted).
// Internally a level code is the generator seed; players only ever see "level code",
// so it is never confused with the Seed object they can plant.

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const energyEl = document.getElementById('energy')!;
const messageEl = document.getElementById('message')!;
const crosshair = document.getElementById('crosshair')!;
const beamEl = document.getElementById('beam')!;
const litEl = document.getElementById('lit')!;
const endEl = document.getElementById('end')!;
const relaysEl = document.getElementById('relays')!;
const menuEl = document.getElementById('menu')!;
const pauseEl = document.getElementById('pause')!;
const tauntEl = document.getElementById('taunt')!;
const tutorialEl = document.getElementById('tutorial')!;
const view = new GameScene(container);
const canvas = view.renderer.domElement;
const settings = loadSettings();
const sfx = new Sfx();
sfx.muted = settings.muted;
const music = new Music();
music.enabled = settings.music;
const voice = new KeeperVoice();
voice.enabled = settings.voice;
voice.muted = settings.muted;
let taunts = new TauntDirector(0);
/** Seconds left showing the current taunt subtitle. */
let tauntTimer = 0;
/** Speech needs a user gesture first; until then the Keeper keeps quiet. */
let audioUnlocked = false;
/** Previous frame's beam state, to notice the moment the beam finds the Wisp. */
let wasLit = false;
/** Smoothed mood the music follows. */
let mood: Mood = NEUTRAL_MOOD;
/** Dev-only sliders for the music mood (backquote key). */
const moodPanel = import.meta.env.DEV ? new MoodPanel((s) => music.stinger(s)) : null;

/** Starts audio on a user gesture; the music joins once the context exists. */
function unlockAudio(): void {
  audioUnlocked = true;
  sfx.unlock();
  const out = sfx.output;
  if (out && !music.attached) {
    music.attach(out.ctx, out.out);
    music.start(seed);
  }
}
/** The action waiting for a new key in the controls menu, if any. */
let rebinding: GameAction | null = null;
let controlsOpen = false;
let paused = false;
const K = (a: GameAction) => keyLabel(settings.keys[a]);

const look = new LookControls(canvas);
const orbit = new OrbitControls(view.camera, canvas);
orbit.enabled = false;

const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const highlight = new TargetHighlight();
const overlay = new VisibilityOverlay();
const marker = createWispMarker();
const entities = new EntityView();
const keeperView = new KeeperView();
/** Tiles where a Wisp would be in the Keeper's sight (K). Computed only while shown. */
const keeperOverlay = new VisibilityOverlay(0xff3020, 0.4);

/** Applies the accessibility settings to the renderers and the page. */
function applyAccess(): void {
  access.colorBlind = settings.colorBlind;
  access.reducedMotion = settings.reducedMotion;
  // Colour-blind: magenta stripes, which read on every palette and without colour at all.
  if (settings.colorBlind) keeperOverlay.setStyle(0xff3ce0, 0.6, true);
  else keeperOverlay.setStyle(0xff3020, 0.4, false);
  document.documentElement.style.setProperty('--text', String(settings.textSize));
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
}
applyAccess();
const mothView = new MothView();
const relayView = new RelayView();
view.scene.add(
  highlight.group,
  overlay.mesh,
  keeperOverlay.mesh,
  marker,
  entities.group,
  keeperView.group,
  mothView.group,
  relayView.group,
);

/** Simulation rate (Hz); rendering interpolates nothing yet, the beam is smooth enough. */
const SIM_DT = 1 / 20;
/** At or below this energy, the Keeper remarks on the fading Wisp instead. */
const LOW_ENERGY = 3;
let simClock = 0;

let seed = 0;
let spec: LevelSpec;
/** Playing the tutorial: a guided level with its own options and step panel. */
let tutorial = false;
let tutorialStep = 0;
/** Radians turned so far (the tutorial's first step is looking around). */
let lookTravel = 0;
let lastYaw = 0;
let menuOpen = false;
/** On the title screen: the word VANTAGE in the land, the Keeper sweeping it, the menu over it. */
let title = false;
/** The title's opening (the land rising, the Keeper forming), and seconds into it. */
let intro: TitleIntroView | null = null;
let introT = 0;
/** Dev: holds the opening still (__vantage.titleIntro(t, true)), for checking frames. */
let introFrozen = false;
let world: World;
let terrainMesh: THREE.Mesh | null = null;
/** Tiles whose ground is in view from the current body (cached until the world changes). */
let visible: Uint8Array = new Uint8Array(0);
let target: { cell: number; canAct: boolean } | null = null;
let mode: 'first-person' | 'orbit' = 'first-person';
let messageTimer = 0;

/** A random level code that passes the fairness checks (the Keeper can't see everything). */
const randomCode = () => randomFairCode(specFor(0).options, Math.random);

function loadLevel(code: number, asTutorial = false): void {
  seed = code;
  tutorial = asTutorial;
  spec = asTutorial ? TUTORIAL : specFor(code);
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
  setTitle(false);
  showWorld(createWorld(terrain, seed, spec.options), paletteFor(code));
  // Every level starts in the Wisp's eyes, even if the last one ended in orbit view.
  if (mode !== 'first-person') setMode('first-person');
  endEl.style.display = 'none';
  closeMenu();
  mood = NEUTRAL_MOOD;
  music.start(code);
  taunts = new TauntDirector(code);
  wasLit = false;
  voice.stop();
  hideTaunt();
  refresh();
  taunt('start');
  // The tutorial starts facing the nearest moss in reach, so the first steps are in view.
  if (asTutorial) faceNearestMoss();
  tutorialStep = 0;
  lookTravel = 0;
  lastYaw = look.yaw;
  renderTutorial();
  // Typed or linked codes may be harsh; random ones never are.
  if (!asTutorial && campaignIndex(code) < 0 && !isFairCode(code, spec.options)) {
    flash('a harsh level: the Keeper sees most of this land', true);
    messageTimer = 4;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete('seed');
  if (asTutorial) {
    url.searchParams.delete('level');
    url.searchParams.set('tutorial', '');
  } else {
    url.searchParams.delete('tutorial');
    url.searchParams.set('level', String(seed));
  }
  window.history.replaceState(null, '', url);
}

/** Puts a world on screen: its land, palette and Keeper. */
function showWorld(next: World, palette: LevelPalette, topColor?: (cell: number) => number | null): void {
  world = next;
  view.applyPalette(palette);
  setPaused(false);
  if (terrainMesh) {
    view.scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  terrainMesh = new THREE.Mesh(buildTerrainGeometry(world.terrain, palette, topColor), terrainMaterial);
  view.scene.add(terrainMesh);
  keeperView.build(world, view.scene);
  simClock = 0;
}

/** Level code the title screen's music is composed from. */
const TITLE_MUSIC = 1;
/** The title's beam turns faster than in play, so it crosses the word often. */
const TITLE_BEAM_SPEED = (2 * Math.PI) / 12;
const TITLE_PALETTE = PALETTES.find((p) => p.name === 'violet') ?? PALETTES[0];
/** Letter tops: the gold of the menu's title. */
const TITLE_LETTER = 0xffd36a;
/** Title camera framing (tunable from the dev console: __vantage.titleCam). */
const titleCam = { dist: 86, height: 68, lookY: 0, lookZ: 20, sway: 0.12 };
/** The title's Keeper is drawn larger, so it holds its own against the word. */
const TITLE_KEEPER_SCALE = 2.2;

function setTitle(on: boolean): void {
  title = on;
  document.body.classList.toggle('title', on);
  keeperView.group.scale.setScalar(on ? TITLE_KEEPER_SCALE : 1);
  intro?.dispose();
  intro = null;
  keeperView.group.visible = true;
  keeperView.beamFade = 1;
  document.body.classList.remove('intro');
}

/** The menu fades in as the last letters settle. */
const introMenuAt = () => (intro ? intro.plan.lettersEnd - 0.8 : 0);

/** A key or click during the opening jumps to the word standing; true if there was one to skip. */
function skipIntro(): boolean {
  if (!intro || introT >= intro.plan.lettersEnd) return false;
  introT = intro.plan.lettersEnd;
  document.body.classList.remove('intro');
  return true;
}

/** The title screen: the word in the land, the Keeper's beam sweeping it, the menu in front. */
function showTitle(): void {
  const land = titleLand();
  const w = createWorld(land.terrain, 1, { relays: 0, keeperCell: land.keeperCell });
  // Bare land: no moss, and no body for the Wisp.
  w.stacks.forEach((s) => (s.length = 0));
  // The lamp first faces away from us, so its light doesn't flood the view as the word rises.
  w.keeper.yaw = -Math.PI / 2;
  tutorial = false;
  setTitle(true);
  highlight.hide();
  overlay.mesh.visible = false;
  keeperOverlay.mesh.visible = false;
  if (mode !== 'first-person') setMode('first-person');
  const letters = new Set(land.letters);
  showWorld(w, TITLE_PALETTE, (cell) => (letters.has(cell) ? TITLE_LETTER : null));
  const bare = buildTerrainGeometry({ ...land.terrain, heights: land.ground }, TITLE_PALETTE);
  intro = new TitleIntroView(land, terrainMesh!.geometry, bare, keeperView, TITLE_KEEPER_SCALE, view.scene);
  bare.dispose();
  // With reduced motion the word is simply there.
  introT = access.reducedMotion ? intro.plan.lettersEnd : 0;
  document.body.classList.toggle('intro', introT < introMenuAt());
  endEl.style.display = 'none';
  mood = NEUTRAL_MOOD;
  music.start(TITLE_MUSIC);
  voice.stop();
  hideTaunt();
  refresh();
  intro.update(introT);
  const url = new URL(window.location.href);
  for (const k of ['level', 'seed', 'tutorial']) url.searchParams.delete(k);
  window.history.replaceState(null, '', url);
  openMenu();
}

/**
 * Title camera: in front of the word, drifting slowly from side to side. During the opening
 * it starts a little closer and lower, eases back as the word rises, and shakes with the ground.
 */
function updateTitleCamera(time: number): void {
  const { dist, height, lookY, lookZ, sway } = titleCam;
  const settle = intro ? 1 - (1 - Math.min(1, introT / intro.plan.lettersEnd)) ** 3 : 1;
  const d = dist * (0.84 + 0.16 * settle);
  const a = wobble(sway * Math.sin(time * 0.07));
  const shake = wobble(0.35 * rumble(introT));
  view.camera.position.set(
    d * Math.sin(a) + shake * Math.sin(time * 37),
    height * (0.82 + 0.18 * settle) + wobble(1.5 * Math.sin(time * 0.05)) + shake * Math.sin(time * 29 + 1),
    d * Math.cos(a),
  );
  view.camera.lookAt(0, lookY, lookZ);
}

function faceNearestMoss(): void {
  const { grid } = world.terrain;
  const here = grid.cells[world.player.cell];
  let best = -1;
  let bestD = Infinity;
  world.stacks.forEach((stack, i) => {
    if (visible[i] !== 1 || stack.length !== 1 || stack[0].kind !== 'moss') return;
    const c = grid.cells[i];
    const d = (Math.abs(c.q - here.q) + Math.abs(c.r - here.r) + Math.abs(c.q + c.r - here.q - here.r)) / 2;
    // Not right next to us: up close a tile shows mostly its side.
    if (d >= 2 && d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0) return;
  faceToward(best);
  const eye = playerEye(world);
  const t = cellTop(world.terrain, best);
  look.pitch = Math.atan2(t.y - eye.y, Math.hypot(t.x - eye.x, t.z - eye.z));
}

/** Moves the tutorial on after a signal (or a world change), and redraws its panel. */
function tutorialSignal(signal?: TutorialSignal): void {
  if (!tutorial) return;
  const next = advance(tutorialStep, world, signal);
  if (next === tutorialStep) return;
  tutorialStep = next;
  world.hatchScale = tutorialHatchScale(next);
  if (next < STEPS.length) sfx.play('click');
  ensureTutorialMoth(true);
  renderTutorial();
}

/**
 * On the Moth step, a Moth hatches in view as the step starts (others may be out of
 * sight), and again whenever none is left to swat.
 */
function ensureTutorialMoth(entering = false): void {
  if (!tutorial || !STEPS[tutorialStep]?.needsMoth) return;
  if (!entering && world.moths.length > 0) return;
  if (hatchTutorialMoth(world) >= 0) refresh(false);
}

function renderTutorial(): void {
  const show = tutorial && !menuOpen && world.status === 'playing' && tutorialStep < STEPS.length;
  tutorialEl.style.display = show ? 'block' : 'none';
  if (!show) return;
  const step = STEPS[tutorialStep];
  tutorialEl.innerHTML =
    `<span class="step">tutorial ${tutorialStep + 1}/${STEPS.length}</span><b>${step.title}</b><br>` + step.text(K);
}

/**
 * Recomputes everything derived from the world after it changes.
 * `sight` is false when only non-blocking objects changed (e.g. moss appeared).
 */
function refresh(sight = true): void {
  const eye = playerEye(world);
  if (sight) {
    visible = visibleCells(world.terrain, eye, occludersOf(world), world.player.cell);
    overlay.update(world.terrain, visible);
    keeperView.setLampVisibility(lampVisibleTiles(world));
    updateKeeperOverlay();
  }
  entities.rebuild(world);
  relayView.rebuild(world);
  marker.position.set(eye.x, eye.y, eye.z);
  updateBodyVisibility();
  updateEnergy();
}

function updateKeeperOverlay(): void {
  if (keeperOverlay.mesh.visible) keeperOverlay.update(world.terrain, keeperSightTiles(world));
}

function updateBodyVisibility(): void {
  if (entities.playerBody) entities.playerBody.visible = mode === 'orbit';
}

function setMode(next: typeof mode): void {
  mode = next;
  orbit.enabled = mode === 'orbit';
  look.enabled = mode === 'first-person';
  marker.visible = mode === 'orbit';
  crosshair.style.display = mode === 'first-person' ? 'block' : 'none';
  updateBodyVisibility();
  if (mode === 'orbit') {
    document.exitPointerLock();
    const eye = playerEye(world);
    orbit.target.set(eye.x, eye.y, eye.z);
    view.camera.position.set(eye.x + 12, eye.y + 14, eye.z + 12);
  }
}

function act(intent: Intent): ActionResult {
  const from = world.player.cell;
  const result = applyIntent(world, intent);
  if (!result.ok) {
    flash(result.reason, true);
    sfx.play('fail');
    return result;
  }
  for (const ev of result.events) {
    if (ev.type === 'harvested') sfx.play(ev.kind === 'moth' ? 'swat' : 'harvest');
    if (ev.type === 'harvested' && ev.kind === 'moth') music.stinger('swat');
    if (ev.type === 'transferred') music.stinger('transfer');
    if (ev.type === 'scattered') music.stinger('scatter');
    if (ev.type === 'relayDrained') music.stinger(ev.remaining > 0 ? 'relay' : 'dark');
    if (ev.type === 'won') music.stinger('win');
    if (ev.type === 'harvested' && ev.kind === 'moth') taunt('swat');
    if (ev.type === 'transferred') taunt('transfer');
    if (ev.type === 'scattered') taunt('scatter');
    if (ev.type === 'relayDrained') taunt(ev.remaining > 0 ? 'relay' : 'dark');
    if (ev.type === 'won') taunt('won');
    if (ev.type === 'placed') sfx.play('place');
    if (ev.type === 'fed') sfx.play('feed');
    if (ev.type === 'transferred') sfx.play('transfer');
    if (ev.type === 'scattered') sfx.play('scatter');
    if (ev.type === 'relayDrained') sfx.play(ev.remaining > 0 ? 'relay' : 'dark');
    if (ev.type === 'won') sfx.play('win');
    if (ev.type === 'harvested') flash(`+${ev.energy} ${ev.kind}`);
    if (ev.type === 'placed' && intent.type === 'place') flash(`−${ev.energy} ${ev.kind}`);
    if (ev.type === 'transferred') flash('transferred');
    if (ev.type === 'scattered') flash(`scattered! −${SCATTER_COST}`);
    if (ev.type === 'relayDrained') {
      flash(ev.remaining > 0 ? `+${ev.energy} relay drained · ${ev.remaining} left` : 'the Keeper goes dark · take the summit');
    }
    if (ev.type === 'won') showWin();
    tutorialSignal(ev);
  }
  if (intent.type === 'transfer') faceToward(from);
  // Moving to another body snaps the camera; only lifts in place are eased.
  if (world.player.cell !== from) camY = playerEye(world).y;
  refresh();
  return result;
}

/** After a transfer, turn to look back at the body we came from. */
function faceToward(cell: number): void {
  const eye = playerEye(world);
  const c = cellTop(world.terrain, cell);
  look.yaw = Math.atan2(-(c.x - eye.x), -(c.z - eye.z));
}

function flash(text: string, isError = false): void {
  messageEl.textContent = text;
  messageEl.className = isError ? 'error' : '';
  messageEl.style.opacity = '1';
  messageTimer = 1.6;
}

function updateEnergy(): void {
  const e = world.player.energy;
  const pips = '▮'.repeat(Math.min(e, 40)) + (e > 40 ? '+' : '');
  energyEl.innerHTML = `<b>ENERGY ${e}</b> <span class="pips">${pips}</span>`;
}

function updateTarget(): void {
  if (mode !== 'first-person') {
    target = null;
    highlight.hide();
    return;
  }
  const eye = playerEye(world);
  const dir = look.direction();
  const hit = castRay(world.terrain, eye, dir, occludersOf(world), world.player.cell);
  // Moths in the air are targets too: the nearest one along the view ray wins if it is
  // in front of whatever the ray hits. Its tile is the target (even our own tile).
  const moth = pickMoth(eye, dir, hit?.distance ?? Infinity);
  if (moth !== null) {
    target = { cell: moth, canAct: moth === world.player.cell || visible[moth] === 1 };
    highlight.show(world.terrain, moth, target.canAct);
    return;
  }
  if (!hit || hit.kind === 'slope' || hit.cell === world.player.cell) {
    target = null;
    highlight.hide();
    return;
  }
  target = { cell: hit.cell, canAct: visible[hit.cell] === 1 };
  highlight.show(world.terrain, hit.cell, target.canAct);
}

type V3 = { x: number; y: number; z: number };

/** Cell of the nearest Moth within 0.45 of the view ray and closer than `maxDistance`, or null. */
function pickMoth(eye: V3, dir: V3, maxDistance: number): number | null {
  let best: number | null = null;
  let bestT = maxDistance;
  for (const m of world.moths) {
    const p = MothView.position(world, m, clock.elapsedTime);
    const vx = p.x - eye.x, vy = p.y - eye.y, vz = p.z - eye.z;
    const t = vx * dir.x + vy * dir.y + vz * dir.z;
    if (t <= 0 || t >= bestT) continue;
    const d2 = vx * vx + vy * vy + vz * vz - t * t;
    if (d2 < 0.45 * 0.45) {
      best = m.cell;
      bestT = t;
    }
  }
  return best;
}

function describeTarget(cell: number): string {
  if (cell === world.keeper.cell) {
    return keeperDark(world) ? 'the summit · R to take it' : 'the Keeper · drain its Relays first';
  }
  const relay = relayAt(world, cell);
  if (relay && mothsOn(world, cell).length === 0) {
    if (relay.drained) return 'a drained Relay';
    const how = inRelayReach(world, cell) ? 'H from higher up' : `get within ${world.relayReach} tiles to drain it`;
    return `a Relay (worth ${RELAY_ENERGY}) · ${how}`;
  }
  const moths = mothsOn(world, cell);
  if (moths.length > 0) {
    const e = moths.reduce((a, m) => Math.max(a, m.energy), 0);
    return `moth${moths.length > 1 ? ` ×${moths.length}` : ''} (worth ${e}) · H to swat`;
  }
  const stack = world.stacks[cell];
  const top = topOf(world, cell);
  if (!top) return 'empty tile';
  const shards = stack.filter((e) => e.kind === 'shard').length;
  const parts = [];
  if (shards) parts.push(`${shards} shard${shards > 1 ? 's' : ''}`);
  if (top.kind === 'seed') {
    const level = top.level ?? 0;
    parts.push(level === 0 && !top.grow ? 'seed · F to feed' : `spire L${level}${top.grow ? ' (growing)' : ''}`);
  } else if (top.kind !== 'shard') {
    parts.push(top.kind);
  }
  return `${parts.join(' + ')} (top worth ${entityEnergy(top)})`;
}

function updateHud(): void {
  const lines: string[] = [];
  if (target) {
    const { q, r } = world.terrain.grid.cells[target.cell];
    lines.push(
      `(${q},${r}) level ${world.terrain.heights[target.cell]} · ${describeTarget(target.cell)}` +
        (target.canAct ? '' : ' · out of sight'),
    );
  } else {
    lines.push(mode === 'first-person' ? 'no target' : 'orbit view');
  }
  lines.push(
    mode === 'first-person' && !look.locked
      ? 'click to look around (Esc releases) · arrows also turn'
      : `click/${K('harvest')} harvest · ${K('shard')} shard(${ENERGY.shard}) ${K('husk')} husk(${ENERGY.husk}) ` +
          `${K('seed')} seed(${ENERGY.seed}) ${K('feed')} feed(${SPIRE_FEED_COST}) · ${K('transfer')} transfer · ` +
          `${K('scatter')} scatter(${SCATTER_COST})`,
  );
  lines.push(
    `${levelLabel()} · ${K('yourView')} your view · ${K('keeperSight')} Keeper's sight · ${K('orbit')} orbit · ` +
      `${K('pause')} pause · ${K('mute')} sound ${sfx.muted ? 'off' : 'on'} · M menu`,
  );
  hud.innerText = lines.join('\n');
}

/** Advances the simulation in fixed steps. */
function simulate(dt: number): void {
  simClock += dt;
  let changed = false;
  let sightChanged = false;
  while (simClock >= SIM_DT) {
    simClock -= SIM_DT;
    for (const ev of step(world, SIM_DT)) {
      if (ev.type === 'drained') {
        flash('−1 the light burns', true);
        sfx.play('drained');
        taunt(world.player.energy <= LOW_ENERGY ? 'lowEnergy' : 'burn');
      }
      if (ev.type === 'huskDrained') {
        // A Husk is a sight blocker: once it's gone, what can be seen changes.
        if (ev.left <= 0) sightChanged = true;
        flash(ev.left > 0 ? `the Keeper drains a husk (${ev.left} left)` : 'the Keeper consumed a husk');
      }
      if (ev.type === 'leeched') {
        flash('−1 a moth feeds on you', true);
        sfx.play('leeched');
        taunt(world.player.energy <= LOW_ENERGY ? 'lowEnergy' : 'leeched');
      }
      if (ev.type === 'spireGrew') {
        sightChanged = true;
        sfx.play('grew');
        flash(`spire grew to level ${ev.level}`);
      }
      if (ev.type === 'lost') {
        sfx.play('lose');
        music.stinger('lose');
        taunt('lost');
        showEnd(ev.cause);
      }
      if (ev.type !== 'leeched') changed = true;
    }
  }
  const lit = world.status === 'playing' && playerLit(world);
  if (lit && !wasLit) taunt('spotted');
  wasLit = lit;
  // Moss and Moths don't block sight; only a growing Spire changes what can be seen.
  if (sightChanged) refresh(true);
  else if (changed) refresh(false);
}

function levelLabel(): string {
  if (tutorial) return 'tutorial';
  const i = campaignIndex(seed);
  return i >= 0 ? `level ${i + 1}/${CAMPAIGN.length} · code ${seed}` : `level code ${seed}`;
}

const clockText = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function updateRelaysUi(): void {
  const marks = world.relays.map((r) => (r.drained ? '◇' : '◆')).join('');
  const time = `${clockText(world.time)} / par ${clockText(spec.par)}`;
  relaysEl.innerHTML = `RELAYS <span class="marks">${marks}</span> · ${time}`;
  relaysEl.className = world.time > spec.par ? 'over' : '';
}

/** Feeds the music the smoothed mood; menus and pause keep only the calm and progress. */
function updateMusic(dt: number): void {
  const quiet = menuOpen || paused;
  if (world.status === 'playing') {
    const raw = moodOf(world);
    const target = moodPanel?.override ?? (quiet ? { ...NEUTRAL_MOOD, progress: raw.progress, altitude: raw.altitude } : raw);
    mood = smoothMood(mood, target, dt);
  }
  moodPanel?.show(mood);
  // The music dips while the Keeper speaks.
  music.update(mood, (quiet && !moodPanel?.override) || voice.speaking);
}

/** Beam hum loudness: rises as the beam approaches, full when lit. */
function beamLevel(): number {
  if (world.status !== 'playing' || paused || menuOpen || keeperDark(world)) return 0;
  if (playerLit(world)) return 1;
  const eta = beamEta(world);
  return eta !== null && eta < 8 ? 0.35 * (1 - eta / 8) : 0;
}

function updateBeamUi(): void {
  updateRelaysUi();
  sfx.setBeam(beamLevel());
  if (world.status !== 'playing') {
    beamEl.textContent = '';
    litEl.style.opacity = '0';
    return;
  }
  if (keeperDark(world)) {
    litEl.style.opacity = '0';
    beamEl.textContent = 'the Keeper is dark · take the summit';
    beamEl.className = 'safe';
    return;
  }
  const lit = playerLit(world);
  litEl.style.opacity = lit ? String(0.6 + wobble(0.2 * Math.sin(world.time * 8))) : '0';
  const eta = lit ? 0 : beamEta(world);
  const sweep = (2 * Math.PI) / beamParams(world).speed;
  if (lit) {
    beamEl.textContent = `THE BEAM HOLDS YOU · get out of it: transfer past its edge or into cover, or ${K('scatter')} to scatter`;
    beamEl.className = 'lit';
  } else if (eta !== null && eta < 8) {
    beamEl.textContent = `beam in ${eta.toFixed(1)}s`;
    beamEl.className = 'warn';
  } else if (eta === null) {
    beamEl.textContent = 'hidden from the Keeper';
    beamEl.className = 'safe';
  } else {
    beamEl.textContent = `in the Keeper's sight · beam in ${Math.round(eta)}s / ${Math.round(sweep)}s`;
    beamEl.className = '';
  }
}

function showEnd(cause: LossCause): void {
  document.exitPointerLock();
  renderTutorial();
  const why = cause === 'beam' ? 'The Keeper drained your last energy.' : 'A moth fed on your last energy.';
  endEl.innerHTML =
    `<h1>YOUR LIGHT WENT OUT</h1><p>${why}</p>` +
    '<p>[Enter] retry this level · [M] title screen</p>';
  endEl.style.display = 'flex';
}

function nextCode(): number {
  const i = campaignIndex(seed);
  return i >= 0 && i + 1 < CAMPAIGN.length ? CAMPAIGN[i + 1].code : randomCode();
}

function showWin(): void {
  document.exitPointerLock();
  if (tutorial) return showTutorialDone();
  const stars = starsFor(world, spec);
  const best = recordStars(seed, stars);
  const star = (on: boolean) => `<span class="${on ? 'on' : 'off'}">★</span>`;
  const i = campaignIndex(seed);
  const next = i >= 0 && i + 1 < CAMPAIGN.length ? `level ${i + 2}` : 'a new level';
  endEl.innerHTML =
    `<h1 class="won">THE SUMMIT IS YOURS</h1>` +
    `<p class="stars">${star(true)}${star(world.player.energy >= ENERGY_STAR)}${star(world.time <= spec.par)}</p>` +
    `<p>${star(true)} took the summit · ${star(world.player.energy >= ENERGY_STAR)} ${ENERGY_STAR}+ energy left (${world.player.energy})` +
    ` · ${star(world.time <= spec.par)} within par (${clockText(world.time)} / ${clockText(spec.par)})</p>` +
    (best ? '<p>new best!</p>' : '') +
    `<p>[Enter] ${next} · [R] replay · [M] title screen</p>`;
  endEl.style.display = 'flex';
}

function showTutorialDone(): void {
  markTutorialDone();
  renderTutorial();
  endEl.innerHTML =
    '<h1 class="won">TUTORIAL COMPLETE</h1>' +
    '<p>That is the whole game. Real levels have more Relays, to drain from ever closer, a faster beam and hungrier moths:<br>' +
    'hide from the beam, climb high, and spend your energy wisely.</p>' +
    '<p>[Enter] level 1 · [R] replay the tutorial · [M] title screen</p>';
  endEl.style.display = 'flex';
}

function openMenu(): void {
  document.exitPointerLock();
  voice.stop();
  hideTaunt();
  menuOpen = true;
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const tiles = CAMPAIGN.map((s, i) => {
    const open = unlocked(i);
    const label = open ? `<b>${i + 1}</b><span>${stars(bestStars(s.code))}</span>` : `<b>${i + 1}</b><span>locked</span>`;
    return `<button data-code="${s.code}" ${open ? '' : 'disabled'} class="${s.code === seed ? 'current' : ''}">${label}</button>`;
  }).join('');
  menuEl.innerHTML =
    (title ? '' : '<h1>VANTAGE</h1>') +
    '<p class="lead">Drain the Keeper’s Relays from above and close by. When its lamp goes dark, take its summit.</p>' +
    (tutorialDone()
      ? '<p><button id="start-tutorial">replay the tutorial</button></p>'
      : '<p><button id="start-tutorial" class="primary">▶ new here? play the tutorial</button></p>') +
    `<div class="levels">${tiles}</div>` +
    `<p>${totalStars()} / ${CAMPAIGN.length * 3} stars · each level: win, keep ${ENERGY_STAR}+ energy, beat par</p>` +
    '<form id="code-form"><label>level code <input id="code-input" inputmode="numeric" autocomplete="off" size="8"></label>' +
    ' <button type="submit">play</button> <button type="button" id="random-level">random</button></form>' +
    controlsHtml() +
    (title
      ? ''
      : '<p class="keys">[M] or [Esc] back to the game · <button id="to-title">title screen</button></p>') +
    creditsHtml();
  menuEl.style.display = 'flex';
  renderTutorial();
  const details = menuEl.querySelector('details')!;
  details.addEventListener('toggle', () => (controlsOpen = details.open));
  menuEl.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => {
    b.addEventListener('click', () => {
      rebinding = b.dataset.action as GameAction;
      b.textContent = 'press a key…';
    });
  });
  menuEl.querySelector('#toggle-sound')!.addEventListener('click', () => toggleMute());
  menuEl.querySelector('#toggle-music')!.addEventListener('click', () => toggleMusic());
  menuEl.querySelector('#toggle-voice')!.addEventListener('click', () => toggleVoice());
  const accessToggle = (id: string, change: () => void) =>
    menuEl.querySelector(id)!.addEventListener('click', () => {
      change();
      saveSettings(settings);
      applyAccess();
      openMenu();
    });
  accessToggle('#toggle-cb', () => (settings.colorBlind = !settings.colorBlind));
  accessToggle('#toggle-motion', () => (settings.reducedMotion = !settings.reducedMotion));
  accessToggle('#text-size', () => {
    settings.textSize = TEXT_SIZES[(TEXT_SIZES.indexOf(settings.textSize) + 1) % TEXT_SIZES.length];
  });
  menuEl.querySelector('#reset-keys')!.addEventListener('click', () => {
    settings.keys = { ...DEFAULT_KEYS };
    saveSettings(settings);
    openMenu();
  });
  menuEl.querySelectorAll<HTMLButtonElement>('.levels button').forEach((b) => {
    b.addEventListener('click', () => loadLevel(Number(b.dataset.code)));
  });
  menuEl.querySelector('#code-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = Number((menuEl.querySelector('#code-input') as HTMLInputElement).value.trim());
    if (Number.isInteger(code) && code > 0) loadLevel(code);
  });
  menuEl.querySelector('#random-level')!.addEventListener('click', () => loadLevel(randomCode()));
  menuEl.querySelector('#start-tutorial')!.addEventListener('click', () => loadLevel(TUTORIAL.code, true));
  menuEl.querySelector('#to-title')?.addEventListener('click', () => showTitle());
}

const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

/** GitHub link and the build's version (a tag, or a commit), bottom right of the menu. */
function creditsHtml(): string {
  return (
    '<div class="credits">' +
    `<a href="${REPO_URL}" target="_blank" rel="noopener">${GITHUB_MARK}<span>source on GitHub</span></a>` +
    `<a class="version" href="${versionUrl()}" target="_blank" rel="noopener" title="this build">${VERSION}</a>` +
    '</div>'
  );
}

function closeMenu(): void {
  menuOpen = false;
  rebinding = null;
  menuEl.style.display = 'none';
  if (world) renderTutorial();
}

function controlsHtml(): string {
  const rows = ACTIONS.map(
    (a) => `<tr><td>${ACTION_LABELS[a]}</td><td><button data-action="${a}">${K(a)}</button></td></tr>`,
  ).join('');
  return (
    `<details ${controlsOpen ? 'open' : ''}><summary>controls &amp; settings</summary>` +
    `<p><button id="toggle-sound">sound: ${sfx.muted ? 'off' : 'on'}</button> ` +
    `<button id="toggle-music">music: ${music.enabled ? 'on' : 'off'}</button> ` +
    `<button id="toggle-voice" title="${voice.voiceName ? `local voice: ${voice.voiceName}` : 'no local voice found: subtitles only'}">` +
    `Keeper voice: ${settings.voice ? 'on' : 'off'}${voice.voiceName ? '' : ' (subtitles)'}</button> ` +
    '<button id="reset-keys">reset keys</button></p>' +
    `<p><button id="toggle-cb">colour-blind mode: ${settings.colorBlind ? 'on' : 'off'}</button> ` +
    `<button id="toggle-motion">reduced motion: ${settings.reducedMotion ? 'on' : 'off'}</button> ` +
    `<button id="text-size">text size: ${Math.round(settings.textSize * 100)}%</button></p>` +
    `<table class="controls">${rows}</table>` +
    '<p class="keys">click a key, then press the new one · M, Esc and Enter are fixed · mouse: look, click harvests</p>' +
    '</details>'
  );
}

function toggleMusic(): void {
  music.enabled = !music.enabled;
  settings.music = music.enabled;
  saveSettings(settings);
  if (menuOpen) openMenu();
  else flash(`music ${music.enabled ? 'on' : 'off'}`);
}

function toggleVoice(): void {
  settings.voice = !settings.voice;
  voice.enabled = settings.voice;
  if (!settings.voice) {
    voice.stop();
    hideTaunt();
  }
  saveSettings(settings);
  if (menuOpen) openMenu();
}

/** Seconds to show a subtitle: roughly reading pace, at least 2.5 s. */
const subtitleTime = (text: string) => Math.max(2.5, 1 + text.length * 0.07);

/** The Keeper reacts to a game moment: maybe speaks a line, always with a subtitle. */
function taunt(trigger: TauntTrigger): void {
  if (!settings.voice || !audioUnlocked || menuOpen || paused) return;
  const line = taunts.pick(trigger, world.time);
  if (!line) return;
  // Don't talk over a line still being spoken (story beats interrupt).
  if (voice.speaking && !line.interrupt) return;
  voice.say(line.text, line.interrupt);
  tauntEl.textContent = `“${line.text}”`;
  tauntEl.style.opacity = '1';
  tauntTimer = subtitleTime(line.text);
}

function hideTaunt(): void {
  tauntTimer = 0;
  tauntEl.style.opacity = '0';
}

function toggleMute(): void {
  sfx.muted = !sfx.muted;
  voice.muted = sfx.muted;
  if (sfx.muted) voice.stop();
  settings.muted = sfx.muted;
  saveSettings(settings);
  if (menuOpen) openMenu();
  else flash(`sound ${sfx.muted ? 'off' : 'on'}`);
}

function setPaused(next: boolean): void {
  paused = next;
  pauseEl.style.display = paused ? 'flex' : 'none';
  if (paused) {
    voice.stop();
    hideTaunt();
    document.exitPointerLock();
    pauseEl.innerHTML = `<h1>PAUSED</h1><p>[${K('pause')}] resume · [M] menu</p>`;
  }
}

window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (rebinding) {
    e.preventDefault();
    if (e.key !== 'Escape') settings.keys = rebind(settings.keys, rebinding, e.key);
    saveSettings(settings);
    rebinding = null;
    sfx.play('click');
    return openMenu();
  }
  if (e.repeat || e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if (key === '`' && moodPanel) {
    document.exitPointerLock();
    return moodPanel.toggle();
  }
  if (menuOpen) {
    if (title && skipIntro()) return;
    // The title screen has no game behind its menu to go back to.
    if ((key === 'm' || key === 'escape') && !title) closeMenu();
    return;
  }
  // A finished level has no game to go back to: M leads to the title screen instead of the pause menu.
  if (key === 'm') return world.status === 'playing' ? openMenu() : showTitle();
  const action = actionFor(settings.keys, e.key);
  if (action === 'mute') return toggleMute();
  if (action === 'music') return toggleMusic();
  if (world.status === 'won') {
    if (key === 'enter') loadLevel(tutorial ? CAMPAIGN[0].code : nextCode());
    else if (key === 'r') loadLevel(seed, tutorial);
    return;
  }
  if (world.status === 'lost') {
    if (key === 'enter') loadLevel(seed, tutorial);
    return;
  }
  if (paused) {
    if (action === 'pause') setPaused(false);
    return;
  }
  if (action === 'pause') return setPaused(true);
  if (action === 'newLevel') return loadLevel(randomCode());
  if (action === 'yourView') return void (overlay.mesh.visible = !overlay.mesh.visible);
  if (action === 'keeperSight') {
    keeperOverlay.mesh.visible = !keeperOverlay.mesh.visible;
    tutorialSignal({ type: 'keeperSight' });
    return updateKeeperOverlay();
  }
  if (action === 'orbit') return setMode(mode === 'orbit' ? 'first-person' : 'orbit');
  if (mode !== 'first-person') return;
  if (action === 'scatter') return void act({ type: 'scatter' });
  if (!target) return;
  const cell = target.cell;
  if (action === 'harvest') act({ type: 'harvest', cell });
  else if (action === 'shard') act({ type: 'place', cell, kind: 'shard' });
  else if (action === 'husk') act({ type: 'place', cell, kind: 'husk' });
  else if (action === 'seed') act({ type: 'place', cell, kind: 'seed' });
  else if (action === 'feed') act({ type: 'feed', cell });
  else if (action === 'transfer') act({ type: 'transfer', cell });
});

// Leaving the tab pauses a running level.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && world.status === 'playing' && !menuOpen) setPaused(true);
});

window.addEventListener('pointerdown', () => {
  unlockAudio();
  skipIntro();
});

canvas.addEventListener('mousedown', (e) => {
  if (mode === 'first-person' && look.locked && e.button === 0 && target) act({ type: 'harvest', cell: target.cell });
});

const query = new URLSearchParams(window.location.search);
const param = Number(query.get('level') ?? query.get('seed'));
if (query.has('tutorial')) {
  loadLevel(TUTORIAL.code, true);
} else if (Number.isInteger(param) && param > 0) {
  loadLevel(param);
} else {
  showTitle();
}
setMode('first-person');

const clock = new THREE.Clock();
let camY = 0;
view.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (title) {
    if (intro) {
      if (!introFrozen) introT += dt;
      intro.update(introT);
      if (introT >= introMenuAt()) document.body.classList.remove('intro');
    }
    updateTitleCamera(clock.elapsedTime);
    const spin = intro ? beamSpin(intro.plan, introT) : 1;
    world.keeper.yaw = (world.keeper.yaw + TITLE_BEAM_SPEED * spin * dt) % (Math.PI * 2);
  } else if (mode === 'first-person') {
    look.update(dt);
    const eye = playerEye(world);
    // Ease vertical changes (e.g. a Spire lifting us) instead of snapping.
    camY = Math.abs(camY - eye.y) > 6 ? eye.y : camY + (eye.y - camY) * Math.min(1, dt * 4);
    const d = look.direction();
    view.camera.position.set(eye.x, camY, eye.z);
    view.camera.lookAt(eye.x + d.x, camY + d.y, eye.z + d.z);
  } else {
    orbit.update();
  }
  if (!menuOpen && !paused) simulate(dt);
  if (tutorial) ensureTutorialMoth();
  if (tutorial && tutorialStep === 0) {
    lookTravel += Math.abs(look.yaw - lastYaw);
    lastYaw = look.yaw;
    if (lookTravel > 1.5) tutorialSignal({ type: 'looked' });
  }
  keeperView.update(world, clock.elapsedTime);
  entities.animate(clock.elapsedTime);
  mothView.update(world, clock.elapsedTime);
  relayView.animate(clock.elapsedTime);
  if (!title) updateBeamUi();
  updateMusic(dt);
  if (tauntTimer > 0) {
    tauntTimer -= dt;
    if (tauntTimer <= 0 && !voice.speaking) hideTaunt();
    else if (tauntTimer <= 0) tauntTimer = 0.2;
  }
  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) messageEl.style.opacity = '0';
  }
  if (!title) {
    updateTarget();
    updateHud();
  }
  view.render();
});

// Dev-only handle for automated checks in the browser console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__vantage = {
    look,
    world: () => world,
    target: () => target,
    act,
    loadLevel,
    spec: () => spec,
    sfx,
    music,
    voice,
    taunt,
    tutorial: () => ({ active: tutorial, step: tutorialStep }),
    titleCam,
    titleWave: WAVE,
    titleIntro: (t?: number, freeze = false) => {
      if (t !== undefined) introT = t;
      introFrozen = freeze;
      return { t: introT, end: intro?.plan.lettersEnd };
    },
    showTitle,
    mood: () => mood,
    settings,
    refresh,
    step: (seconds: number) => {
      for (let t = 0; t < seconds; t += SIM_DT) step(world, SIM_DT);
      refresh(false);
    },
    visibleCount: () => visible.reduce((a, v) => a + v, 0),
    visible: () => visible,
  };
}
