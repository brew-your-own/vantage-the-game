import * as THREE from 'three';
import { HEX_SIZE, TOP_INSET } from '../core/constants';
import { cornerOffset } from '../core/hex';
import { cellTop } from '../core/surface';
import type { Terrain } from '../core/terrain';

const LIFT = 0.02;
const CAN_ACT = new THREE.Color(0x5dff7a);
const CANNOT_ACT = new THREE.Color(0xff4d4d);

function hexOutlinePoints(scale: number): THREE.Vector3[] {
  return Array.from({ length: 7 }, (_, i) => {
    const o = cornerOffset(i % 6, HEX_SIZE * TOP_INSET * scale);
    return new THREE.Vector3(o.x, 0, o.z);
  });
}

/** Outline + translucent fill on the targeted tile: green when you can act, red when not. */
export class TargetHighlight {
  readonly group = new THREE.Group();
  private readonly lineMat = new THREE.LineBasicMaterial({ color: CAN_ACT, depthTest: false, transparent: true });
  private readonly fillMat = new THREE.MeshBasicMaterial({
    color: CAN_ACT,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  constructor() {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hexOutlinePoints(0.92)), this.lineMat);
    line.renderOrder = 10;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(HEX_SIZE * TOP_INSET * 0.92, 6), this.fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.rotation.z = Math.PI / 6; // circle(6) has a corner at 0°; ours is pointy-top with corners at ±30°
    this.group.add(line, fill);
    this.group.visible = false;
  }

  show(terrain: Terrain, cell: number, canAct: boolean): void {
    const p = cellTop(terrain, cell);
    this.group.position.set(p.x, p.y + LIFT, p.z);
    const color = canAct ? CAN_ACT : CANNOT_ACT;
    this.lineMat.color.copy(color);
    this.fillMat.color.copy(color);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}

/** Debug overlay tinting every tile visible from the current eye. */
export class VisibilityOverlay {
  readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x8cf0ff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.visible = false;
  }

  update(terrain: Terrain, visible: Uint8Array): void {
    const corners = Array.from({ length: 6 }, (_, i) => cornerOffset(i, HEX_SIZE * TOP_INSET * 0.8));
    const positions: number[] = [];
    visible.forEach((v, cell) => {
      if (!v) return;
      const p = cellTop(terrain, cell);
      for (let k = 0; k < 6; k++) {
        const a = corners[k], b = corners[(k + 1) % 6];
        positions.push(p.x, p.y + LIFT, p.z, p.x + b.x, p.y + LIFT, p.z + b.z, p.x + a.x, p.y + LIFT, p.z + a.z);
      }
    });
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BufferGeometry();
    this.mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }
}

/** Marker showing where the Wisp stands (only useful in the orbit debug camera). */
export function createWispMarker(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.25),
    new THREE.MeshBasicMaterial({ color: 0xfff27a, wireframe: true }),
  );
  mesh.visible = false;
  return mesh;
}
