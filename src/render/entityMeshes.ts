import * as THREE from 'three';
import { HUSK_HEIGHT, SHARD_HEIGHT, SPIRE_GROW_TIME, SPIRE_STEP } from '../core/constants';
import { hash2 } from '../core/rng';
import { cellTop } from '../core/surface';
import { wobble } from './access';
import { ENERGY, type Entity, type EntityKind, type World, entityHeight, isSupport } from '../core/world';

const mat = (color: number, emissive = 0x000000) =>
  new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });

const MATERIALS: Record<Exclude<EntityKind, 'moss'>, THREE.Material> = {
  shard: mat(0x6fd3e8, 0x0b2a33),
  husk: mat(0xb9a6e0, 0x1a1030),
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

/** A soft round glow (white; tinted by the material colour), for moss halos and pools. */
const GLOW_TEXTURE = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const glowMaterial = { map: GLOW_TEXTURE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
const MOTE_GEOMETRY = new THREE.OctahedronGeometry(1);
const MOTE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xe8ff9a });
const MOTE_HALO = new THREE.SpriteMaterial({ ...glowMaterial, color: 0xd0ff70, opacity: 0.55 });
const POOL_GEOMETRY = (() => {
  const g = new THREE.PlaneGeometry(0.9, 0.9);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.01, 0);
  return g;
})();
const POOL_MATERIAL = new THREE.MeshBasicMaterial({ ...glowMaterial, color: 0xb8ff60, opacity: 0.35 });

/** A hovering mote of moss: bobs gently (see EntityView.animate). */
interface Mote {
  obj: THREE.Object3D;
  base: number;
  phase: number;
}

/** Moss: three specks of light hovering over a faint pool of glow, placed from the entity id. */
function mossGroup(id: number, motes: Mote[]): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(POOL_GEOMETRY, POOL_MATERIAL));
  for (let i = 0; i < 3; i++) {
    const mote = new THREE.Mesh(MOTE_GEOMETRY, MOTE_MATERIAL);
    mote.scale.setScalar(0.045 + hash2(id, i, 11) * 0.02);
    const halo = new THREE.Sprite(MOTE_HALO);
    halo.scale.setScalar(0.32);
    const o = new THREE.Group();
    o.add(mote, halo);
    const a = hash2(id, i, 13) * Math.PI * 2;
    const d = 0.08 + hash2(id, i, 17) * 0.2;
    const base = 0.25 + hash2(id, i, 19) * 0.3;
    o.position.set(Math.cos(a) * d, base, Math.sin(a) * d);
    motes.push({ obj: o, base, phase: hash2(id, i, 23) * Math.PI * 2 });
    g.add(o);
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

function objectFor(e: Entity, motes: Mote[]): THREE.Object3D {
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
      return mossGroup(e.id, motes);
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
  private motes: Mote[] = [];

  rebuild(world: World): void {
    for (const child of this.group.children) disposeNonShared(child);
    this.group.clear();
    this.playerBody = null;
    this.spires = [];
    this.motes = [];
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
          obj = objectFor(e, this.motes);
        }
        obj.position.set(base.x, y, base.z);
        if (isSupport(e)) y += entityHeight(e);
        this.group.add(obj);
        // Hide our own Husk in first person (a Spire under us stays visible).
        if (cell === world.player.cell && i === stack.length - 1 && e.kind === 'husk') this.playerBody = obj;
      });
    });
    this.animate(0);
  }

  /** Per-frame updates: Spires grow smoothly between simulation steps; moss motes bob. */
  animate(time: number): void {
    for (const m of this.motes) {
      m.obj.position.y = m.base + wobble(0.06 * Math.sin(time * 1.6 + m.phase));
      m.obj.rotation.y = wobble(time * 1.5 + m.phase);
    }
    for (const { entity, column, bulb } of this.spires) {
      const h = Math.max(0.05, spireVisualHeight(entity));
      column.scale.y = h;
      bulb.position.y = h + 0.12;
    }
  }
}

function disposeNonShared(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const shared = [SHARD_GEOMETRY, SPIRE_GEOMETRY, MOTE_GEOMETRY, POOL_GEOMETRY];
    if (o instanceof THREE.Mesh && !shared.includes(o.geometry)) o.geometry.dispose();
  });
}
