import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type ActionResult, type Intent, SCATTER_COST, applyIntent, occludersOf } from './core/actions';
import { cellTop } from './core/surface';
import { DEFAULT_TERRAIN, generateTerrain } from './core/terrain';
import { castRay, visibleCells } from './core/visibility';
import { ENERGY, type World, createWorld, playerEye, topOf } from './core/world';
import { LookControls } from './input/controls';
import { EntityView } from './render/entityMeshes';
import { TargetHighlight, VisibilityOverlay, createWispMarker } from './render/overlays';
import { GameScene } from './render/scene';
import { buildTerrainGeometry } from './render/terrainMesh';

// M3: objects and actions on top of the first-person view.
// URL: ?seed=<number>.

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const energyEl = document.getElementById('energy')!;
const messageEl = document.getElementById('message')!;
const crosshair = document.getElementById('crosshair')!;
const view = new GameScene(container);
const canvas = view.renderer.domElement;

const look = new LookControls(canvas);
const orbit = new OrbitControls(view.camera, canvas);
orbit.enabled = false;

const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const highlight = new TargetHighlight();
const overlay = new VisibilityOverlay();
const marker = createWispMarker();
const entities = new EntityView();
view.scene.add(highlight.group, overlay.mesh, marker, entities.group);

let seed = 0;
let world: World;
let terrainMesh: THREE.Mesh | null = null;
/** Tiles whose ground is in view from the current body (cached until the world changes). */
let visible: Uint8Array = new Uint8Array(0);
let target: { cell: number; canAct: boolean } | null = null;
let mode: 'first-person' | 'orbit' = 'first-person';
let messageTimer = 0;

function loadSeed(newSeed: number): void {
  seed = newSeed;
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
  world = createWorld(terrain, seed);
  if (terrainMesh) {
    view.scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  terrainMesh = new THREE.Mesh(buildTerrainGeometry(terrain), terrainMaterial);
  view.scene.add(terrainMesh);
  refresh();

  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
}

/** Recomputes everything derived from the world after it changes. */
function refresh(): void {
  const eye = playerEye(world);
  visible = visibleCells(world.terrain, eye, occludersOf(world), world.player.cell);
  overlay.update(world.terrain, visible);
  entities.rebuild(world);
  marker.position.set(eye.x, eye.y, eye.z);
  updateBodyVisibility();
  updateEnergy();
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
    return result;
  }
  for (const ev of result.events) {
    if (ev.type === 'harvested') flash(`+${ev.energy} ${ev.kind}`);
    if (ev.type === 'placed' && intent.type === 'place') flash(`−${ev.energy} ${ev.kind}`);
    if (ev.type === 'transferred') flash('transferred');
    if (ev.type === 'scattered') flash(`scattered! −${SCATTER_COST}`);
  }
  if (intent.type === 'transfer') faceToward(from);
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
  const hit = castRay(world.terrain, eye, look.direction(), occludersOf(world), world.player.cell);
  if (!hit || hit.kind === 'slope' || hit.cell === world.player.cell) {
    target = null;
    highlight.hide();
    return;
  }
  target = { cell: hit.cell, canAct: visible[hit.cell] === 1 };
  highlight.show(world.terrain, hit.cell, target.canAct);
}

function describeTarget(cell: number): string {
  const stack = world.stacks[cell];
  const top = topOf(world, cell);
  if (!top) return 'empty tile';
  const shards = stack.filter((e) => e.kind === 'shard').length;
  const parts = [];
  if (shards) parts.push(`${shards} shard${shards > 1 ? 's' : ''}`);
  if (top.kind !== 'shard') parts.push(top.kind);
  return `${parts.join(' + ')} (top worth ${ENERGY[top.kind]})`;
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
      : `click/H harvest · 1 shard(${ENERGY.shard}) 2 husk(${ENERGY.husk}) 3 seed(${ENERGY.seed}) · R transfer · X scatter(${SCATTER_COST})`,
  );
  lines.push(`seed ${seed} · V visible tiles · O orbit · N new level`);
  hud.innerText = lines.join('\n');
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === 'n') return loadSeed(Math.floor(Math.random() * 1_000_000));
  if (key === 'v') return void (overlay.mesh.visible = !overlay.mesh.visible);
  if (key === 'o') return setMode(mode === 'orbit' ? 'first-person' : 'orbit');
  if (mode !== 'first-person') return;
  if (key === 'x') return void act({ type: 'scatter' });
  if (!target) return;
  const cell = target.cell;
  if (key === 'h') act({ type: 'harvest', cell });
  else if (key === '1') act({ type: 'place', cell, kind: 'shard' });
  else if (key === '2') act({ type: 'place', cell, kind: 'husk' });
  else if (key === '3') act({ type: 'place', cell, kind: 'seed' });
  else if (key === 'r') act({ type: 'transfer', cell });
});

canvas.addEventListener('mousedown', (e) => {
  if (mode === 'first-person' && look.locked && e.button === 0 && target) act({ type: 'harvest', cell: target.cell });
});

const param = Number(new URLSearchParams(window.location.search).get('seed'));
loadSeed(Number.isFinite(param) && param > 0 ? param : Math.floor(Math.random() * 1_000_000));
setMode('first-person');

const clock = new THREE.Clock();
view.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'first-person') {
    look.update(dt);
    const eye = playerEye(world);
    const d = look.direction();
    view.camera.position.set(eye.x, eye.y, eye.z);
    view.camera.lookAt(eye.x + d.x, eye.y + d.y, eye.z + d.z);
  } else {
    orbit.update();
  }
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
    visibleCount: () => visible.reduce((a, v) => a + v, 0),
    visible: () => visible,
  };
}
