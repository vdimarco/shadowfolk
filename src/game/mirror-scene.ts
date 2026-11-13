/**
 * Shadow Mirror: a toy with no rules and no score (the lesson of Nex
 * Playground's most-played game, a mirror of playful filters). The paper
 * plays with your shadow: a twin that copies you a beat late, echoes that
 * trail your moves, a giant behind you. Sparks follow your fingertips, and
 * your hands play music: the shape picks the instrument, the height the note.
 * Make a fist to change the magic.
 */
import type { WebGLRenderer } from '@iwsdk/core';
import type { Instrument, Sfx } from './audio.js';
import type { HandMusic } from './music.js';
import { projectPoint, SegmentBuffer, SEGS_PER_HAND } from './silhouette.js';
import type { Theater } from './theater.js';
import { type Tool, ToolTracker } from './tools.js';

export type MirrorMagic = 'twin' | 'echo' | 'giant';
const MAGICS: { id: MirrorMagic; name: string; line: string; aura: [number, number, number] }[] = [
  { id: 'twin', name: 'The Twin', line: 'Your shadow twin copies you, a beat late. Can you dance together?', aura: [0.6, 0.55, 1.0] },
  { id: 'echo', name: 'Echoes', line: 'Every move leaves echoes in the night. Swoop and swirl!', aura: [0.35, 0.8, 1.0] },
  { id: 'giant', name: 'The Giant', line: 'A giant shadow rises behind you. Wave hello!', aura: [1.0, 0.6, 0.3] },
];
/** Each tool shape is an instrument here. */
const TOOL_SOUND: Record<Tool, Instrument> = { slide: 'harp', bowl: 'marimba', sieve: 'bells', stone: 'bigdrum' };

/** About 1.2 s of shadow history at 72 fps. */
const HISTORY = 90;
const FLOATS = SEGS_PER_HAND * 2 * 8;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class MirrorScene {
  private history: Float32Array[] = [];
  private times = new Float64Array(HISTORY);
  private head = 0;
  private filled = 0;
  private out = new SegmentBuffer(4);
  private trackers = [new ToolTracker(), new ToolTracker()];
  private lastTool: (Tool | null)[] = [null, null];
  private tips: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  private sparks: Spark[] = [];
  private pt: [number, number] = [0, 0];
  private time = 0;
  private seed = 9;
  magic = 0;
  active = false;

  constructor(
    private theater: Theater,
    private sfx: Sfx,
    private music: HandMusic,
  ) {
    for (let i = 0; i < HISTORY; i++) this.history.push(new Float32Array(FLOATS));
  }

  get name() {
    return MAGICS[this.magic].name;
  }

  start() {
    this.active = true;
    this.filled = 0;
    this.head = 0;
    this.sparks.length = 0;
    this.lastTool = [null, null];
    this.inkPanel();
  }

  stop() {
    this.active = false;
    const u = this.theater.wallMat.uniforms;
    u.uTargetAlpha.value = 0;
    u.uDotCount.value = 0;
    u.uTargetAura.value.setRGB(1.0, 0.72, 0.3);
  }

  /** The delayed shadow `sec` seconds ago (or the oldest kept). */
  private ago(sec: number): Float32Array | null {
    if (this.filled === 0) return null;
    const now = this.times[(this.head - 1 + HISTORY) % HISTORY];
    for (let k = 1; k <= this.filled; k++) {
      const i = (this.head - k + HISTORY) % HISTORY;
      if (now - this.times[i] >= sec || k === this.filled) return this.history[i];
    }
    return null;
  }

  /** Copy one delayed shadow (both hands) into the output at slot0, moved, mirrored and scaled about the paper's center. */
  private place(src: Float32Array, slot0: number, dx: number, mirror: boolean, scale: number, cy = 0) {
    const d = this.out.data;
    for (let i = 0; i < SEGS_PER_HAND * 2; i++) {
      const o = i * 8;
      const w = (slot0 + i) * 8;
      if (src[o + 2] <= 0) {
        d[w + 2] = 0;
        continue;
      }
      for (const e of [0, 4]) {
        const x = src[o + e] * (mirror ? -1 : 1);
        d[w + e] = x * scale + dx;
        d[w + e + 1] = (src[o + e + 1] - cy) * scale + cy;
        d[w + e + 2] = src[o + e + 2] * scale;
        d[w + e + 3] = src[o + e + 3];
      }
    }
  }

  update(dt: number, renderer: WebGLRenderer, live: SegmentBuffer, joints: { left: Float32Array; right: Float32Array }, present: { left: boolean; right: boolean }, clock: number, handY: number) {
    this.time += dt;
    const u = this.theater.wallMat.uniforms;
    // remember the shadow
    const slot = this.history[this.head];
    slot.set(live.data.subarray(0, FLOATS));
    this.times[this.head] = this.time;
    this.head = (this.head + 1) % HISTORY;
    this.filled = Math.min(HISTORY, this.filled + 1);

    // a fist changes the magic (with a big drum); other shapes pick the instrument
    let inst: Instrument | null = null;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'right' : 'left';
      const t = this.trackers[i].update(present[side] ? joints[side] : null, side, dt);
      if (t === 'stone' && this.lastTool[i] !== 'stone' && this.lastTool[i] !== null) {
        this.magic = (this.magic + 1) % MAGICS.length;
        this.sfx.note('bigdrum', 0);
        this.sfx.chime();
        this.inkPanel();
      }
      this.lastTool[i] = t;
      if (t && t !== 'stone' && !inst) inst = TOOL_SOUND[t];
    }
    this.music.play(clock, inst, handY);

    // the magic
    this.out.data.fill(0);
    const m = MAGICS[this.magic];
    if (m.id === 'twin') {
      // mirrored about a line a little to one side, so the twin stands beside you, facing you
      const a = this.ago(0.45);
      if (a) {
        const cx = centerX(a);
        const line = cx + (cx > 0 ? -0.24 : 0.24);
        this.place(a, 0, 2 * line, true, 1);
      }
    } else if (m.id === 'echo') {
      const a = this.ago(0.18);
      const b = this.ago(0.4);
      if (a) this.place(a, 0, 0, false, 1);
      if (b) this.place(b, SEGS_PER_HAND * 2, 0, false, 1);
    } else {
      const a = this.ago(0.3);
      if (a) this.place(a, 0, 0, false, 1.9, -0.55);
    }
    this.theater.target.render(renderer, this.out);
    u.uTargetMode.value = 1;
    u.uTargetAlpha.value = Math.min(1, this.time * 2) * (m.id === 'echo' ? 0.75 : 1);
    u.uTargetAura.value.setRGB(m.aura[0], m.aura[1], m.aura[2]);
    u.uMeter.value = 0;

    // sparks trail the index and middle fingertips when they move
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'right' : 'left';
      if (!present[side]) continue;
      const j = joints[side];
      for (let f = 0; f < 2; f++) {
        const jt = f === 0 ? 9 : 14;
        const p = projectPoint(j[jt * 3], j[jt * 3 + 1], j[jt * 3 + 2], this.pt);
        const tip = this.tips[i * 2 + f];
        if (p) {
          const v = Math.hypot(p[0] - tip[0], p[1] - tip[1]) / Math.max(dt, 1e-3);
          if (tip[2] && v > 0.25 && this.sparks.length < 28 && this.rnd() < Math.min(1, v * dt * 6)) {
            this.sparks.push({ x: p[0], y: p[1], vx: (this.rnd() - 0.5) * 0.1, vy: 0.05 + this.rnd() * 0.1, life: 0.7 + this.rnd() * 0.5 });
          }
          tip[0] = p[0];
          tip[1] = p[1];
          tip[2] = 1;
        }
      }
    }
    for (const s of this.sparks) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) if (this.sparks[i].life <= 0) this.sparks.splice(i, 1);
    const arr = u.uDots.value as Float32Array;
    for (const s of this.sparks) {
      if (n >= 32) break;
      arr[n * 4] = s.x;
      arr[n * 4 + 1] = s.y;
      arr[n * 4 + 2] = 0.011;
      arr[n * 4 + 3] = -Math.min(1, s.life * 1.4);
      n++;
    }
    u.uDotKind.value = 2;
    u.uDotCount.value = n;
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private inkPanel() {
    const m = MAGICS[this.magic];
    const cv = this.theater.ink;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 0.6;
    g.font = 'italic 26px Georgia, serif';
    g.fillText('Shadow Mirror  ·  no rules, just play', 512, 44);
    g.globalAlpha = 1;
    g.font = 'italic 700 60px Georgia, serif';
    g.fillText(m.name, 512, 108);
    g.font = '32px Georgia, serif';
    g.fillText(m.line, 512, 152);
    g.globalAlpha = 0.7;
    g.font = '24px Georgia, serif';
    g.fillText('Make a fist to change the magic.', 512, 640);
    g.fillText('Your hands make music: flat, cupped or spread, high or low.', 512, 672);
    g.globalAlpha = 1;
    this.theater.inkTex.needsUpdate = true;
  }
}

/** The middle of a shadow along x (wall meters), from its capsules' end points. */
function centerX(d: Float32Array): number {
  let sx = 0, n = 0;
  for (let i = 0; i < d.length / 8; i++) {
    const o = i * 8;
    if (d[o + 2] <= 0) continue;
    sx += d[o] + d[o + 4];
    n += 2;
  }
  return n ? sx / n : 0;
}
