import * as THREE from 'three';
import { LEVEL_HEIGHT } from '../core/constants';
import { cellTop } from '../core/surface';
import type { TitleLand } from '../core/title';
import { INTRO, type IntroPlan, introFrame, introPlan, keeperForm } from '../core/titleIntro';
import { wobble } from './access';
import type { KeeperView } from './keeperView';

const PILLAR_HEIGHT = 60;
/** What a letter's top warms toward as it glows: past full gold (vertex colours may exceed 1), so it shines. */
const HOT = [1.7, 1.3, 0.55];

/**
 * Plays the title's opening on the land's mesh: moves the vertices of the tiles that rise,
 * brightens the letters, forms the Keeper in a column of light and fades its beam in.
 */
export class TitleIntroView {
  readonly plan: IntroPlan;
  private readonly heights: Float32Array;
  private readonly glow: Float32Array;
  private readonly rise: Float32Array;
  /** Vertices that move, and the plan slot of the tile each belongs to. */
  private readonly verts: Int32Array;
  private readonly slotOf: Int32Array;
  /** Colours of the finished land, and of the bare ground it starts as (same vertex order). */
  private readonly baseColors: Float32Array;
  private readonly groundColors: Float32Array;
  /** Per vertex: the plan slot of the rising tile whose rise recolours it, or −1. */
  private readonly colorDriver: Int32Array;
  /** Per vertex: 1 on a letter's top (where the glow shows), 0 on its walls and elsewhere. */
  private readonly glowMask: Uint8Array;
  private readonly pillar: THREE.Mesh;
  private readonly keeperTop: THREE.Vector3;

  constructor(
    land: TitleLand,
    private readonly geometry: THREE.BufferGeometry,
    /** The bare ground's mesh (built from land.ground), whose colours the land starts with. */
    groundGeometry: THREE.BufferGeometry,
    private readonly keeper: KeeperView,
    private readonly keeperScale: number,
    private readonly scene: THREE.Scene,
  ) {
    this.plan = introPlan(land);
    const n = this.plan.cells.length;
    this.heights = new Float32Array(n);
    this.glow = new Float32Array(n);
    this.rise = new Float32Array(n);
    const slot = new Int32Array(land.terrain.grid.count).fill(-1);
    this.plan.cells.forEach((c, j) => (slot[c] = j));
    const cellOf = geometry.userData.cellOf as Int32Array;
    const verts: number[] = [];
    const slots: number[] = [];
    cellOf.forEach((c, v) => {
      if (c >= 0 && slot[c] >= 0) {
        verts.push(v);
        slots.push(slot[c]);
      }
    });
    this.verts = Int32Array.from(verts);
    this.slotOf = Int32Array.from(slots);
    this.baseColors = (geometry.getAttribute('color').array as Float32Array).slice();
    const groundColors = groundGeometry.getAttribute('color').array as Float32Array;
    // Same tiles, same order: only heights and colours differ. Fall back to no recolouring.
    this.groundColors = groundColors.length === this.baseColors.length ? groundColors : this.baseColors;
    const letters = new Set(land.letters);
    const rising = new Set([...land.letters, ...land.hill]);
    // A triangle touching a rising tile (its top, or a bevel down to the ground) recolours with it.
    // Only triangles wholly on letters glow: tops, and the flat joints between letter tiles.
    this.colorDriver = new Int32Array(cellOf.length).fill(-1);
    this.glowMask = new Uint8Array(cellOf.length);
    for (let v = 0; v + 2 < cellOf.length; v += 3) {
      const tri = [cellOf[v], cellOf[v + 1], cellOf[v + 2]];
      const owner = tri.find((c) => c >= 0 && rising.has(c));
      if (owner !== undefined) this.colorDriver.fill(slot[owner], v, v + 3);
      if (tri.every((c) => letters.has(c))) this.glowMask.fill(1, v, v + 3);
    }
    // The wave lifts letters above the heights the bounds were computed for.
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 2;

    const top = cellTop(land.terrain, land.keeperCell);
    this.keeperTop = new THREE.Vector3(top.x, top.y, top.z);
    // A column of light that falls onto the summit as the Keeper forms.
    const pillarGeo = new THREE.CylinderGeometry(1, 1, PILLAR_HEIGHT, 24, 1, true);
    pillarGeo.translate(0, PILLAR_HEIGHT / 2, 0);
    this.pillar = new THREE.Mesh(
      pillarGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffe2a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.pillar.position.copy(this.keeperTop);
    this.pillar.visible = false;
    scene.add(this.pillar);
  }

  /** Puts the land, Keeper and beam where they are `t` seconds into the title. */
  update(t: number): void {
    const { plan, heights, glow, rise } = this;
    introFrame(plan, t, wobble(1), heights, glow, rise);

    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const c = col.array as Float32Array;
    for (let k = 0; k < this.verts.length; k++) p[this.verts[k] * 3 + 1] = heights[this.slotOf[k]] * LEVEL_HEIGHT;
    // Colours: bare ground blending into the finished land as each tile rises; letters glow.
    const base = this.baseColors;
    const ground = this.groundColors;
    const driver = this.colorDriver;
    for (let v = 0; v < driver.length; v++) {
      const j = driver[v];
      if (j < 0) continue;
      const m = rise[j];
      const g = this.glowMask[v] ? glow[j] : 0;
      for (let ch = 0, o = v * 3; ch < 3; ch++, o++) {
        const x = ground[o] + (base[o] - ground[o]) * m;
        c[o] = x + (HOT[ch] - x) * g;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    // The lit-tile discs ride on the moving tiles.
    plan.cells.forEach((cell, j) => this.keeper.setTileHeight(cell, heights[j] * LEVEL_HEIGHT));

    this.updateKeeper(t);
  }

  private updateKeeper(t: number): void {
    const f = keeperForm(t);
    const k = this.keeper;
    // The Keeper flickers into being, stretching up out of its own light.
    const flicker = f > 0 && f < 0.6 && Math.sin(t * 90) + Math.sin(t * 57) > 1.2 * (1 - f);
    k.group.visible = f > 0 && !flicker;
    const up = f >= 1 ? 1 : 1 + 2.4 * (f - 1) ** 3 + 1.4 * (f - 1) ** 2;
    const wide = 0.35 + 0.65 * (1 - (1 - f) ** 3);
    k.group.scale.set(this.keeperScale * wide, this.keeperScale * Math.max(0.001, up), this.keeperScale * wide);
    k.beamFade = Math.min(1, Math.max(0, (t - INTRO.keeperStart - INTRO.keeperForm * 0.6) / 0.8));

    // The pillar: snaps on, then thins and fades as the Keeper solidifies.
    const pt = t - INTRO.keeperStart + 0.15;
    const life = INTRO.keeperForm + 0.7;
    const on = pt > 0 && pt < life;
    this.pillar.visible = on;
    if (on) {
      const s = pt / life;
      const mat = this.pillar.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, pt / 0.12) * (1 - s) ** 1.5 * 0.9;
      const r = 2.4 * (1 - s) + 0.15;
      this.pillar.scale.set(r, 1, r);
    }
  }

  /** Takes the pillar out of the scene; the mesh and Keeper are reset by whoever comes next. */
  dispose(): void {
    this.scene.remove(this.pillar);
    this.pillar.geometry.dispose();
    (this.pillar.material as THREE.Material).dispose();
  }
}
