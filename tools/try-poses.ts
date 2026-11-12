/** Draw hand-pose candidates (a JSON file of HandPose[][]) to one contact sheet, to design shapes. */
import { readFileSync } from 'node:fs';
import type { HandPose } from '../src/game/hand-model.js';
import { poseToJoints } from '../src/game/hand-model.js';
import { GRID_H, GRID_W, projectHand, rasterize, SegmentBuffer, SEGS_PER_HAND } from '../src/game/silhouette.js';
import { writeGray } from './png.js';

const [file, out] = process.argv.slice(2);
const sets: HandPose[][] = JSON.parse(readFileSync(file, 'utf8'));
const cols = 4, rows = Math.ceil(sets.length / cols);
const W = GRID_W * cols, H = GRID_H * rows;
const sheet = new Uint8Array(W * H).fill(255);
const buf = new SegmentBuffer();
const arm = new Uint8Array(GRID_W * GRID_H), hand = new Uint8Array(GRID_W * GRID_H);
sets.forEach((hs, i) => {
  buf.clear();
  hs.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND, { forearm: true, shoulderX: h.hand === 'right' ? 0.18 : -0.18 }));
  rasterize(buf, arm, false);
  rasterize(buf, hand, true);
  const ox = (i % cols) * GRID_W, oy = Math.floor(i / cols) * GRID_H;
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++)
    sheet[(oy + GRID_H - 1 - y) * W + ox + x] = hand[y * GRID_W + x] ? 0 : arm[y * GRID_W + x] ? 150 : x === 0 || y === 0 ? 200 : 245;
});
const S = 3, big = new Uint8Array(W * S * H * S);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) big[y * W * S + x] = sheet[Math.floor(y / S) * W + Math.floor(x / S)];
writeGray(out, W * S, H * S, big);
