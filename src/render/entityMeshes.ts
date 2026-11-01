import * as THREE from 'three';
import { HUSK_HEIGHT, SHARD_HEIGHT, SPIRE_GROW_TIME, SPIRE_STEP } from '../core/constants';
import { hash2 } from '../core/rng';
import { cellTop } from '../core/surface';
import { ENERGY, type Entity, type EntityKind, type World, entityHeight, isSupport } from '../core/world';

const mat = (color: number, emissive = 0x000000) =>
  new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });

const MATERIALS: Record<EntityKind, THREE.Material> = {
  shard: mat(0x6fd3e8, 0x0b2a33),
  husk: mat(0xb9a6e0, 0x1a1030),
  moss: mat(0xc8f060, 0x2a3a08),
  seed: mat(0xffa040, 0x3a1800),
};
const SPIRE_MATERIAL = mat(0xd98a3a, 0x2a1000);

function shardGeometry(): THREE.BufferGeometry {
  // Hexagonal crystal block, aligned with the pointy-top tiles.
  const g = new THREE.CylinderGeometry(0.4, 0.44, SHARD_HEIGHT * 0.96, 6);
  g.rotateY(Math.PI / 6);
  g.translate(0, (SHARD_HEIGHT * 0.96) / 2, 0);
  return g;
}

function huskGroup(): THREE.Group {
  // A tall, faceless figure: tapered body plus a floating head.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, HUSK_HEIGHT * 0.72, 5), MATERIALS.husk);
  body.position.y = (HUSK_HEIGHT * 0.72) / 2;
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), MATERIALS.husk);
  head.position.y = HUSK_HEIGHT * 0.86;
  const g = new THREE.Group();
  g.add(body, head);
  return g;
}

function mossGroup(id: number): THREE.Group {
  // A few low, glowing lumps, laid out pseudo-randomly from the entity id.
  const g = new THREE.Group();
  const n = 3 + Math.floor(hash2(id, 0, 7) * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.1 + hash2(id, i, 11) * 0.09;
    const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), MATERIALS.moss);
    const a = hash2(id, i, 13) * Math.PI * 2;
    const d = hash2(id, i, 17) * 0.28;
    lump.position.set(Math.cos(a) * d, r * 0.5, Math.sin(a) * d);
    lump.scale.y = 0.6;
    g.add(lump);
  }
  return g;
}

function seedMesh(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), MATERIALS.seed);
  m.scale.y = 1.35;
  m.position.y = 0.22;
  return m;
}

/** Unit-height tapered column; scaled vertically to the Spire's current height. */
const SPIRE_GEOMETRY = (() => {
  const g = new THREE.CylinderGeometry(0.2, 0.36, 1, 6);
  g.rotateY(Math.PI / 6);
  g.translate(0, 0.5, 0);
  return g;
})();

/** A Spire: a column topped by its glowing bulb. Height is set by EntityView.animate. */
function spireGroup(): { group: THREE.Group; column: THREE.Mesh; bulb: THREE.Mesh } {
  const column = new THREE.Mesh(SPIRE_GEOMETRY, SPIRE_MATERIAL);
  const bulb = seedMesh();
  const group = new THREE.Group();
  group.add(column, bulb);
  return { group, column, bulb };
}

/** Current visual height of a Spire, including progress on the level it is growing. */
export function spireVisualHeight(e: Entity): number {
  const growing = e.grow ? 1 - e.grow / SPIRE_GROW_TIME : 0;
  return ((e.level ?? 0) + growing) * SPIRE_STEP;
}

const SHARD_GEOMETRY = shardGeometry();

function objectFor(e: Entity): THREE.Object3D {
  switch (e.kind) {
    case 'shard':
      return new THREE.Mesh(SHARD_GEOMETRY, MATERIALS.shard);
    case 'husk': {
      // A Husk the beam is draining wastes away: thinner as its energy goes (same height,
      // since it still blocks sight as tall as before).
      const g = huskGroup();
      const left = 1 - (e.drained ?? 0) / ENERGY.husk;
      g.scale.set(0.35 + 0.65 * left, 1, 0.35 + 0.65 * left);
      return g;
    }
    case 'moss':
      return mossGroup(e.id);
    case 'seed':
      return seedMesh(); // replaced by a Spire in EntityView once fed
  }
}

/** Scene objects for every entity in the world. Rebuilt whenever the world changes. */
export class EntityView {
  readonly group = new THREE.Group();
  /** Object for the player's current body, hidden in first person. */
  playerBody: THREE.Object3D | null = null;
  private spires: { entity: Entity; column: THREE.Mesh; bulb: THREE.Mesh }[] = [];

  rebuild(world: World): void {
    for (const child of this.group.children) disposeNonShared(child);
    this.group.clear();
    this.playerBody = null;
    this.spires = [];
    world.stacks.forEach((stack, cell) => {
      const base = cellTop(world.terrain, cell);
      let y = base.y;
      stack.forEach((e, i) => {
        let obj: THREE.Object3D;
        if (e.kind === 'seed' && ((e.level ?? 0) > 0 || e.grow)) {
          const spire = spireGroup();
          this.spires.push({ entity: e, column: spire.column, bulb: spire.bulb });
          obj = spire.group;
        } else {
          obj = objectFor(e);
        }
        obj.position.set(base.x, y, base.z);
        if (isSupport(e)) y += entityHeight(e);
        this.group.add(obj);
        // Hide our own Husk in first person (a Spire under us stays visible).
        if (cell === world.player.cell && i === stack.length - 1 && e.kind === 'husk') this.playerBody = obj;
      });
    });
    this.animate();
  }

  /** Per-frame updates: Spires grow smoothly between simulation steps. */
  animate(): void {
    for (const { entity, column, bulb } of this.spires) {
      const h = Math.max(0.05, spireVisualHeight(entity));
      column.scale.y = h;
      bulb.position.y = h + 0.12;
    }
  }
}

function disposeNonShared(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry !== SHARD_GEOMETRY && o.geometry !== SPIRE_GEOMETRY) o.geometry.dispose();
  });
}
