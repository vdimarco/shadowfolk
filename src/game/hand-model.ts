/**
 * Pure hand math. No Three.js, no DOM, so Node tests can import it.
 *
 * Joint order follows the WebXR Hand Input spec (25 joints):
 * 0 wrist
 * 1-4   thumb: metacarpal, phalanx-proximal, phalanx-distal, tip
 * 5-9   index: metacarpal, phalanx-proximal, phalanx-intermediate, phalanx-distal, tip
 * 10-14 middle, 15-19 ring, 20-24 pinky (same layout as index)
 *
 * Theater space: origin at the seated head, -Z toward the paper wall, +Y up.
 */

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export const JOINT_COUNT = 25;

export type Handedness = 'left' | 'right';
export type Vec3 = [number, number, number];

/** A finger is either a curl amount (0 straight, 1 fist) or explicit angles in degrees. */
export type FingerSpec =
  | number
  | { mcp?: number; pip?: number; dip?: number; curl?: number; splay?: number };

export interface ThumbSpec {
  /** 0 = alongside the index finger, 1 = spread wide. */
  out?: number;
  /** 0 = in the palm plane, 1 = rotated across the palm. */
  opp?: number;
  /** 0 = straight, 1 = fully bent. */
  curl?: number;
}

export interface HandPose {
  hand: Handedness;
  /** Wrist position in theater space, meters. */
  pos: Vec3;
  /**
   * Rotation in degrees, applied as yaw (Y), then pitch (X), then roll (Z)
   * on top of the base pose. Base pose: palm faces the wall (-Z), fingers up.
   */
  rot?: Vec3;
  thumb?: ThumbSpec;
  index?: FingerSpec;
  middle?: FingerSpec;
  ring?: FingerSpec;
  pinky?: FingerSpec;
}

// ---------------------------------------------------------------- vec helpers

const DEG = Math.PI / 180;

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** Rodrigues rotation of v around unit axis k by angle a (radians). */
function rotate(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
  ];
}

// ------------------------------------------------------------ hand proportions

/** Local hand frame: +X toward the thumb, +Y toward the fingers, +Z out of the palm. */
const FINGERS = [
  // metacarpal base, knuckle, [proximal, intermediate, distal] lengths
  { base: [0.022, 0.025, 0] as Vec3, knuckle: [0.024, 0.09, 0] as Vec3, len: [0.04, 0.024, 0.022] },
  { base: [0.006, 0.027, 0] as Vec3, knuckle: [0.004, 0.092, 0] as Vec3, len: [0.045, 0.028, 0.024] },
  { base: [-0.01, 0.026, 0] as Vec3, knuckle: [-0.015, 0.086, 0] as Vec3, len: [0.042, 0.026, 0.023] },
  { base: [-0.024, 0.022, 0] as Vec3, knuckle: [-0.032, 0.076, 0] as Vec3, len: [0.032, 0.019, 0.021] },
];
const THUMB_BASE: Vec3 = [0.025, 0.012, 0.008];
const THUMB_LEN = [0.04, 0.032, 0.026];
const PALM_N: Vec3 = [0, 0, 1];
const DEFAULT_SPLAY = [6, 0, -5, -12];

function fingerAngles(spec: FingerSpec | undefined, i: number) {
  if (spec === undefined || typeof spec === 'number') {
    const c = spec ?? 0;
    return { mcp: c * 85, pip: c * 100, dip: c * 65, splay: DEFAULT_SPLAY[i] };
  }
  const c = spec.curl ?? 0;
  return {
    mcp: spec.mcp ?? c * 85,
    pip: spec.pip ?? c * 100,
    dip: spec.dip ?? c * 65,
    splay: spec.splay ?? DEFAULT_SPLAY[i],
  };
}

/** Build the 25 joints in the local hand frame. */
function localJoints(pose: HandPose): Vec3[] {
  const out: Vec3[] = new Array(JOINT_COUNT);
  out[0] = [0, 0, 0];

  // Thumb
  const t = pose.thumb ?? {};
  const outA = (20 + 50 * (t.out ?? 0.5)) * DEG;
  const opp = 60 * (t.opp ?? 0.2) * DEG;
  const curl = t.curl ?? 0;
  let d = norm(add(scale([Math.sin(outA), Math.cos(outA), 0], Math.cos(opp)), scale(PALM_N, Math.sin(opp))));
  const kT = norm(cross(d, PALM_N));
  let p = THUMB_BASE;
  out[1] = p;
  const thumbFlex = [curl * 25, curl * 55, curl * 75];
  for (let s = 0; s < 3; s++) {
    d = norm(rotate(d, kT, thumbFlex[s] * DEG));
    p = add(p, scale(d, THUMB_LEN[s]));
    out[2 + s] = p;
  }

  // Fingers
  const specs = [pose.index, pose.middle, pose.ring, pose.pinky];
  for (let f = 0; f < 4; f++) {
    const F = FINGERS[f];
    const a = fingerAngles(specs[f], f);
    const o = 5 + f * 5;
    out[o] = F.base;
    out[o + 1] = F.knuckle;
    const sp = -a.splay * DEG;
    let dir: Vec3 = [-Math.sin(sp), Math.cos(sp), 0];
    const k = norm(cross(dir, PALM_N));
    let q = F.knuckle;
    const flex = [a.mcp, a.pip, a.dip];
    for (let s = 0; s < 3; s++) {
      dir = norm(rotate(dir, k, flex[s] * DEG));
      q = add(q, scale(dir, F.len[s]));
      out[o + 2 + s] = q;
    }
  }
  return out;
}

/** Rotation matrix (row-major 3x3) for yaw (Y) then pitch (X) then roll (Z), degrees. */
function eulerMatrix(rot: Vec3): number[] {
  const [rx, ry, rz] = [rot[0] * DEG, rot[1] * DEG, rot[2] * DEG];
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(mul3(Ry, Rx), Rz);
}
function mul3(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
function apply3(m: number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Turn a synthetic pose into 25 joint positions in theater space.
 * Writes into `out` (length 75) and returns it.
 */
export function poseToJoints(pose: HandPose, out = new Float32Array(JOINT_COUNT * 3)): Float32Array {
  const local = localJoints(pose);
  // Base frame: palm faces -Z (the wall), fingers +Y.
  // Right hand: thumb side points to -X. Left hand: thumb side points to +X.
  const sx = pose.hand === 'right' ? -1 : 1;
  const R = eulerMatrix(pose.rot ?? [0, 0, 0]);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const l = local[j];
    const base: Vec3 = [sx * l[0], l[1], -l[2]];
    const w = apply3(R, base);
    out[j * 3] = w[0] + pose.pos[0];
    out[j * 3 + 1] = w[1] + pose.pos[1];
    out[j * 3 + 2] = w[2] + pose.pos[2];
  }
  return out;
}
