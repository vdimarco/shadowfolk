/** Simulate the scripted puzzle moves through the real shadow pipeline. */
import { poseToJoints } from '../src/game/hand-model.js';
import { FireflyPuzzle, RainPuzzle } from '../src/game/puzzles.js';
import { GRID_H, GRID_W, projectHand, rasterize, SegmentBuffer, SEGS_PER_HAND } from '../src/game/silhouette.js';
import { fliesPose, rainPose } from './puzzle-moves.js';

const DT = 1 / 30;
const buf = new SegmentBuffer();
const mask = new Uint8Array(GRID_W * GRID_H);
function shadow(poses: ReturnType<typeof rainPose>) {
  buf.clear();
  poses.forEach((h) => projectHand(poseToJoints(h), buf, h.hand === 'right' ? 0 : SEGS_PER_HAND, { forearm: true, shoulderX: h.hand === 'right' ? 0.18 : -0.18 }));
  rasterize(buf, mask, false);
}
const args = JSON.parse(process.argv[2] ?? '{}');
{
  const p = new RainPuzzle(false);
  let t = 0;
  for (; t < 40 && !p.solved; t += DT) {
    shadow(rainPose(t, args.rain));
    p.step(DT, mask);
  }
  console.log(`rain: ${p.collected}/${p.goal} after ${t.toFixed(1)} s`);
}
{
  const p = new FireflyPuzzle(false);
  let t = 0;
  for (; t < 60 && !p.solved; t += DT) {
    shadow(fliesPose(t, args.flies));
    p.step(DT, mask);
  }
  console.log(`fireflies: ${p.caught}/${p.goal} after ${t.toFixed(1)} s`);
}
