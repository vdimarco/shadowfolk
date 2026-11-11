/**
 * Chapter three: shadow puzzles. The player's shadow is solid on the paper.
 * Pure 2D simulation in wall meters (origin at the wall center, +y up), so
 * Node tests can drive it with drawn masks. No Three.js, no DOM.
 */
import { GRID_H, GRID_W, WALL_H, WALL_W } from './silhouette.js';

export type PuzzleId = 'rain' | 'fireflies';

export interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  /** Fireflies: caught in the jar. */
  caught?: boolean;
  phase: number;
}

export interface PuzzleInfo {
  id: PuzzleId;
  name: string;
  hint: string;
  done: string;
}

export const PUZZLES: PuzzleInfo[] = [
  {
    id: 'rain',
    name: 'The Rain',
    hint: 'Your shadow is solid. Make a slide with your hand and arm, and guide the rain into the cup.',
    done: 'The cup is full. The paper smells of rain.',
  },
  {
    id: 'fireflies',
    name: 'The Fireflies',
    hint: 'Fireflies fly away from shadow. Herd them into the jar with your hands.',
    done: 'Every firefly glows in the jar.',
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

// ------------------------------------------------------------------ rain

export class RainPuzzle {
  readonly cloud = { x: -0.56, y: 0.13, w: 0.18 };
  readonly cup: { x: number; y: number; w: number; h: number };
  readonly goal: number;
  readonly drops: Dot[] = [];
  collected = 0;
  private spawnIn = 0;
  private n: [number, number] = [0, 1];
  static readonly MAX = 24;

  constructor(gentle: boolean, s = 7) {
    seed = s;
    this.cup = { x: 0.42, y: -0.42, w: gentle ? 0.22 : 0.16, h: 0.12 };
    this.goal = gentle ? 10 : 15;
    for (let i = 0; i < RainPuzzle.MAX; i++) this.drops.push({ x: 0, y: 0, vx: 0, vy: 0, alive: false, phase: 0 });
  }

  get solved() {
    return this.collected >= this.goal;
  }

  step(dt: number, mask: Uint8Array) {
    // a new drop every 0.22 s from under the cloud
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = 0.22;
      const d = this.drops.find((x) => !x.alive);
      if (d) {
        d.alive = true;
        d.x = this.cloud.x + (rnd() - 0.5) * this.cloud.w;
        d.y = this.cloud.y - 0.03;
        d.vx = 0;
        d.vy = -0.05;
        d.phase = rnd();
      }
    }
    const G = -0.9;
    const sub = 3;
    const h = dt / sub;
    for (const d of this.drops) {
      if (!d.alive) continue;
      for (let s = 0; s < sub; s++) {
        d.vy += G * h;
        const nx = d.x + d.vx * h;
        const ny = d.y + d.vy * h;
        if (solidAt(mask, nx, ny)) {
          // land on the shadow and slide along it
          shadowNormal(mask, d.x, d.y, 0.04, this.n);
          const vn = d.vx * this.n[0] + d.vy * this.n[1];
          if (vn < 0) {
            d.vx -= this.n[0] * vn * 1.15;
            d.vy -= this.n[1] * vn * 1.15;
          }
          d.vx *= 0.985;
          d.vy *= 0.985;
          // move along the surface with the new velocity; if that is blocked
          // too (a curved edge), lift the drop out along the normal
          const tx = d.x + d.vx * h;
          const ty = d.y + d.vy * h;
          if (!solidAt(mask, tx, ty)) {
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
      // drops on paper drift; they never get fast
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > 0.38) {
        d.vx *= 0.38 / sp;
        d.vy *= 0.38 / sp;
      }
      const c = this.cup;
      if (Math.abs(d.x - c.x) < c.w / 2 && d.y < c.y + c.h / 2 && d.y > c.y - c.h / 2) {
        d.alive = false;
        this.collected++;
      } else if (d.y < -WALL_H / 2 - 0.05 || Math.abs(d.x) > WALL_W / 2 + 0.05) {
        d.alive = false;
      }
    }
  }
}

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
