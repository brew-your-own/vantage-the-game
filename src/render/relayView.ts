import * as THREE from 'three';
import { access, wobble } from './access';
import { RELAY_HEIGHT } from '../core/constants';
import { cellTop } from '../core/surface';
import type { World } from '../core/world';
import { MOSAIC_GOLD, mosaicPrism, trim } from './mosaic';

const CAP = trim(MOSAIC_GOLD);
const LIVE = new THREE.MeshBasicMaterial({ color: 0xffd36a });
const DEAD = new THREE.MeshLambertMaterial({ color: 0x3a3a44, flatShading: true });

/** Relays: stained-glass obelisks with a glowing core that dies when drained. */
export class RelayView {
  readonly group = new THREE.Group();
  private cores: { core: THREE.Mesh; drained: boolean }[] = [];

  rebuild(world: World): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.group.clear();
    this.cores = [];
    for (const relay of world.relays) {
      const top = cellTop(world.terrain, relay.cell);
      const g = new THREE.Group();
      g.position.set(top.x, top.y, top.z);
      // Stained glass like the Keeper's, each Relay with its own pattern, under a gold cap.
      const shaft = mosaicPrism(0.16, 0.34, RELAY_HEIGHT * 0.8, 4, 4, 100 + relay.cell);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.16, RELAY_HEIGHT * 0.2, 4), CAP);
      cap.geometry.rotateY(Math.PI / 4);
      cap.position.y = RELAY_HEIGHT * 0.9;
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), relay.drained ? DEAD : LIVE);
      core.position.y = RELAY_HEIGHT + 0.25;
      g.add(shaft, cap, core);
      this.group.add(g);
      this.cores.push({ core, drained: relay.drained });
    }
  }

  animate(time: number): void {
    for (const { core, drained } of this.cores) {
      core.rotation.y = drained || access.reducedMotion ? 0 : time * 1.5;
      const s = drained ? 0.8 : 1 + wobble(0.15 * Math.sin(time * 4));
      core.scale.setScalar(s);
    }
  }
}
