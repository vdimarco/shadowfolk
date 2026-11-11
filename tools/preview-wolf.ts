/** Render the Ink Wolf: calm, gathering to strike, and lunging, to a PNG. */
import { drawWolf } from '../src/game/battle.js';
import { GRID_H, GRID_W, rasterize, SegmentBuffer } from '../src/game/silhouette.js';
import { writeGray } from './png.js';

const out = process.argv[2] ?? 'wolf.png';
const buf = new SegmentBuffer();
const m = new Uint8Array(GRID_W * GRID_H);
const looks = [
  { open: 0, walk: 0, lunge: 0, crouch: 0 },
  { open: 1, walk: 1.5, lunge: 0, crouch: 1 },
  { open: 1, walk: 0, lunge: 1, crouch: 0 },
];
const W = GRID_W * looks.length, H = GRID_H;
const sheet = new Uint8Array(W * H).fill(245);
const eye: [number, number] = [0, 0];
looks.forEach((look, i) => {
  buf.clear();
  drawWolf(buf.data, 0, 0.1, 0.0, look, eye);
  rasterize(buf, m, false);
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const v = m[y * GRID_W + x] ? 0 : x === 0 ? 180 : 245;
    sheet[(GRID_H - 1 - y) * W + i * GRID_W + x] = v;
  }
  // mark the eye
  const ex = Math.floor((eye[0] + 0.8) / (1.6 / GRID_W)), ey = Math.floor((eye[1] + 0.55) / (1.1 / GRID_H));
  sheet[(GRID_H - 1 - ey) * W + i * GRID_W + ex] = 200;
});
const S = 4;
const big = new Uint8Array(W * S * H * S);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) big[y * W * S + x] = sheet[Math.floor(y / S) * W + Math.floor(x / S)];
writeGray(out, W * S, H * S, big);
