/**
 * Chapter three: shadow puzzles. The player's shadow is solid on the paper,
 * and each hand's shape is a tool (see tools.ts).
 * Pure 2D simulation in wall meters (origin at the wall center, +y up), so
 * Node tests can drive it with drawn masks. No Three.js, no DOM.
 */
import type { HandPose } from './hand-model.js';
import { GRID_H, GRID_W, WALL_H, WALL_W } from './silhouette.js';
import type { Tool } from './tools.js';

/** A hand and forearm held as a slide that fills the rain cup (planned in tools/plan-puzzles.ts). */
export const RAIN_SOLUTION: HandPose = {
  hand: 'right',
  pos: [-0.12, -0.22, -0.42],
  rot: [0, 0, 54],
  thumb: { out: 0.05, opp: 0 },
  index: { splay: 2 },
  middle: { splay: 0 },
  ring: { splay: -2 },
  pinky: { splay: -4 },
};

export type PuzzleId = 'rain' | 'bowl' | 'fireflies' | 'pearls' | 'ice' | 'garden';

export interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  /** Fireflies: caught in the jar. */
  caught?: boolean;
  phase: number;
  /** Tool puzzles: a pearl of light (round, heavy, bigger) instead of a raindrop. */
  pearl?: boolean;
  /** Held in a bowl: the hand index (0 right, 1 left), or -1. */
  held?: number;
  ox?: number;
  oy?: number;
}

export interface PuzzleInfo {
  id: PuzzleId;
  name: string;
  hint: string;
  done: string;
  /** Shown after a while with no luck. */
  tip?: string;
  /** The shapes that work in this puzzle; 'any' = every shadow counts. */
  tools: Tool[] | 'any';
}

export const PUZZLES: PuzzleInfo[] = [
  {
    id: 'rain',
    name: 'The Rain',
    hint: 'Your shadow is solid. Hold your hand flat to make a slide, and guide the rain into the cup.',
    done: 'The cup is full. The paper smells of rain.',
    tools: ['slide'],
  },
  {
    id: 'bowl',
    name: 'The Bowl',
    hint: 'Cup your hand, palm up, to catch the rain. Carry it to the high cup and turn your hand over.',
    done: 'You carried the rain in your hand.',
    tip: 'Tip: hold the bowl still under the cloud until it is full, then lift it over the cup and turn it over.',
    tools: ['bowl'],
  },
  {
    id: 'fireflies',
    name: 'The Fireflies',
    hint: 'Fireflies fly away from shadow. Herd them into the jar with your hands.',
    done: 'Every firefly glows in the jar.',
    tip: 'Tip: sweep an open hand from right to left, then lay it flat and press down over the jar.',
    tools: 'any',
  },
  {
    id: 'pearls',
    name: 'The Pearls',
    hint: 'Spread your fingers to make a sieve: rain falls through, pearls roll off. Roll the pearls to the shell.',
    done: 'Rain in the cup, pearls in the shell.',
    tip: 'A pearl in the cup spills it. Hold the sieve under the cloud, tilted down toward the shell.',
    tools: ['sieve'],
  },
  {
    id: 'ice',
    name: 'The Frozen Cloud',
    hint: 'The cloud is frozen. Knock the ice with your fist, then make a slide for the rain.',
    done: 'The ice is gone and the cup is full.',
    tools: ['stone', 'slide'],
  },
  {
    id: 'garden',
    name: 'The Moon Garden',
    hint: 'Free the cloud, water the seed, and fill the lantern with pearls. Every tool works here.',
    done: 'The moon flower opens.',
    tip: 'Tip: a sieve over a slide sorts them: pearls roll one way, rain slides the other.',
    tools: ['slide', 'bowl', 'sieve', 'stone'],
  },
];

const CELL_X = WALL_W / GRID_W;
const CELL_Y = WALL_H / GRID_H;

/** Is the wall point inside the shadow mask? */
export function solidAt(mask: Uint8Array, x: number, y: number): boolean {
  const gx = Math.floor((x + WALL_W / 2) / CELL_X);
  const gy = Math.floor((y + WALL_H / 2) / CELL_Y);
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return false;
  return mask[gy * GRID_W + gx] === 1;
}

/** Outward normal of the shadow near a point: away from the nearby shadow cells. */
function shadowNormal(mask: Uint8Array, x: number, y: number, reach: number, out: [number, number]): number {
  const gx0 = Math.floor((x + WALL_W / 2) / CELL_X);
  const gy0 = Math.floor((y + WALL_H / 2) / CELL_Y);
  const rx = Math.ceil(reach / CELL_X);
  const ry = Math.ceil(reach / CELL_Y);
  let sx = 0, sy = 0, n = 0;
  for (let gy = gy0 - ry; gy <= gy0 + ry; gy++) {
    if (gy < 0 || gy >= GRID_H) continue;
    for (let gx = gx0 - rx; gx <= gx0 + rx; gx++) {
      if (gx < 0 || gx >= GRID_W) continue;
      if (!mask[gy * GRID_W + gx]) continue;
      const cx = (gx + 0.5) * CELL_X - WALL_W / 2;
      const cy = (gy + 0.5) * CELL_Y - WALL_H / 2;
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > reach * reach) continue;
      const w = 1 - Math.sqrt(d2) / reach;
      sx += dx * w;
      sy += dy * w;
      n += w;
    }
  }
  const l = Math.hypot(sx, sy);
  if (l < 1e-9) {
    out[0] = 0;
    out[1] = 1;
  } else {
    out[0] = sx / l;
    out[1] = sy / l;
  }
  return n;
}

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ------------------------------------------------------------ tool puzzles

/** One hand as the tool puzzles see it. */
export interface HandInput {
  /** This hand's whole shadow (forearm included) on the grid. */
  mask: Uint8Array;
  /** The tool it makes; null = no hand, or a shape this puzzle does not allow (a ghost, not solid). */
  tool: Tool | null;
  /** Palm center on the wall (meters) and its velocity (meters per second). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** +1 palm up, -1 palm down. */
  palmUp: number;
}

export interface Target {
  /** What it collects. */
  kind: 'rain' | 'pearl';
  style: 'cup' | 'pot' | 'shell' | 'lantern';
  x: number;
  y: number;
  w: number;
  h: number;
  goal: number;
  count: number;
  /** A pearl that falls in knocks the rain out. */
  spill?: boolean;
}

export interface Cloud {
  x: number;
  y: number;
  w: number;
}

interface Layout {
  cloud: Cloud;
  /** Knocks with a fist to break the ice (0: not frozen). */
  ice: number;
  /** Every n-th thing from the cloud is a pearl (0: rain only). */
  pearlEvery: number;
  targets: Target[];
  /** A drawn shelf under a high target (scenery only). */
  shelf?: { x: number; y: number; w: number };
}

function layoutFor(id: PuzzleId, g: boolean): Layout {
  const T = (kind: Target['kind'], style: Target['style'], x: number, y: number, w: number, h: number, goal: number, gentleGoal: number, spill = false): Target => ({
    kind, style, x, y, w: g ? w + 0.06 : w, h, goal: g ? gentleGoal : goal, count: 0, spill,
  });
  switch (id) {
    case 'bowl':
      return {
        cloud: { x: -0.42, y: 0.07, w: 0.16 }, ice: 0, pearlEvery: 0,
        targets: [T('rain', 'cup', 0.42, 0.04, 0.2, 0.12, 10, 6)],
        shelf: { x: 0.42, y: -0.025, w: 0.32 },
      };
    case 'pearls':
      return {
        cloud: { x: -0.24, y: 0.07, w: 0.14 }, ice: 0, pearlEvery: 3,
        targets: [T('rain', 'cup', -0.24, -0.42, 0.22, 0.12, 10, 6, true), T('pearl', 'shell', 0.56, -0.44, 0.28, 0.12, 4, 3)],
      };
    case 'ice':
      return {
        cloud: { x: -0.38, y: 0.07, w: 0.18 }, ice: g ? 1 : 3, pearlEvery: 0,
        targets: [T('rain', 'cup', 0.32, -0.42, 0.24, 0.12, 10, 6)],
      };
    case 'garden':
      return {
        cloud: { x: -0.2, y: 0.07, w: 0.14 }, ice: g ? 1 : 2, pearlEvery: 3,
        targets: [T('rain', 'pot', -0.52, -0.4, 0.2, 0.12, 8, 5, true), T('pearl', 'lantern', 0.58, -0.42, 0.18, 0.16, 3, 2)],
      };
    default:
      return {
        cloud: { x: -0.4, y: 0.06, w: 0.18 }, ice: 0, pearlEvery: 0,
        targets: [T('rain', 'cup', 0.3, -0.42, 0.24, 0.12, 12, 8)],
      };
  }
}

/** Pearl radius on the paper (meters): too big to fall between spread fingers. */
export const PEARL_R = 0.02;
/** How many drops one bowl can hold. */
const BOWL_CAP = 10;
const MAX_DOTS = 28;

/**
 * The tool puzzles: rain (and pearls) fall from a cloud, maybe frozen, onto
 * the player's shadow tools, and must reach their targets.
 */
export class ToolPuzzle {
  readonly id: PuzzleId;
  readonly cloud: Cloud;
  readonly targets: Target[];
  readonly shelf?: { x: number; y: number; w: number };
  readonly drops: Dot[] = [];
  /** Knocks left before the ice breaks (0: free). */
  ice: number;
  readonly iceMax: number;
  /** Sounds and moments for the game to play, cleared by the game each frame. */
  readonly events: string[] = [];
  private pearlEvery: number;
  private spawned = 0;
  private spawnIn = 0;
  private n: [number, number] = [0, 1];
  private rainMask: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  private pearlMask: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  private touchingIce = false;
  private knockWait = 0;
  private one: HandInput[] = [{ mask: this.rainMask, tool: 'slide', x: 0, y: 0, vx: 0, vy: 0, palmUp: 0 }];
  static readonly MAX = MAX_DOTS;

  constructor(id: PuzzleId | boolean, gentle?: boolean | number, s = 7, layout: { cloudX?: number; cupX?: number; cupW?: number } = {}) {
    // old form: new ToolPuzzle(gentle, seed, layout) is the rain puzzle
    if (typeof id === 'boolean') {
      s = typeof gentle === 'number' ? gentle : s;
      gentle = id;
      id = 'rain';
    }
    this.id = id;
    seed = s;
    const l = layoutFor(id, !!gentle);
    if (layout.cloudX !== undefined) l.cloud.x = layout.cloudX;
    if (layout.cupX !== undefined) l.targets[0].x = layout.cupX;
    if (layout.cupW !== undefined) l.targets[0].w = gentle ? layout.cupW + 0.06 : layout.cupW;
    this.cloud = l.cloud;
    this.targets = l.targets;
    this.shelf = l.shelf;
    this.ice = this.iceMax = l.ice;
    this.pearlEvery = l.pearlEvery;
    for (let i = 0; i < MAX_DOTS; i++) this.drops.push({ x: 0, y: 0, vx: 0, vy: 0, alive: false, phase: 0, held: -1 });
  }

  /** The first target (the cup in the rain puzzle). */
  get cup() {
    return this.targets[0];
  }
  get collected() {
    return this.targets[0].count;
  }
  get goal() {
    return this.targets[0].goal;
  }
  get solved() {
    return this.targets.every((t) => t.count >= t.goal);
  }
  /** Where the ice sits around the cloud. */
  get iceBox() {
    const c = this.cloud;
    return { x0: c.x - c.w / 2 - 0.06, x1: c.x + c.w / 2 + 0.06, y0: c.y - 0.04, y1: c.y + 0.1 };
  }
  heldBy(h: number) {
    let n = 0;
    for (const d of this.drops) if (d.alive && d.held === h) n++;
    return n;
  }

  /** `input`: a single mask (one slide, as in the first puzzle) or both hands with their tools. */
  step(dt: number, input: Uint8Array | HandInput[]) {
    let hands: HandInput[];
    if (input instanceof Uint8Array) {
      this.one[0].mask = input;
      hands = this.one;
      this.rainMask = input;
      this.pearlMask = input;
    } else {
      hands = input;
      if (this.rainMask === this.pearlMask) {
        this.rainMask = new Uint8Array(GRID_W * GRID_H);
        this.pearlMask = new Uint8Array(GRID_W * GRID_H);
      }
      this.rainMask.fill(0);
      this.pearlMask.fill(0);
      for (const h of hands) {
        if (h.tool !== 'slide' && h.tool !== 'stone' && h.tool !== 'sieve') continue;
        const both = h.tool !== 'sieve';
        const m = h.mask;
        for (let i = 0; i < m.length; i++) {
          if (!m[i]) continue;
          this.pearlMask[i] = 1;
          if (both) this.rainMask[i] = 1;
        }
      }
    }
    this.updateIce(dt, hands);

    // a new drop (or pearl) every 0.22 s from under the cloud, once it is free
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.ice === 0) {
      this.spawnIn = 0.22;
      const d = this.drops.find((x) => !x.alive);
      if (d) {
        this.spawned++;
        d.alive = true;
        d.pearl = this.pearlEvery > 0 && this.spawned % this.pearlEvery === 0;
        d.held = -1;
        d.x = this.cloud.x + (rnd() - 0.5) * this.cloud.w;
        d.y = this.cloud.y - 0.03;
        d.vx = 0;
        d.vy = -0.05;
        d.phase = rnd();
      }
    }

    let caught = false;
    let poured = false;
    for (const d of this.drops) {
      if (!d.alive) continue;
      const hi = d.held ?? -1;
      if (hi >= 0) {
        const h = hands[hi];
        if (!h || h.tool !== 'bowl' || h.palmUp < -0.25) {
          // the bowl opens or turns over: pour
          d.held = -1;
          d.vx = (h?.vx ?? 0) * 0.5;
          d.vy = Math.min(0, (h?.vy ?? 0) * 0.5);
          poured = true;
        } else {
          // the water pools in the middle of the bowl and rides along with it
          d.phase += dt;
          const px = Math.cos(d.phase * 2.1 + d.x * 40) * 0.028;
          const py = 0.012 + Math.sin(d.phase * 1.7) * 0.01;
          const k = Math.min(1, dt * 2.5);
          d.ox = (d.ox ?? 0) + (px - (d.ox ?? 0)) * k;
          d.oy = (d.oy ?? 0) + (py - (d.oy ?? 0)) * k;
          d.x = h.x + d.ox;
          d.y = h.y + d.oy;
          d.vx = h.vx;
          d.vy = h.vy;
          continue;
        }
      }
      this.move(d, dt);
      // a bowl catches what falls into it
      for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        if (h.tool !== 'bowl' || h.palmUp < -0.15) continue;
        if (!solidAt(h.mask, d.x, d.y) || this.heldBy(i) >= BOWL_CAP) continue;
        d.held = i;
        d.ox = d.x - h.x;
        d.oy = d.y - h.y;
        caught = true;
        break;
      }
      if (d.held !== undefined && d.held >= 0) continue;
      this.collect(d);
    }
    if (caught) this.events.push('catch');
    if (poured) this.events.push('pour');
  }

  private hit(mask: Uint8Array, x: number, y: number, r: number) {
    if (solidAt(mask, x, y)) return true;
    if (r <= 0) return false;
    return solidAt(mask, x + r, y) || solidAt(mask, x - r, y) || solidAt(mask, x, y - r) || solidAt(mask, x, y + r) ||
      solidAt(mask, x + r * 0.7, y - r * 0.7) || solidAt(mask, x - r * 0.7, y - r * 0.7);
  }

  private move(d: Dot, dt: number) {
    const mask = d.pearl ? this.pearlMask : this.rainMask;
    const r = d.pearl ? PEARL_R : 0;
    const G = -0.9;
    const sub = 3;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      d.vy += G * h;
      const nx = d.x + d.vx * h;
      const ny = d.y + d.vy * h;
      if (this.hit(mask, nx, ny, r)) {
        // land on the shadow and slide (rain) or roll and bounce a little (pearls)
        shadowNormal(mask, d.x, d.y, 0.04 + r, this.n);
        const vn = d.vx * this.n[0] + d.vy * this.n[1];
        if (vn < 0) {
          const k = d.pearl ? 1.3 : 1.15;
          d.vx -= this.n[0] * vn * k;
          d.vy -= this.n[1] * vn * k;
        }
        const f = d.pearl ? 0.995 : 0.985;
        d.vx *= f;
        d.vy *= f;
        const tx = d.x + d.vx * h;
        const ty = d.y + d.vy * h;
        if (!this.hit(mask, tx, ty, r)) {
          d.x = tx;
          d.y = ty;
        } else {
          d.x += this.n[0] * CELL_X * 0.5 + d.vx * h;
          d.y += this.n[1] * CELL_Y * 0.5 + d.vy * h;
        }
      } else {
        d.x = nx;
        d.y = ny;
      }
    }
    // pearls bounce off the edges of the page and fall to its corners
    const edge = WALL_W / 2 - 0.035 - r;
    if (d.pearl && Math.abs(d.x) > edge) {
      d.x = Math.sign(d.x) * edge;
      d.vx = -d.vx * 0.3;
    }
    // drops on paper drift; they never get fast (pearls roll a bit faster)
    const max = d.pearl ? 0.5 : 0.38;
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > max) {
      d.vx *= max / sp;
      d.vy *= max / sp;
    }
  }

  private collect(d: Dot) {
    for (const t of this.targets) {
      if (Math.abs(d.x - t.x) < t.w / 2 && d.y < t.y + t.h / 2 && d.y > t.y - t.h / 2) {
        d.alive = false;
        const kind = d.pearl ? 'pearl' : 'rain';
        if (kind === t.kind) {
          t.count++;
          this.events.push(kind === 'pearl' ? 'pearl' : 'drop');
        } else if (d.pearl && t.spill) {
          t.count = Math.max(0, t.count - 3);
          this.events.push('spill');
        }
        return;
      }
    }
    if (d.y < -WALL_H / 2 - 0.05 || Math.abs(d.x) > WALL_W / 2 + 0.05) d.alive = false;
  }

  /** A fist knocks the ice: each new touch is one knock. */
  private updateIce(dt: number, hands: HandInput[]) {
    this.knockWait = Math.max(0, this.knockWait - dt);
    if (this.ice <= 0) return;
    const b = this.iceBox;
    let touching = false;
    for (const h of hands) {
      if (h.tool !== 'stone') continue;
      for (let y = b.y0; y <= b.y1 && !touching; y += CELL_Y) {
        for (let x = b.x0; x <= b.x1; x += CELL_X) {
          if (solidAt(h.mask, x, y)) {
            touching = true;
            break;
          }
        }
      }
    }
    if (touching && !this.touchingIce && this.knockWait <= 0) {
      this.ice--;
      this.knockWait = 0.3;
      this.events.push(this.ice === 0 ? 'free' : 'knock');
      if (this.ice === 0) this.spawnIn = 0.4;
    }
    this.touchingIce = touching;
  }
}

/** The first puzzle under its old name: one slide, rain into the cup. */
export const RainPuzzle = ToolPuzzle;

// ------------------------------------------------------------- fireflies

export class FireflyPuzzle {
  readonly jar: { x: number; y: number; r: number };
  readonly flies: Dot[] = [];
  readonly goal: number;
  private n: [number, number] = [0, 1];

  constructor(gentle: boolean, s = 11) {
    seed = s;
    this.jar = { x: -0.55, y: -0.36, r: gentle ? 0.12 : 0.09 };
    const count = 6;
    this.goal = gentle ? 5 : 6;
    for (let i = 0; i < count; i++) {
      this.flies.push({
        x: 0.1 + rnd() * 0.55,
        y: -0.3 + rnd() * 0.5,
        vx: (rnd() - 0.5) * 0.05,
        vy: (rnd() - 0.5) * 0.05,
        alive: true,
        phase: rnd() * Math.PI * 2,
      });
    }
  }

  get caught() {
    return this.flies.filter((f) => f.caught).length;
  }

  get solved() {
    return this.caught >= this.goal;
  }

  step(dt: number, mask: Uint8Array) {
    const j = this.jar;
    for (const f of this.flies) {
      f.phase += dt * 3;
      if (f.caught) {
        // drift gently inside the jar
        f.x = j.x + Math.cos(f.phase * 0.7) * j.r * 0.45;
        f.y = j.y + Math.sin(f.phase * 0.9) * j.r * 0.45;
        continue;
      }
      // wander
      f.vx += (rnd() - 0.5) * 0.25 * dt;
      f.vy += (rnd() - 0.5) * 0.25 * dt;
      // flee from nearby shadow; harder the closer it is
      const near = shadowNormal(mask, f.x, f.y, 0.1, this.n);
      if (near > 0) {
        const push = Math.min(2.5, 0.6 + near * 0.25);
        f.vx += this.n[0] * push * dt;
        f.vy += this.n[1] * push * dt;
      }
      // slow down when calm, keep a speed limit
      const sp = Math.hypot(f.vx, f.vy);
      const max = near > 0 ? 0.35 : 0.08;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.vx *= 1 - dt * 0.4;
      f.vy *= 1 - dt * 0.4;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // stay on the paper
      const mx = WALL_W / 2 - 0.04;
      const my = WALL_H / 2 - 0.04;
      if (f.x < -mx || f.x > mx) {
        f.vx = -f.vx;
        f.x = Math.max(-mx, Math.min(mx, f.x));
      }
      if (f.y < -my || f.y > my) {
        f.vy = -f.vy;
        f.y = Math.max(-my, Math.min(my, f.y));
      }
      if (Math.hypot(f.x - j.x, f.y - j.y) < j.r) f.caught = true;
    }
  }
}
