import * as THREE from 'three';
import { HEX_SIZE, TOP_INSET } from '../core/constants';
import { cornerOffset } from '../core/hex';
import { cellTop } from '../core/surface';
import type { Terrain } from '../core/terrain';
import { access } from './access';

const LIFT = 0.02;
/** Target colours: green / red, or blue / orange in colour-blind mode. */
const CAN_ACT = new THREE.Color(0x5dff7a);
const CANNOT_ACT = new THREE.Color(0xff4d4d);
const CAN_ACT_CB = new THREE.Color(0x4db8ff);
const CANNOT_ACT_CB = new THREE.Color(0xffa020);

function hexOutlinePoints(scale: number): THREE.Vector3[] {
  return Array.from({ length: 7 }, (_, i) => {
    const o = cornerOffset(i % 6, HEX_SIZE * TOP_INSET * scale);
    return new THREE.Vector3(o.x, 0, o.z);
  });
}

/**
 * Outline + translucent fill on the targeted tile when you can act there; a dashed outline
 * with no fill when you can't (so the two differ in shape, not only in colour).
 */
export class TargetHighlight {
  readonly group = new THREE.Group();
  private readonly lineMat = new THREE.LineBasicMaterial({ color: CAN_ACT, depthTest: false, transparent: true });
  private readonly dashMat = new THREE.LineDashedMaterial({
    color: CANNOT_ACT,
    depthTest: false,
    transparent: true,
    dashSize: 0.16,
    gapSize: 0.1,
  });
  private readonly fillMat = new THREE.MeshBasicMaterial({
    color: CAN_ACT,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly line: THREE.Line;
  private readonly dashed = new THREE.Group();
  private readonly fill: THREE.Mesh;

  constructor() {
    const points = hexOutlinePoints(0.92);
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.lineMat);
    // Two dashed rings: WebGL lines are one pixel wide, and one ring alone reads faintly.
    for (const scale of [0.92, 0.85]) {
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(hexOutlinePoints(scale)), this.dashMat);
      ring.computeLineDistances();
      ring.renderOrder = 10;
      this.dashed.add(ring);
    }
    this.line.renderOrder = 10;
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(HEX_SIZE * TOP_INSET * 0.92, 6), this.fillMat);
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.rotation.z = Math.PI / 6; // circle(6) has a corner at 0°; ours is pointy-top with corners at ±30°
    this.group.add(this.line, this.dashed, this.fill);
    this.group.visible = false;
  }

  show(terrain: Terrain, cell: number, canAct: boolean): void {
    const p = cellTop(terrain, cell);
    this.group.position.set(p.x, p.y + LIFT, p.z);
    const cb = access.colorBlind;
    this.lineMat.color.copy(cb ? CAN_ACT_CB : CAN_ACT);
    this.fillMat.color.copy(cb ? CAN_ACT_CB : CAN_ACT);
    this.dashMat.color.copy(cb ? CANNOT_ACT_CB : CANNOT_ACT);
    this.line.visible = this.fill.visible = canAct;
    this.dashed.visible = !canAct;
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}

const OVERLAY_VERTEX = `
varying vec2 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const OVERLAY_FRAGMENT = `
uniform vec3 color;
uniform float opacity;
uniform float striped;
varying vec2 vWorld;
void main() {
  // Diagonal stripes in world space, so the pattern runs on across neighbouring tiles.
  if (striped > 0.5 && fract((vWorld.x + vWorld.y) * 2.2) < 0.45) discard;
  gl_FragColor = vec4(color, opacity);
}`;

/** Overlay tinting a set of tiles (e.g. those in view, or those the Keeper can see). */
export class VisibilityOverlay {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(color: THREE.ColorRepresentation = 0x8cf0ff, opacity = 0.18) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        opacity: { value: opacity },
        striped: { value: 0 },
      },
      vertexShader: OVERLAY_VERTEX,
      fragmentShader: OVERLAY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
  }

  /** Changes the overlay's look: colour, opacity, and stripes (readable without colour). */
  setStyle(color: THREE.ColorRepresentation, opacity: number, striped: boolean): void {
    (this.material.uniforms.color.value as THREE.Color).set(color);
    this.material.uniforms.opacity.value = opacity;
    this.material.uniforms.striped.value = striped ? 1 : 0;
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
