import * as THREE from 'three';
import { mothHoverY } from '../core/sim';
import { cellTop } from '../core/surface';
import type { Moth, World } from '../core/world';

/** Seconds a Moth's glide between tiles takes on screen. */
const GLIDE = 0.6;

const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xff9ad5, emissive: 0x5a1040, flatShading: true });
const wingMaterial = new THREE.MeshBasicMaterial({
  color: 0xffd6f0,
  transparent: true,
  opacity: 0.75,
  side: THREE.DoubleSide,
});
const bodyGeometry = new THREE.OctahedronGeometry(0.12);
const wingGeometry = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.42, 0.05, -0.18, 0.36, 0, 0.22], 3));
  g.computeVertexNormals();
  return g;
})();

interface MothObject {
  root: THREE.Group;
  left: THREE.Mesh;
  right: THREE.Mesh;
}

function createMoth(): MothObject {
  const root = new THREE.Group();
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1, 0.8, 1.8);
  const left = new THREE.Mesh(wingGeometry, wingMaterial);
  const right = new THREE.Mesh(wingGeometry, wingMaterial);
  right.scale.x = -1;
  root.add(body, left, right);
  return { root, left, right };
}

/** Animated Moths: they glide between tiles, bob, flap, and grow with their energy. */
export class MothView {
  readonly group = new THREE.Group();
  private readonly objects = new Map<number, MothObject>();

  update(world: World, time: number): void {
    const alive = new Set<number>();
    for (const moth of world.moths) {
      alive.add(moth.id);
      let obj = this.objects.get(moth.id);
      if (!obj) {
        obj = createMoth();
        this.objects.set(moth.id, obj);
        this.group.add(obj.root);
      }
      this.place(world, moth, obj, time);
    }
    for (const [id, obj] of this.objects) {
      if (!alive.has(id)) {
        this.group.remove(obj.root);
        this.objects.delete(id);
      }
    }
  }

  /** World position of a Moth right now (used for picking too). */
  static position(world: World, moth: Moth, time = 0): THREE.Vector3 {
    const t = Math.min(1, moth.clock / GLIDE);
    const e = t * t * (3 - 2 * t);
    const a = cellTop(world.terrain, moth.prevCell);
    const b = cellTop(world.terrain, moth.cell);
    const y = mothHoverY(world, moth.prevCell) * (1 - e) + mothHoverY(world, moth.cell) * e;
    return new THREE.Vector3(a.x + (b.x - a.x) * e, y + 0.08 * Math.sin(time * 3 + moth.id), a.z + (b.z - a.z) * e);
  }

  private place(world: World, moth: Moth, obj: MothObject, time: number): void {
    obj.root.position.copy(MothView.position(world, moth, time));
    const a = cellTop(world.terrain, moth.prevCell);
    const b = cellTop(world.terrain, moth.cell);
    if (moth.prevCell !== moth.cell) obj.root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    const flap = Math.sin(time * 14 + moth.id) * 0.7;
    obj.left.rotation.z = flap;
    obj.right.rotation.z = -flap;
    obj.root.scale.setScalar(0.8 + 0.18 * Math.min(moth.energy, 6));
  }
}
