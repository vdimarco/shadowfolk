/** Render every level's target shadow to one contact-sheet PNG. */
import { poseToJoints } from '../src/game/hand-model.js';
import { LEVELS } from '../src/game/levels.js';
import { GRID_H, GRID_W, rasterize, SegmentBuffer, projectHand, SEGS_PER_HAND } from '../src/game/silhouette.js';
import { writeGray } from './png.js';

const out = process.argv[2] ?? 'levels.png';
const cols = 4;
const rows = Math.ceil(LEVELS.length / cols);
const W = GRID_W * cols, H = GRID_H * rows;
const sheet = new Uint8Array(W * H).fill(255);
const buf = new SegmentBuffer();
const withArm = new Uint8Array(GRID_W * GRID_H);
const handOnly = new Uint8Array(GRID_W * GRID_H);
LEVELS.forEach((lv, i) => {
  buf.clear();
  lv.hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND, { forearm: true, shoulderX: h.hand === 'right' ? 0.18 : -0.18 }));
  rasterize(buf, withArm, false);
  const area = rasterize(buf, handOnly, true);
  console.log(lv.id, 'area', area);
  const ox = (i % cols) * GRID_W, oy = Math.floor(i / cols) * GRID_H;
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const v = handOnly[y * GRID_W + x] ? 0 : withArm[y * GRID_W + x] ? 140 : (x === 0 || y === 0 ? 200 : 245);
      // flip Y: wall +y is up, image row 0 is top
      sheet[(oy + GRID_H - 1 - y) * W + ox + x] = v;
    }
});
// upscale x3
const S = 3;
const big = new Uint8Array(W * S * H * S);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) big[y * W * S + x] = sheet[Math.floor(y / S) * W + Math.floor(x / S)];
writeGray(out, W * S, H * S, big);
console.log('wrote', out);
