import * as THREE from 'three';
import { Rng } from '../core/rng';

/** Renderer, scene, camera and lights, with resizing handled. */
export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x05060f);
    this.scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x302018, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(40, 30, 15);
    this.scene.add(sun);
    this.scene.add(createStarfield(new Rng(0x5eed)));

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
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
