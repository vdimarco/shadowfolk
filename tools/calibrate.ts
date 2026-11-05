/** Score each level against itself, perturbed copies, mirrored copies, and other levels. */
import { poseToJoints, type HandPose } from '../src/game/hand-model.js';
import { LEVELS } from '../src/game/levels.js';
import { GRID_H, GRID_W, Matcher, rasterize, SegmentBuffer, projectHand, SEGS_PER_HAND } from '../src/game/silhouette.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const buf = new SegmentBuffer();
const mask = new Uint8Array(GRID_W * GRID_H);
function maskOf(hands: HandPose[]) {
  buf.clear();
  hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
  rasterize(buf, mask);
  return mask;
}
function jitterFinger(f: any, amt: number) {
  if (f === undefined) f = 0;
  if (typeof f === 'number') return Math.min(1, Math.max(0, f + rnd() * amt));
  const o = { ...f };
  for (const k of ['mcp', 'pip', 'dip', 'splay']) if (o[k] !== undefined) o[k] += rnd() * amt * 40;
  if (o.curl !== undefined) o.curl = Math.min(1, Math.max(0, o.curl + rnd() * amt));
  return o;
}
let common = [0, 0, 0];
function jitter(h: HandPose, amt: number, mirror = false): HandPose {
  const rot = h.rot ?? [0, 0, 0];
  const j: HandPose = {
    ...h,
    pos: [h.pos[0] + common[0] + rnd() * 0.04 * amt, h.pos[1] + common[1] + rnd() * 0.04 * amt, h.pos[2] + common[2] + rnd() * 0.04 * amt],
    rot: [rot[0] + rnd() * 25 * amt, rot[1] + rnd() * 25 * amt, rot[2] + rnd() * 25 * amt],
    thumb: { ...h.thumb, out: (h.thumb?.out ?? 0.5) + rnd() * amt, curl: Math.max(0, (h.thumb?.curl ?? 0) + rnd() * amt) },
    index: jitterFinger(h.index, amt), middle: jitterFinger(h.middle, amt), ring: jitterFinger(h.ring, amt), pinky: jitterFinger(h.pinky, amt),
  };
  if (mirror) {
    j.hand = h.hand === 'right' ? 'left' : 'right';
    j.pos = [-j.pos[0], j.pos[1], j.pos[2]];
    j.rot = [j.rot![0], -j.rot![1], -j.rot![2]];
  }
  return j;
}
const m = new Matcher();
const rows: string[] = [];
for (const lv of LEVELS) {
  m.setTarget(maskOf(lv.hands));
  const self = m.score(maskOf(lv.hands), true);
  const small: number[] = [], big: number[] = [], mir: number[] = [];
  for (let i = 0; i < 40; i++) {
    common = [rnd() * 0.06 + 0.04, rnd() * 0.06, rnd() * 0.08];
    small.push(m.score(maskOf(lv.hands.map((h) => jitter(h, 0.25))), true));
    big.push(m.score(maskOf(lv.hands.map((h) => jitter(h, 0.7))), true));
    mir.push(m.score(maskOf(lv.hands.map((h) => jitter(h, 0.25, true))), true));
  }
  const others = LEVELS.filter((o) => o !== lv).map((o) => `${o.id}:${m.score(maskOf(o.hands), true).toFixed(2)}`);
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1].toFixed(2);
  const pct = (a: number[], t: number) => ((100 * a.filter((x) => x >= t).length) / a.length).toFixed(0) + '%';
  rows.push(`${lv.id.padEnd(10)} thr ${lv.threshold} self ${self.toFixed(2)} | small med ${med(small)} pass ${pct(small, lv.threshold)} gentle ${pct(small, lv.threshold - 0.1)} | mirror med ${med(mir)} pass ${pct(mir, lv.threshold)} | big med ${med(big)} pass ${pct(big, lv.threshold)} | others ${others.join(' ')}`);
}
console.log(rows.join('\n'));
