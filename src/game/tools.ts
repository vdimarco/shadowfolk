/**
 * Shadow tools (chapter three). Each hand's shape picks one tool, read from
 * the tracked joints rather than from the shadow, so it works at any angle:
 *
 *   slide  flat hand, fingers together   rain and pearls run down it
 *   bowl   cupped hand (fingers half bent) catches and carries; turn the palm down to pour
 *   sieve  flat hand, fingers spread      rain falls through, pearls do not
 *   stone  fist                           solid and heavy: knocks ice loose
 *
 * Pure math, no Three.js, so Node tests can use it.
 */

export type Tool = 'slide' | 'bowl' | 'sieve' | 'stone';
export const TOOLS: Tool[] = ['slide', 'bowl', 'sieve', 'stone'];

export const TOOL_NAMES: Record<Tool, string> = {
  slide: 'Slide',
  bowl: 'Bowl',
  sieve: 'Sieve',
  stone: 'Stone',
};

/** How to make each tool, in a few words. */
export const TOOL_HOW: Record<Tool, string> = {
  slide: 'flat hand',
  bowl: 'cupped hand',
  sieve: 'spread fingers',
  stone: 'fist',
};

export interface HandFeatures {
  /** 1 = fingers straight, about 0.4 = a fist. */
  ext: number;
  /** Gap between neighboring fingertips / palm width: about 0.5 together, 0.75 spread. */
  spread: number;
  /** Up component of the direction the palm faces (+1 palm up, -1 palm down). */
  palmUp: number;
}

const dist = (j: Float32Array, a: number, b: number) =>
  Math.hypot(j[a * 3] - j[b * 3], j[a * 3 + 1] - j[b * 3 + 1], j[a * 3 + 2] - j[b * 3 + 2]);

/** Shape features of one hand (25 joints, theater space). */
export function handFeatures(j: Float32Array, side: 'left' | 'right', out: HandFeatures): HandFeatures {
  let ext = 0;
  for (const f of [5, 10, 15, 20]) {
    const chain = dist(j, f + 1, f + 2) + dist(j, f + 2, f + 3) + dist(j, f + 3, f + 4);
    ext += dist(j, f + 1, f + 4) / Math.max(chain, 1e-6);
  }
  out.ext = ext / 4;
  const palmW = Math.max(dist(j, 6, 21), 1e-6);
  out.spread = (dist(j, 9, 14) + dist(j, 14, 19) + dist(j, 19, 24)) / 3 / palmW;
  // palm normal: (wrist -> middle knuckle) x (index knuckle -> pinky knuckle)
  const ax = j[30] - j[0], ay = j[31] - j[1], az = j[32] - j[2];
  const bx = j[60] - j[15], by = j[61] - j[16], bz = j[62] - j[17];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  // for a right hand this normal points out of the palm; mirror it for a left hand
  out.palmUp = ((side === 'right' ? 1 : -1) * ny) / l;
  return out;
}

const EXT_OPEN = 0.93;
const EXT_FIST = 0.62;
const SPREAD = 0.66;
const HYST = 0.03;

/** The tool a hand shape makes, with a little stickiness to the current tool. */
export function classify(f: HandFeatures, current: Tool | null): Tool {
  const h = (t: Tool) => (current === t ? HYST : 0);
  if (f.ext < EXT_FIST + h('stone')) return 'stone';
  if (f.ext < EXT_OPEN + h('bowl') - h('slide') - h('sieve')) return 'bowl';
  return f.spread > SPREAD - h('sieve') + h('slide') ? 'sieve' : 'slide';
}

/** Follows one hand's tool; a new shape must hold for a moment before it counts. */
export class ToolTracker {
  tool: Tool | null = null;
  readonly f: HandFeatures = { ext: 1, spread: 0.5, palmUp: 0 };
  private pending: Tool | null = null;
  private pendingTime = 0;
  static readonly SETTLE = 0.12;

  update(j: Float32Array | null, side: 'left' | 'right', dt: number): Tool | null {
    if (!j) {
      this.tool = null;
      this.pending = null;
      return null;
    }
    handFeatures(j, side, this.f);
    const t = classify(this.f, this.tool);
    if (t === this.tool || this.tool === null) {
      this.tool = t;
      this.pending = null;
      return t;
    }
    if (t !== this.pending) {
      this.pending = t;
      this.pendingTime = 0;
    }
    this.pendingTime += dt;
    if (this.pendingTime >= ToolTracker.SETTLE) {
      this.tool = t;
      this.pending = null;
    }
    return this.tool;
  }
}
