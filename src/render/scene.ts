import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { LevelPalette } from './palettes';
import { RetroPass } from './retro';

/** Renderer, scene, camera and lights, with resizing handled. */
export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  /** Low resolution + ordered dither. On by default; G toggles it. */
  retro = true;
  private readonly retroPass = new RetroPass();
  private readonly hemi = new THREE.HemisphereLight(0xc8d8ff, 0x302018, 0.9);
  private readonly sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  private readonly stars: THREE.Points;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x05060f);
    this.scene.add(this.hemi);
    this.sun.position.set(40, 30, 15);
    this.scene.add(this.sun);
    this.stars = createStarfield(new Rng(0x5eed));
    this.scene.add(this.stars);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyPalette(p: LevelPalette): void {
    (this.scene.background as THREE.Color).setHex(p.sky);
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.sun.color.setHex(p.sun);
    (this.stars.material as THREE.PointsMaterial).color.setHex(p.stars);
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.retroPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (this.retro) this.retroPass.render(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }
}

function createStarfield(rng: Rng, count = 1500, radius = 300): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform point on a sphere.
    const u = rng.range(-1, 1);
    const t = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - u * u);
    positions.set([radius * s * Math.cos(t), radius * u, radius * s * Math.sin(t)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xbfc8ff, size: 1.2, sizeAttenuation: false });
  return new THREE.Points(geometry, material);
}
