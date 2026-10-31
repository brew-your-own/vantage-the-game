import * as THREE from 'three';
import { HEX_SIZE, KEEPER_HEIGHT, TOP_INSET } from '../core/constants';
import { BEAM, tileLit } from '../core/keeper';
import { cellTop } from '../core/surface';
import type { World } from '../core/world';

const BEAM_LENGTH = 34;
const LIT_COLOR = new THREE.Color(0.42, 0.32, 0.09);
const DARK = new THREE.Color(0, 0, 0);

/** The Keeper's tower, its rotating lamp, the visible beam and the lit-tile overlay. */
export class KeeperView {
  readonly group = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private tiles: THREE.InstancedMesh | null = null;
  private lampVisible: Uint8Array = new Uint8Array(0);

  constructor() {
    const stone = new THREE.MeshLambertMaterial({ color: 0x3a3f55, flatShading: true });
    const towerHeight = KEEPER_HEIGHT - 0.45;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.6, towerHeight, 6), stone);
    tower.geometry.rotateY(Math.PI / 6);
    tower.position.y = towerHeight / 2;
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.12, 6), stone);
    gallery.position.y = towerHeight;

    const glow = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
    const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), glow);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 6), stone);
    hood.position.y = 0.3;
    // A lens pointing along the beam (+X before rotation).
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.26), glow);
    lens.position.x = 0.22;
    this.head.add(lamp, hood, lens);
    this.head.position.y = KEEPER_HEIGHT;

    this.beam = new THREE.Mesh(
      beamGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.beam.position.y = KEEPER_HEIGHT;
    this.group.add(tower, gallery, this.head, this.beam);
  }

  /** Call when the level loads. */
  build(world: World, scene: THREE.Scene): void {
    const top = cellTop(world.terrain, world.keeper.cell);
    this.group.position.set(top.x, top.y, top.z);

    if (this.tiles) {
      scene.remove(this.tiles);
      this.tiles.dispose();
    }
    const disc = new THREE.CircleGeometry(HEX_SIZE * TOP_INSET * 0.98, 6);
    disc.rotateZ(Math.PI / 6);
    disc.rotateX(-Math.PI / 2);
    const count = world.terrain.grid.count;
    this.tiles = new THREE.InstancedMesh(
      disc,
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      count,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const p = cellTop(world.terrain, i);
      this.tiles.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.015, p.z));
      this.tiles.setColorAt(i, DARK);
    }
    this.tiles.frustumCulled = false;
    scene.add(this.tiles);
  }

  /** Call when objects change (shadows move). */
  setLampVisibility(visible: Uint8Array): void {
    this.lampVisible = visible;
  }

  /** Call every frame. */
  update(world: World, time: number): void {
    // Three.js rotation.y turns +X toward −Z, while our yaw turns +X toward +Z.
    this.head.rotation.y = -world.keeper.yaw;
    this.beam.rotation.y = -world.keeper.yaw;
    const scale = Math.tan(BEAM.halfAngle) / Math.tan((15 * Math.PI) / 180);
    this.beam.scale.set(1, 1, scale);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.85 + 0.15 * Math.sin(time * 3);

    if (!this.tiles) return;
    for (let i = 0; i < this.lampVisible.length; i++) {
      this.tiles.setColorAt(i, tileLit(world, i, this.lampVisible[i] === 1) ? LIT_COLOR : DARK);
    }
    this.tiles.instanceColor!.needsUpdate = true;
  }
}

/**
 * A wedge of light along +X: apex at the lamp, widening to ±15°, sloping down onto the land,
 * and fading quadratically with distance so it doesn't read as a solid slab.
 */
function beamGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const near = new THREE.Color(0.11, 0.09, 0.04);
  const half = (15 * Math.PI) / 180;
  const arcSegments = 8;
  const rings = 8;
  const L = BEAM_LENGTH;
  const point = (r: number, a: number, side: 'top' | 'bottom'): number[] => [
    r * Math.cos(a),
    side === 'top' ? 0.05 * r : -0.2 * r,
    r * Math.sin(a),
  ];
  const shade = (r: number) => near.clone().multiplyScalar((1 - r / L) ** 2);
  const quad = (p: number[][], c: THREE.Color[]) => {
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      positions.push(...p[i], ...p[j], ...p[k]);
      for (const n of [i, j, k]) colors.push(c[n].r, c[n].g, c[n].b);
    }
  };
  for (let ri = 0; ri < rings; ri++) {
    const r0 = (L * ri) / rings;
    const r1 = (L * (ri + 1)) / rings;
    const c0 = shade(r0), c1 = shade(r1);
    for (let s = 0; s < arcSegments; s++) {
      const a0 = -half + (2 * half * s) / arcSegments;
      const a1 = -half + (2 * half * (s + 1)) / arcSegments;
      for (const side of ['top', 'bottom'] as const) {
        quad([point(r0, a0, side), point(r1, a0, side), point(r1, a1, side), point(r0, a1, side)], [c0, c1, c1, c0]);
      }
    }
    for (const a of [-half, half]) {
      quad([point(r0, a, 'top'), point(r1, a, 'top'), point(r1, a, 'bottom'), point(r0, a, 'bottom')], [c0, c1, c1, c0]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}
