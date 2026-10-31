import * as THREE from 'three';

/** Lines of the low-resolution frame; the width follows the window's aspect ratio. */
export const RETRO_LINES = 300;
/** Colour levels per channel after dithering (6 → a 216-colour cube). */
export const RETRO_LEVELS = 6;

/**
 * The 80s look: the scene is drawn into a small render target, then scaled up with
 * nearest-neighbour sampling while a 4×4 ordered (Bayer) dither cuts it down to a
 * limited colour cube.
 */
export class RetroPass {
  readonly target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tFrame: { value: this.target.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        levels: { value: RETRO_LEVELS },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFrame;
        uniform vec2 resolution;
        uniform float levels;
        varying vec2 vUv;
        float bayer4(vec2 p) {
          int x = int(mod(p.x, 4.0));
          int y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
          return (float(m[i]) + 0.5) / 16.0;
        }
        vec3 toSrgb(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }
        void main() {
          vec2 px = floor(vUv * resolution);
          vec3 c = toSrgb(clamp(texture2D(tFrame, (px + 0.5) / resolution).rgb, 0.0, 1.0));
          float n = levels - 1.0;
          c = floor(c * n + bayer4(px)) / n;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  setSize(width: number, height: number): void {
    const h = Math.min(RETRO_LINES, height);
    const w = Math.max(1, Math.round((width / Math.max(1, height)) * h));
    this.target.setSize(w, h);
    (this.material.uniforms.resolution.value as THREE.Vector2).set(w, h);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
