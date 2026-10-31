import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type ActionResult, type Intent, SCATTER_COST, applyIntent, occludersOf } from './core/actions';
import { cellTop } from './core/surface';
import { DEFAULT_TERRAIN, generateTerrain } from './core/terrain';
import { beamEta, keeperSightTiles, lampVisibleTiles, playerLit } from './core/keeper';
import { CAMPAIGN, ENERGY_STAR, type LevelSpec, campaignIndex, specFor, starsFor } from './core/levels';
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
import { bestStars, recordStars, totalStars, unlocked } from './progress';
import { LookControls } from './input/controls';
import { EntityView } from './render/entityMeshes';
import { MothView } from './render/mothView';
import { KeeperView } from './render/keeperView';
import { RelayView } from './render/relayView';
import { paletteFor } from './render/palettes';
import { Sfx } from './audio/sfx';
import { ACTIONS, ACTION_LABELS, DEFAULT_KEYS, type GameAction, actionFor, keyLabel, rebind } from './input/keymap';
import { loadSettings, saveSettings } from './settings';
import { TargetHighlight, VisibilityOverlay, createWispMarker } from './render/overlays';
import { GameScene } from './render/scene';
import { buildTerrainGeometry } from './render/terrainMesh';

// M7: retro look (low-res + dither), per-level palettes, sound effects, pause, key remapping.
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
const view = new GameScene(container);
const canvas = view.renderer.domElement;
const settings = loadSettings();
view.retro = settings.retro;
const sfx = new Sfx();
sfx.muted = settings.muted;
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
let simClock = 0;

let seed = 0;
let spec: LevelSpec;
let menuOpen = false;
let world: World;
let terrainMesh: THREE.Mesh | null = null;
/** Tiles whose ground is in view from the current body (cached until the world changes). */
let visible: Uint8Array = new Uint8Array(0);
let target: { cell: number; canAct: boolean } | null = null;
let mode: 'first-person' | 'orbit' = 'first-person';
let messageTimer = 0;

function loadLevel(code: number): void {
  seed = code;
  spec = specFor(code);
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
  world = createWorld(terrain, seed, { relays: spec.relays });
  const palette = paletteFor(code);
  view.applyPalette(palette);
  setPaused(false);
  if (terrainMesh) {
    view.scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  terrainMesh = new THREE.Mesh(buildTerrainGeometry(terrain, palette), terrainMaterial);
  view.scene.add(terrainMesh);
  keeperView.build(world, view.scene);
  simClock = 0;
  endEl.style.display = 'none';
  closeMenu();
  refresh();

  const url = new URL(window.location.href);
  url.searchParams.delete('seed');
  url.searchParams.set('level', String(seed));
  window.history.replaceState(null, '', url);
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
    return relay.drained ? 'a drained Relay' : `a Relay (worth ${RELAY_ENERGY}) · H from higher up`;
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
      }
      if (ev.type === 'leeched') {
        flash('−1 a moth feeds on you', true);
        sfx.play('leeched');
      }
      if (ev.type === 'spireGrew') {
        sightChanged = true;
        sfx.play('grew');
        flash(`spire grew to level ${ev.level}`);
      }
      if (ev.type === 'lost') {
        sfx.play('lose');
        showEnd(ev.cause);
      }
      if (ev.type !== 'leeched') changed = true;
    }
  }
  // Moss and Moths don't block sight; only a growing Spire changes what can be seen.
  if (sightChanged) refresh(true);
  else if (changed) refresh(false);
}

function levelLabel(): string {
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
  litEl.style.opacity = lit ? String(0.55 + 0.25 * Math.sin(world.time * 8)) : '0';
  const eta = lit ? 0 : beamEta(world);
  const sweep = (2 * Math.PI) / beamParams(world).speed;
  if (lit) {
    beamEl.textContent = 'IN THE BEAM';
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
  const why = cause === 'beam' ? 'The Keeper drained your last energy.' : 'A moth fed on your last energy.';
  endEl.innerHTML =
    `<h1>YOUR LIGHT WENT OUT</h1><p>${why}</p>` +
    '<p>[Enter] retry this level · [M] menu</p>';
  endEl.style.display = 'flex';
}

function nextCode(): number {
  const i = campaignIndex(seed);
  return i >= 0 && i + 1 < CAMPAIGN.length ? CAMPAIGN[i + 1].code : Math.floor(Math.random() * 1_000_000);
}

function showWin(): void {
  document.exitPointerLock();
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
    `<p>[Enter] ${next} · [R] replay · [M] menu</p>`;
  endEl.style.display = 'flex';
}

function openMenu(): void {
  document.exitPointerLock();
  menuOpen = true;
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const tiles = CAMPAIGN.map((s, i) => {
    const open = unlocked(i);
    const label = open ? `<b>${i + 1}</b><span>${stars(bestStars(s.code))}</span>` : `<b>${i + 1}</b><span>locked</span>`;
    return `<button data-code="${s.code}" ${open ? '' : 'disabled'} class="${s.code === seed ? 'current' : ''}">${label}</button>`;
  }).join('');
  menuEl.innerHTML =
    '<h1>VANTAGE</h1>' +
    '<p class="lead">Drain the Keeper’s Relays from above. When its lamp goes dark, take its summit.</p>' +
    `<div class="levels">${tiles}</div>` +
    `<p>${totalStars()} / ${CAMPAIGN.length * 3} stars · each level: win, keep ${ENERGY_STAR}+ energy, beat par</p>` +
    '<form id="code-form"><label>level code <input id="code-input" inputmode="numeric" autocomplete="off" size="8"></label>' +
    ' <button type="submit">play</button> <button type="button" id="random-level">random</button></form>' +
    controlsHtml() +
    '<p class="keys">[M] or [Esc] back to the game</p>';
  menuEl.style.display = 'flex';
  const details = menuEl.querySelector('details')!;
  details.addEventListener('toggle', () => (controlsOpen = details.open));
  menuEl.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => {
    b.addEventListener('click', () => {
      rebinding = b.dataset.action as GameAction;
      b.textContent = 'press a key…';
    });
  });
  menuEl.querySelector('#toggle-sound')!.addEventListener('click', () => toggleMute());
  menuEl.querySelector('#toggle-retro')!.addEventListener('click', () => toggleRetro());
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
  menuEl.querySelector('#random-level')!.addEventListener('click', () => loadLevel(Math.floor(Math.random() * 1_000_000)));
}

function closeMenu(): void {
  menuOpen = false;
  rebinding = null;
  menuEl.style.display = 'none';
}

function controlsHtml(): string {
  const rows = ACTIONS.map(
    (a) => `<tr><td>${ACTION_LABELS[a]}</td><td><button data-action="${a}">${K(a)}</button></td></tr>`,
  ).join('');
  return (
    `<details ${controlsOpen ? 'open' : ''}><summary>controls &amp; settings</summary>` +
    `<p><button id="toggle-sound">sound: ${sfx.muted ? 'off' : 'on'}</button> ` +
    `<button id="toggle-retro">retro look: ${view.retro ? 'on' : 'off'}</button> ` +
    '<button id="reset-keys">reset keys</button></p>' +
    `<table class="controls">${rows}</table>` +
    '<p class="keys">click a key, then press the new one · M, Esc and Enter are fixed · mouse: look, click harvests</p>' +
    '</details>'
  );
}

function toggleMute(): void {
  sfx.muted = !sfx.muted;
  settings.muted = sfx.muted;
  saveSettings(settings);
  if (menuOpen) openMenu();
  else flash(`sound ${sfx.muted ? 'off' : 'on'}`);
}

function toggleRetro(): void {
  view.retro = !view.retro;
  settings.retro = view.retro;
  saveSettings(settings);
  if (menuOpen) openMenu();
  else flash(`retro look ${view.retro ? 'on' : 'off'}`);
}

function setPaused(next: boolean): void {
  paused = next;
  pauseEl.style.display = paused ? 'flex' : 'none';
  if (paused) {
    document.exitPointerLock();
    pauseEl.innerHTML = `<h1>PAUSED</h1><p>[${K('pause')}] resume · [M] menu</p>`;
  }
}

window.addEventListener('keydown', (e) => {
  sfx.unlock();
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
  if (menuOpen) {
    if (key === 'm' || key === 'escape') closeMenu();
    return;
  }
  if (key === 'm') return openMenu();
  const action = actionFor(settings.keys, e.key);
  if (action === 'mute') return toggleMute();
  if (action === 'retro') return toggleRetro();
  if (world.status === 'won') {
    if (key === 'enter') loadLevel(nextCode());
    else if (key === 'r') loadLevel(seed);
    return;
  }
  if (world.status === 'lost') {
    if (key === 'enter') loadLevel(seed);
    return;
  }
  if (paused) {
    if (action === 'pause') setPaused(false);
    return;
  }
  if (action === 'pause') return setPaused(true);
  if (action === 'newLevel') return loadLevel(Math.floor(Math.random() * 1_000_000));
  if (action === 'yourView') return void (overlay.mesh.visible = !overlay.mesh.visible);
  if (action === 'keeperSight') {
    keeperOverlay.mesh.visible = !keeperOverlay.mesh.visible;
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

window.addEventListener('pointerdown', () => sfx.unlock());

canvas.addEventListener('mousedown', (e) => {
  if (mode === 'first-person' && look.locked && e.button === 0 && target) act({ type: 'harvest', cell: target.cell });
});

const query = new URLSearchParams(window.location.search);
const param = Number(query.get('level') ?? query.get('seed'));
if (Number.isInteger(param) && param > 0) {
  loadLevel(param);
} else {
  // No level asked for: show the menu over the first level not yet won.
  const i = CAMPAIGN.findIndex((s, i) => unlocked(i) && bestStars(s.code) === 0);
  loadLevel(CAMPAIGN[i >= 0 ? i : 0].code);
  openMenu();
}
setMode('first-person');

const clock = new THREE.Clock();
let camY = 0;
view.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'first-person') {
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
  keeperView.update(world, clock.elapsedTime);
  entities.animate();
  mothView.update(world, clock.elapsedTime);
  relayView.animate(clock.elapsedTime);
  updateBeamUi();
  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) messageEl.style.opacity = '0';
  }
  updateTarget();
  updateHud();
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
