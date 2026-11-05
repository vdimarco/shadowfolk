import { poseToJoints } from '../src/game/hand-model.js';
import { dailyLevel } from '../src/game/daily.js';
import { GRID_H, GRID_W, rasterize, SegmentBuffer, projectHand, SEGS_PER_HAND } from '../src/game/silhouette.js';
import { writeGray } from './png.js';
const out = process.argv[2]; const start = Number(process.argv[3] ?? 308);
const cols = 4, rows = 3, W = GRID_W * cols, H = GRID_H * rows;
const sheet = new Uint8Array(W * H).fill(255);
const buf = new SegmentBuffer(); const m = new Uint8Array(GRID_W * GRID_H);
for (let i = 0; i < cols * rows; i++) {
  const lv = dailyLevel(start + i);
  buf.clear();
  lv.hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
  const area = rasterize(buf, m);
  console.log(start + i, lv.name, lv.hands.length, 'area', area, JSON.stringify(lv.hands[0].rot));
  const ox = (i % cols) * GRID_W, oy = Math.floor(i / cols) * GRID_H;
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++)
    sheet[(oy + GRID_H - 1 - y) * W + ox + x] = m[y * GRID_W + x] ? 0 : (x === 0 || y === 0 ? 180 : 245);
}
const S = 2, big = new Uint8Array(W * S * H * S);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) big[y * W * S + x] = sheet[Math.floor(y / S) * W + Math.floor(x / S)];
writeGray(out, W * S, H * S, big);
