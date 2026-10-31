import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pickStartCell } from './core/level';
import { DEFAULT_TERRAIN, type Terrain, generateTerrain } from './core/terrain';
import { type Vec3, castRay, eyeAt, visibleCells } from './core/visibility';
import { LookControls } from './input/controls';
import { TargetHighlight, VisibilityOverlay, createWispMarker } from './render/overlays';
import { GameScene } from './render/scene';
import { buildTerrainGeometry } from './render/terrainMesh';

// M2: first-person view from the Wisp's tile, with targeting and line of sight.
// URL: ?seed=<number>.
// Keys: N new seed · V show visible tiles · O orbit debug camera · T (debug) jump to target.

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
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
view.scene.add(highlight.group, overlay.mesh, marker);

let seed = 0;
let terrain: Terrain;
let terrainMesh: THREE.Mesh | null = null;
let eyeCell = 0;
let eye: Vec3 = { x: 0, y: 0, z: 0 };
let visible: Uint8Array = new Uint8Array(0);
let target: { cell: number; canAct: boolean } | null = null;
let mode: 'first-person' | 'orbit' = 'first-person';

function loadSeed(newSeed: number): void {
  seed = newSeed;
  terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
  if (terrainMesh) {
    view.scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  terrainMesh = new THREE.Mesh(buildTerrainGeometry(terrain), terrainMaterial);
  view.scene.add(terrainMesh);
  moveEye(pickStartCell(terrain, seed));

  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
}

/** Re-roots the Wisp on a cell; visibility is cached until the next move. */
function moveEye(cell: number): void {
  eyeCell = cell;
  eye = eyeAt(terrain, cell);
  visible = visibleCells(terrain, eye);
  overlay.update(terrain, visible);
  marker.position.set(eye.x, eye.y, eye.z);
}

function setMode(next: typeof mode): void {
  mode = next;
  orbit.enabled = mode === 'orbit';
  look.enabled = mode === 'first-person';
  marker.visible = mode === 'orbit';
  crosshair.style.display = mode === 'first-person' ? 'block' : 'none';
  if (mode === 'orbit') {
    document.exitPointerLock();
    orbit.target.set(eye.x, eye.y, eye.z);
    view.camera.position.set(eye.x + 12, eye.y + 14, eye.z + 12);
  }
}

function updateTarget(): void {
  if (mode !== 'first-person') {
    target = null;
    highlight.hide();
    return;
  }
  const hit = castRay(terrain, eye, look.direction());
  if (!hit || hit.surface.region === 'slope') {
    target = null;
    highlight.hide();
    return;
  }
  const cell = hit.surface.cell;
  target = { cell, canAct: visible[cell] === 1 };
  highlight.show(terrain, cell, target.canAct);
}

function updateHud(): void {
  const visibleCount = visible.reduce((a, v) => a + v, 0);
  const h = terrain.heights[eyeCell];
  const lines = [
    `seed ${seed} · standing on level ${h} · ${visibleCount}/${terrain.grid.count} tiles in view`,
  ];
  if (target) {
    const { q, r } = terrain.grid.cells[target.cell];
    lines.push(
      `target (${q},${r}) level ${terrain.heights[target.cell]} · ${target.canAct ? 'in sight' : 'hidden: cannot act'}`,
    );
  } else if (mode === 'first-person') {
    lines.push('no target');
  }
  lines.push(
    mode === 'first-person' && !look.locked
      ? 'click to look around (Esc to release) · arrows also turn'
      : '[V] visible tiles · [O] orbit view · [N] new seed · [T] debug jump',
  );
  hud.innerText = lines.join('\n');
}

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case 'n':
      loadSeed(Math.floor(Math.random() * 1_000_000));
      break;
    case 'v':
      overlay.mesh.visible = !overlay.mesh.visible;
      break;
    case 'o':
      setMode(mode === 'orbit' ? 'first-person' : 'orbit');
      break;
    case 't': // Debug only: real movement (transfer) arrives in M3.
      if (target?.canAct) moveEye(target.cell);
      break;
  }
});

const param = Number(new URLSearchParams(window.location.search).get('seed'));
loadSeed(Number.isFinite(param) && param > 0 ? param : Math.floor(Math.random() * 1_000_000));
setMode('first-person');

const clock = new THREE.Clock();
view.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'first-person') {
    look.update(dt);
    const d = look.direction();
    view.camera.position.set(eye.x, eye.y, eye.z);
    view.camera.lookAt(eye.x + d.x, eye.y + d.y, eye.z + d.z);
  } else {
    orbit.update();
  }
  updateTarget();
  updateHud();
  view.render();
});

// Dev-only handle for automated checks in the browser console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__vantage = {
    look,
    state: () => ({ seed, eyeCell, target, visibleCount: visible.reduce((a, v) => a + v, 0) }),
    moveEye,
  };
}
