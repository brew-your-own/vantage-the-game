import * as THREE from 'three';
import { HEX_SIZE, LEVEL_HEIGHT, TOP_INSET } from '../core/constants';
import { cornerOffset, hexToWorld } from '../core/hex';
import type { Terrain } from '../core/terrain';

export interface TerrainPalette {
  /** Three alternating tile-top colours (a proper 3-colouring of the hex grid). */
  tops: [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation];
  /** Flat bevel between tiles of equal height. */
  flat: THREE.ColorRepresentation;
  /** Sloped bevel between tiles of different height. */
  slope: THREE.ColorRepresentation;
  /** Island sides and underside. */
  skirt: THREE.ColorRepresentation;
}

export const DEFAULT_PALETTE: TerrainPalette = {
  tops: [0x3f8f4a, 0x4c9e55, 0x357d40],
  flat: 0x2f6e38,
  slope: 0x8a6a3c,
  skirt: 0x4a3a28,
};

/** World Y of the island's underside. */
export const BASE_Y = -1.5;

type V3 = [number, number, number];

/**
 * Builds one non-indexed BufferGeometry for the whole terrain:
 * - a flat inner hexagon per tile (the playable top),
 * - a quad per shared edge connecting neighbouring tops (flat or sloped),
 * - a triangle per inner vertex where three tiles meet,
 * - vertical skirts along the outer boundary plus an underside.
 */
export function buildTerrainGeometry(
  terrain: Terrain,
  palette = DEFAULT_PALETTE,
  /** Optional colour for chosen tile tops (the title screen paints its letters). */
  topColor?: (cell: number) => THREE.ColorRepresentation | null,
): THREE.BufferGeometry {
  const { grid, heights, params } = terrain;
  const positions: number[] = [];
  const colors: number[] = [];
  const tmp = new THREE.Color();

  const tops = palette.tops.map((c) => new THREE.Color(c));
  const flat = new THREE.Color(palette.flat);
  const slope = new THREE.Color(palette.slope);
  const skirt = new THREE.Color(palette.skirt);
  const white = new THREE.Color(0xffffff);

  const centers = grid.cells.map((c) => hexToWorld(c.q, c.r, HEX_SIZE));
  const corners = Array.from({ length: 6 }, (_, i) => cornerOffset(i, HEX_SIZE * TOP_INSET));
  const inner = (cell: number, corner: number): V3 => {
    const c = centers[cell];
    const o = corners[((corner % 6) + 6) % 6];
    return [c.x + o.x, heights[cell] * LEVEL_HEIGHT, c.z + o.z];
  };

  /** Pushes a triangle facing up (+Y), flipping winding if needed. */
  const triUp = (a: V3, b: V3, c: V3, color: THREE.Color) => {
    const ux = b[0] - a[0], uz = b[2] - a[2];
    const vx = c[0] - a[0], vz = c[2] - a[2];
    const ny = uz * vx - ux * vz; // Y component of (b-a) × (c-a)
    if (ny < 0) [b, c] = [c, b];
    pushTri(a, b, c, color);
  };
  const pushTri = (a: V3, b: V3, c: V3, color: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  };
  const bevelColor = (cells: number[]) => {
    const hs = cells.map((c) => heights[c]);
    const spread = Math.max(...hs) - Math.min(...hs);
    if (spread > 0) return tmp.copy(slope).multiplyScalar(1 - 0.12 * (spread - 1));
    // A flat joint between custom-coloured tops takes their colour, so they read as one shape.
    const custom = topColor && cells.every((c) => topColor(c) != null) ? topColor(cells[0]) : null;
    return custom != null ? tmp.set(custom) : flat;
  };

  for (let i = 0; i < grid.count; i++) {
    const { q, r } = grid.cells[i];
    const h = heights[i];

    // Tile top: lighter with altitude.
    const custom = topColor?.(i);
    const top = custom != null ? tmp.set(custom) : tmp.copy(tops[(((q - r) % 3) + 3) % 3]).lerp(white, (h / params.maxHeight) * 0.25);
    const c: V3 = [centers[i].x, h * LEVEL_HEIGHT, centers[i].z];
    for (let k = 0; k < 6; k++) triUp(c, inner(i, k), inner(i, k + 1), top);

    // Edge strips: this cell owns edges 0..2 so each shared edge is built once.
    for (let e = 0; e < 3; e++) {
      const j = grid.neighbor(i, e);
      if (j < 0) continue;
      const col = bevelColor([i, j]);
      const a0 = inner(i, e), a1 = inner(i, e + 1);
      const b0 = inner(j, e + 4), b1 = inner(j, e + 3);
      triUp(a0, a1, b1, col);
      triUp(a0, b1, b0, col);
    }

    // Corner triangles: this cell owns corners 0 and 1 (one per vertex class).
    for (const k of [0, 1]) {
      const b = grid.neighbor(i, k); // across edge k: my corner k is its corner k+4
      const cc = grid.neighbor(i, (k + 5) % 6); // across edge k-1: my corner k is its corner k+2
      if (b < 0 || cc < 0) continue;
      triUp(inner(i, k), inner(b, k + 4), inner(cc, k + 2), bevelColor([i, b, cc]));
    }
  }

  addSkirtAndBase(positions, colors, skirt);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); // non-indexed → flat face normals
  geometry.computeBoundingSphere();
  return geometry;
}

/** Finds surface edges used by only one triangle and extrudes them down to BASE_Y. */
function addSkirtAndBase(positions: number[], colors: number[], color: THREE.Color): void {
  const key = (i: number) =>
    `${positions[i].toFixed(3)},${positions[i + 1].toFixed(3)},${positions[i + 2].toFixed(3)}`;
  const edges = new Map<string, { a: number; b: number; count: number }>();
  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = t * 9 + e * 3;
      const b = t * 9 + ((e + 1) % 3) * 3;
      const ka = key(a), kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const entry = edges.get(k);
      if (entry) entry.count++;
      else edges.set(k, { a, b, count: 1 });
    }
  }

  const push = (...vs: V3[]) => {
    for (const v of vs) {
      positions.push(...v);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (const { a, b, count } of edges.values()) {
    if (count !== 1) continue;
    const pa: V3 = [positions[a], positions[a + 1], positions[a + 2]];
    const pb: V3 = [positions[b], positions[b + 1], positions[b + 2]];
    const qa: V3 = [pa[0], BASE_Y, pa[2]];
    const qb: V3 = [pb[0], BASE_Y, pb[2]];
    push(pa, qa, qb, pa, qb, pb); // side wall (material is double-sided)
    push([0, BASE_Y, 0], qb, qa); // underside fan (the map is star-shaped from its centre)
  }
}
