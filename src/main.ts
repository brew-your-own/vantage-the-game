import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_TERRAIN, generateTerrain } from './core/terrain';
import { GameScene } from './render/scene';
import { buildTerrainGeometry } from './render/terrainMesh';

// M1 debug viewer: seeded terrain + orbit camera.
// URL: ?seed=<number>. Keys: N = new random seed.

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const view = new GameScene(container);

const controls = new OrbitControls(view.camera, view.renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 2, 0);
view.camera.position.set(0, 28, 34);

const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
let terrainMesh: THREE.Mesh | null = null;

function loadSeed(seed: number): void {
  const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
  if (terrainMesh) {
    view.scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
  }
  terrainMesh = new THREE.Mesh(buildTerrainGeometry(terrain), material);
  view.scene.add(terrainMesh);

  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
  hud.textContent = `seed ${seed} · ${terrain.grid.count} tiles · [N] new seed · drag to orbit`;
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const param = Number(new URLSearchParams(window.location.search).get('seed'));
loadSeed(Number.isFinite(param) && param > 0 ? param : randomSeed());

window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') loadSeed(randomSeed());
});

view.renderer.setAnimationLoop(() => {
  controls.update();
  view.render();
});
