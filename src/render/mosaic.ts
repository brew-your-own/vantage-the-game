import * as THREE from 'three';
import { hash2 } from '../core/rng';

/** The Keeper's and Relays' stained-glass tones: indigo, violet and teal facets. */
export const MOSAIC_TONES = [0x3a3a9a, 0x5a3aa0, 0x2a7a9a, 0x7a3a8a, 0x2a4a8a] as const;
/** Gold trim (the Keeper's gallery, the Relays' caps). */
export const MOSAIC_GOLD = 0xd8a040;
/** The lamp hood. */
export const MOSAIC_HOOD = 0x3a3a9a;

const VERTEX_COLORS = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * A tapered prism, standing on y = 0, whose side faces are split into `rows` bands and each
 * facet painted one of MOSAIC_TONES (picked by `seed`, so every object has its own pattern).
 * Caps take the first tone.
 */
export function mosaicPrism(rTop: number, rBottom: number, height: number, sides: number, rows: number, seed: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, sides, rows).toNonIndexed();
  g.rotateY(Math.PI / sides);
  g.translate(0, height / 2, 0);
  const torso = sides * rows * 2;
  const triangles = g.attributes.position.count / 3;
  const color = new THREE.Color();
  const colors: number[] = [];
  for (let t = 0; t < triangles; t++) {
    // The side is built column by column, each column's rows top to bottom, two triangles a facet.
    const facet = Math.floor(t / 2);
    const tone =
      t < torso ? MOSAIC_TONES[Math.floor(hash2(Math.floor(facet / rows), facet % rows, seed) * MOSAIC_TONES.length)] : MOSAIC_TONES[0];
    color.setHex(tone);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, VERTEX_COLORS);
}

/** A plain flat-shaded material, for trim. */
export const trim = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
