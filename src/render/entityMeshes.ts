import * as THREE from 'three';
import { HUSK_HEIGHT, SHARD_HEIGHT } from '../core/constants';
import { hash2 } from '../core/rng';
import { cellTop } from '../core/surface';
import { type Entity, type EntityKind, type World } from '../core/world';

const mat = (color: number, emissive = 0x000000) =>
  new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });

const MATERIALS: Record<EntityKind, THREE.Material> = {
  shard: mat(0x6fd3e8, 0x0b2a33),
  husk: mat(0xb9a6e0, 0x1a1030),
  moss: mat(0xc8f060, 0x2a3a08),
  seed: mat(0xffa040, 0x3a1800),
};

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

const SHARD_GEOMETRY = shardGeometry();

function objectFor(e: Entity): THREE.Object3D {
  switch (e.kind) {
    case 'shard':
      return new THREE.Mesh(SHARD_GEOMETRY, MATERIALS.shard);
    case 'husk':
      return huskGroup();
    case 'moss':
      return mossGroup(e.id);
    case 'seed':
      return seedMesh();
  }
}

/** Scene objects for every entity in the world. Rebuilt whenever the world changes. */
export class EntityView {
  readonly group = new THREE.Group();
  /** Object for the player's current body, hidden in first person. */
  playerBody: THREE.Object3D | null = null;

  rebuild(world: World): void {
    for (const child of this.group.children) disposeNonShared(child);
    this.group.clear();
    this.playerBody = null;
    world.stacks.forEach((stack, cell) => {
      const base = cellTop(world.terrain, cell);
      let y = base.y;
      stack.forEach((e, i) => {
        const obj = objectFor(e);
        obj.position.set(base.x, y, base.z);
        if (e.kind === 'shard') y += SHARD_HEIGHT;
        this.group.add(obj);
        if (cell === world.player.cell && i === stack.length - 1) this.playerBody = obj;
      });
    });
  }
}

function disposeNonShared(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry !== SHARD_GEOMETRY) o.geometry.dispose();
  });
}
