/** How many hand placements solve the rain puzzle? Run: npx tsx tools/rain-robustness.ts [cloudX cupX cupW] */
import { poseToJoints } from '../src/game/hand-model.js';
import { RainPuzzle } from '../src/game/puzzles.js';
import { GRID_H, GRID_W, projectHand, rasterize, SegmentBuffer } from '../src/game/silhouette.js';
import { rainPose } from './puzzle-moves.js';

const DT = 1 / 30;
const [cloudX, cupX, cupW] = process.argv.slice(2).map(Number);
const layout = process.argv.length > 2 ? { cloudX, cupX, cupW } : {};
const buf = new SegmentBuffer();
const mask = new Uint8Array(GRID_W * GRID_H);
let ok = 0, total = 0;
const wins: string[] = [];
for (const x of [-0.2, -0.16, -0.12, -0.08, -0.04, 0])
  for (const y of [-0.27, -0.22, -0.17, -0.12, -0.07])
    for (const roll of [45, 55, 65, 75, 85])
      for (const z of [-0.36, -0.42, -0.48]) {
        total++;
        const p = new RainPuzzle(false, 7, layout);
        let t = 0;
        for (; t < 30 && !p.solved; t += DT) {
          buf.clear();
          for (const h of rainPose(t, { x, y, z, roll })) projectHand(poseToJoints(h), buf, 0, { forearm: true, shoulderX: 0.18 });
          rasterize(buf, mask, false);
          p.step(DT, mask);
        }
        if (p.solved) {
          ok++;
          wins.push(`${x},${y},${roll},${z}`);
        }
      }
console.log(`rain solved by ${ok} of ${total} hand placements (${((100 * ok) / total).toFixed(0)}%)`);
