/**
 * Pure shadow math shared by the GPU shadow pass and the CPU matcher.
 * Hands become 3D capsules. A point lamp projects each capsule onto the
 * paper wall as a 2D tapered capsule with a soft edge (penumbra).
 */

import { JOINT_COUNT } from './hand-model.js';

/** Theater layout, meters. Origin = seated head. */
export const WALL_Z = -1.3;
export const WALL_CY = 0.0;
export const WALL_W = 1.6;
export const WALL_H = 1.1;
/** The lamp sits low and behind, like a lantern on a side table. */
export const LIGHT: [number, number, number] = [0, -0.3, 0.2];
/** Flame size; larger gives softer shadows. */
export const LIGHT_SIZE = 0.009;

/** Max 2D segments the shader accepts (2 hands * SEGS_PER_HAND). */
export const SEGS_PER_HAND = 32;
export const MAX_SEGS = SEGS_PER_HAND * 2;

/** [a, b, rA, rB] capsule list per hand, joint indices plus radii (meters). */
export const CAPSULES: [number, number, number, number][] = [
  // palm fan
  [0, 6, 0.021, 0.014],
  [0, 11, 0.022, 0.014],
  [0, 16, 0.021, 0.013],
  [0, 21, 0.019, 0.012],
  [6, 11, 0.013, 0.013],
  [11, 16, 0.013, 0.013],
  [16, 21, 0.012, 0.012],
  [0, 1, 0.02, 0.016],
  // palm fill between the fan spokes
  [5, 11, 0.02, 0.016],
  [10, 16, 0.02, 0.016],
  [15, 21, 0.019, 0.014],
  [1, 6, 0.016, 0.013],
  // soft tissue: the web between thumb and index, the fleshy outer palm
  // under the little finger, and the thumb's base
  [2, 6, 0.009, 0.008],
  [20, 21, 0.017, 0.013],
  [0, 20, 0.021, 0.018],
  [1, 5, 0.018, 0.016],
  // thumb
  [1, 2, 0.015, 0.012],
  [2, 3, 0.012, 0.0105],
  [3, 4, 0.0105, 0.009],
  // index
  [6, 7, 0.0105, 0.0095],
  [7, 8, 0.0095, 0.0088],
  [8, 9, 0.0088, 0.008],
  // middle
  [11, 12, 0.011, 0.0098],
  [12, 13, 0.0098, 0.009],
  [13, 14, 0.009, 0.0082],
  // ring
  [16, 17, 0.0102, 0.0092],
  [17, 18, 0.0092, 0.0085],
  [18, 19, 0.0085, 0.0078],
  // pinky
  [21, 22, 0.009, 0.0082],
  [22, 23, 0.0082, 0.0076],
  [23, 24, 0.0076, 0.007],
];
/** Index of the forearm slot (always last per hand). */
export const FOREARM_SLOT = SEGS_PER_HAND - 1;

/**
 * Projected segments for the wall. Layout per segment, 8 floats:
 * ax, ay, ar, as, bx, by, br, bs  (x/y in wall meters from wall center,
 * r = radius on the wall, s = penumbra half-width on the wall).
 * A segment with ar <= 0 is unused.
 */
export class SegmentBuffer {
  readonly data = new Float32Array(MAX_SEGS * 8);
  count = 0;
  clear() {
    this.data.fill(0);
    this.count = 0;
  }
}

const tmp = new Float32Array(4);

/** Project a theater-space point onto the wall. Returns false if behind the lamp. */
function project(x: number, y: number, z: number, r: number, out: Float32Array): boolean {
  const dz = z - LIGHT[2];
  if (dz > -0.03) return false; // too close to or behind the lamp
  const t = (WALL_Z - LIGHT[2]) / dz;
  if (z < WALL_Z) return false; // beyond the wall
  out[0] = LIGHT[0] + (x - LIGHT[0]) * t;
  out[1] = LIGHT[1] + (y - LIGHT[1]) * t - WALL_CY;
  out[2] = r * t;
  // penumbra: flame size * (occluder->wall) / (lamp->occluder)
  out[3] = Math.max(0.003, (LIGHT_SIZE * (z - WALL_Z)) / -dz);
  return true;
}

/** Project one theater-space point onto the wall. Returns null if it casts no shadow. */
export function projectPoint(x: number, y: number, z: number, out: [number, number]): [number, number] | null {
  if (!project(x, y, z, 0, tmp)) return null;
  out[0] = tmp[0];
  out[1] = tmp[1];
  return out;
}

export interface ProjectOptions {
  /** Include the forearm capsule (visual only; the matcher skips it). */
  forearm?: boolean;
  /** Head-relative shoulder used to guess the elbow. */
  shoulderX?: number;
}

/**
 * Append one hand's projected capsules into buf at slot base `slot0`.
 * joints: 75 floats in theater space.
 */
export function projectHand(
  joints: Float32Array,
  buf: SegmentBuffer,
  slot0: number,
  opts: ProjectOptions = {},
) {
  const d = buf.data;
  for (let i = 0; i < CAPSULES.length; i++) {
    const [ja, jb, ra, rb] = CAPSULES[i];
    const o = (slot0 + i) * 8;
    const okA = project(joints[ja * 3], joints[ja * 3 + 1], joints[ja * 3 + 2], ra, tmp);
    d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = tmp[3];
    const okB = project(joints[jb * 3], joints[jb * 3 + 1], joints[jb * 3 + 2], rb, tmp);
    d[o + 4] = tmp[0]; d[o + 5] = tmp[1]; d[o + 6] = tmp[2]; d[o + 7] = tmp[3];
    if (!okA || !okB) d[o + 2] = 0;
  }
  // Forearm: guess an elbow 0.24 m back from the wrist, along the hand axis
  // blended with the line from the shoulder.
  const fo = (slot0 + FOREARM_SLOT) * 8;
  d[fo + 2] = 0;
  if (opts.forearm) {
    const wx = joints[0], wy = joints[1], wz = joints[2];
    const mx = joints[11 * 3], my = joints[11 * 3 + 1], mz = joints[11 * 3 + 2];
    let hx = wx - mx, hy = wy - my, hz = wz - mz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    hx /= hl; hy /= hl; hz /= hl;
    const sx = opts.shoulderX ?? 0;
    let ux = wx - sx, uy = wy + 0.25, uz = wz - 0.05;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let ex = hx * 0.6 - ux * 0.4, ey = hy * 0.6 - uy * 0.4, ez = hz * 0.6 - uz * 0.4;
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el; ey /= el; ez /= el;
    const L = 0.24;
    const okA = project(wx + ex * L, wy + ey * L, wz + ez * L, 0.032, tmp);
    d[fo] = tmp[0]; d[fo + 1] = tmp[1]; d[fo + 2] = tmp[2]; d[fo + 3] = tmp[3];
    const okB = project(wx, wy, wz, 0.024, tmp);
    d[fo + 4] = tmp[0]; d[fo + 5] = tmp[1]; d[fo + 6] = tmp[2]; d[fo + 7] = tmp[3];
    if (!okA || !okB) d[fo + 2] = 0;
  }
  buf.count = Math.max(buf.count, slot0 + SEGS_PER_HAND);
}

/** Clear one hand's slots (hand not tracked). */
export function clearHand(buf: SegmentBuffer, slot0: number) {
  buf.data.fill(0, slot0 * 8, (slot0 + SEGS_PER_HAND) * 8);
}

// --------------------------------------------------------------- CPU raster

export const GRID_W = 128;
export const GRID_H = 88;

/** Rasterize segments into a binary mask over the wall. Skips forearm slots. */
export function rasterize(buf: SegmentBuffer, mask: Uint8Array, skipForearm = true): number {
  mask.fill(0);
  const d = buf.data;
  const sx = WALL_W / GRID_W;
  const sy = WALL_H / GRID_H;
  let area = 0;
  for (let s = 0; s < MAX_SEGS; s++) {
    if (skipForearm && s % SEGS_PER_HAND === FOREARM_SLOT) continue;
    const o = s * 8;
    const ar = d[o + 2];
    if (ar <= 0) continue;
    const ax = d[o], ay = d[o + 1], bx = d[o + 4], by = d[o + 5], br = d[o + 6];
    const rmax = Math.max(ar, br);
    const minX = Math.max(0, Math.floor((Math.min(ax, bx) - rmax + WALL_W / 2) / sx));
    const maxX = Math.min(GRID_W - 1, Math.ceil((Math.max(ax, bx) + rmax + WALL_W / 2) / sx));
    const minY = Math.max(0, Math.floor((Math.min(ay, by) - rmax + WALL_H / 2) / sy));
    const maxY = Math.min(GRID_H - 1, Math.ceil((Math.max(ay, by) + rmax + WALL_H / 2) / sy));
    const vx = bx - ax, vy = by - ay;
    const vv = vx * vx + vy * vy || 1e-9;
    for (let gy = minY; gy <= maxY; gy++) {
      const py = (gy + 0.5) * sy - WALL_H / 2;
      for (let gx = minX; gx <= maxX; gx++) {
        const idx = gy * GRID_W + gx;
        if (mask[idx]) continue;
        const px = (gx + 0.5) * sx - WALL_W / 2;
        let t = ((px - ax) * vx + (py - ay) * vy) / vv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + vx * t - px, qy = ay + vy * t - py;
        const r = ar + (br - ar) * t;
        if (qx * qx + qy * qy <= r * r) {
          mask[idx] = 1;
          area++;
        }
      }
    }
  }
  return area;
}

// ------------------------------------------------------------------ matcher

/** Canonical grid for position- and size-free shape comparison. */
const CAN = 64;
const CAN_EXTENT = 2.4; // canonical half-size in units of sqrt(area)

export interface ShapeStats {
  area: number;
  cx: number;
  cy: number;
}

export function shapeStats(mask: Uint8Array): ShapeStats {
  let area = 0, sx = 0, sy = 0;
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      if (mask[y * GRID_W + x]) {
        area++;
        sx += x;
        sy += y;
      }
  return { area, cx: area ? sx / area : 0, cy: area ? sy / area : 0 };
}

/** Resample a mask into the canonical frame (centered, unit area scale). */
export function canonicalize(mask: Uint8Array, st: ShapeStats, out: Uint8Array, mirror = false) {
  out.fill(0);
  if (st.area < 4) return;
  const k = (Math.sqrt(st.area) * CAN_EXTENT * 2) / CAN;
  for (let y = 0; y < CAN; y++) {
    const gy = Math.round(st.cy + (y - CAN / 2 + 0.5) * k);
    if (gy < 0 || gy >= GRID_H) continue;
    for (let x = 0; x < CAN; x++) {
      const cxo = (x - CAN / 2 + 0.5) * k;
      const gx = Math.round(st.cx + (mirror ? -cxo : cxo));
      if (gx < 0 || gx >= GRID_W) continue;
      out[y * CAN + x] = mask[gy * GRID_W + gx];
    }
  }
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0, u = 0;
  for (let n = 0; n < a.length; n++) {
    const x = a[n], y = b[n];
    if (x | y) {
      u++;
      if (x & y) i++;
    }
  }
  return u ? i / u : 0;
}

/**
 * Shape matcher. Free in position and size, optionally free in mirror,
 * strict in orientation. Returns 0..1.
 */
export class Matcher {
  private target = new Uint8Array(CAN * CAN);
  private targetArea = 0;
  /** Stats of the target and of the last scored mask (grid units). */
  targetStats: ShapeStats = { area: 0, cx: 0, cy: 0 };
  lastStats: ShapeStats = { area: 0, cx: 0, cy: 0 };
  /** True when the last best score came from the mirrored shape. */
  lastMirrored = false;
  private a = new Uint8Array(CAN * CAN);
  private b = new Uint8Array(CAN * CAN);

  setTarget(mask: Uint8Array) {
    const st = shapeStats(mask);
    this.targetArea = st.area;
    this.targetStats = st;
    canonicalize(mask, st, this.target);
  }

  score(mask: Uint8Array, allowMirror: boolean): number {
    return this.scoreWithStats(mask, shapeStats(mask), allowMirror);
  }

  /** Same as score(), with the mask's stats computed once by the caller. */
  scoreWithStats(mask: Uint8Array, st: ShapeStats, allowMirror: boolean): number {
    this.lastStats = st;
    this.lastMirrored = false;
    if (st.area < 8 || this.targetArea < 8) return 0;
    canonicalize(mask, st, this.a, false);
    let s = iou(this.a, this.target);
    if (allowMirror) {
      canonicalize(mask, st, this.b, true);
      const m = iou(this.b, this.target);
      if (m > s) {
        s = m;
        this.lastMirrored = true;
      }
    }
    return s;
  }
}

export { JOINT_COUNT };

/** Grid cell center to wall meters. */
export function gridToWall(gx: number, gy: number): [number, number] {
  return [((gx + 0.5) * WALL_W) / GRID_W - WALL_W / 2, ((gy + 0.5) * WALL_H) / GRID_H - WALL_H / 2];
}
/** Grid area (cells) to wall area scale factor sqrt -> meters. */
export const CELL = WALL_W / GRID_W;
