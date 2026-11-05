/** Fast checks on the shape matcher. Run: npm test */
import { poseToJoints, type HandPose } from '../src/game/hand-model.js';
import { LEVELS } from '../src/game/levels.js';
import { dailyLevel } from '../src/game/daily.js';
import { GRID_H, GRID_W, Matcher, rasterize, SegmentBuffer, projectHand, SEGS_PER_HAND } from '../src/game/silhouette.js';

const buf = new SegmentBuffer();
const mask = new Uint8Array(GRID_W * GRID_H);
const maskOf = (hands: HandPose[]) => {
  buf.clear();
  hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
  return rasterize(buf, mask), mask;
};
const shift = (hands: HandPose[], dx: number, dy: number, dz: number) =>
  hands.map((h) => ({ ...h, pos: [h.pos[0] + dx, h.pos[1] + dy, h.pos[2] + dz] as [number, number, number] }));
const mirror = (hands: HandPose[]) =>
  hands.map((h) => ({ ...h, hand: h.hand === 'right' ? 'left' : 'right', pos: [-h.pos[0], h.pos[1], h.pos[2]], rot: [h.rot?.[0] ?? 0, -(h.rot?.[1] ?? 0), -(h.rot?.[2] ?? 0)] }) as HandPose);

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};
const m = new Matcher();
for (const lv of LEVELS) {
  m.setTarget(maskOf(lv.hands));
  check(m.score(maskOf(lv.hands), false) > 0.99, `${lv.id}: matches itself`);
  const moved = m.score(maskOf(shift(lv.hands, 0.06, 0.04, 0.05)), false);
  check(moved >= lv.threshold, `${lv.id}: still matches when moved and resized (${moved.toFixed(2)})`);
  const mir = m.score(maskOf(mirror(lv.hands)), true);
  check(mir >= lv.threshold, `${lv.id}: mirrored hands match (${mir.toFixed(2)})`);
  for (const o of LEVELS) {
    if (o === lv) continue;
    const s = m.score(maskOf(o.hands), true);
    check(s < lv.threshold, `${lv.id}: rejects ${o.id} (${s.toFixed(2)})`);
  }
}
for (let d = 300; d < 400; d++) {
  const lv = dailyLevel(d);
  m.setTarget(maskOf(lv.hands));
  const area = rasterize(buf, mask);
  if (area < 150 || m.score(maskOf(lv.hands), false) < 0.99) check(false, `daily ${d} is valid`);
}
check(true, 'daily shapes 300-399 are valid');
if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
