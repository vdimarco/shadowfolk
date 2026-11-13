/**
 * Run the shadow-tool puzzles with the scripted poses from puzzle-moves.ts,
 * through the real projection, shape classifier and physics.
 * Run: npx tsx tools/plan-tools.ts [puzzle] (prints ASCII frames with ASCII=1)
 */
import { type HandPose, poseToJoints } from '../src/game/hand-model.js';
import { type HandInput, PUZZLES, ToolPuzzle } from '../src/game/puzzles.js';
import { GRID_H, GRID_W, projectHand, projectPoint, rasterize, SegmentBuffer, SEGS_PER_HAND } from '../src/game/silhouette.js';
import { type Tool, ToolTracker } from '../src/game/tools.js';
import { bowlPose, gardenPose, icePose, pearlsPose, rainPose } from './puzzle-moves.js';

const MOVES: Record<string, (t: number) => HandPose[]> = { rain: rainPose, bowl: bowlPose, pearls: pearlsPose, ice: icePose, garden: gardenPose };
const DT = 1 / 30;
const only = process.argv[2];
let fails = 0;
for (const info of PUZZLES) {
  if (!MOVES[info.id] || (only && only !== info.id)) continue;
  const p = new ToolPuzzle(info.id, false);
  const buf = new SegmentBuffer();
  const tr = [new ToolTracker(), new ToolTracker()];
  const hands: HandInput[] = [0, 1].map(() => ({ mask: new Uint8Array(GRID_W * GRID_H), tool: null, x: 0, y: 0, vx: 0, vy: 0, palmUp: 0 }));
  const seen = new Set<string>();
  let t = 0;
  for (; t < 90 && !p.solved; t += DT) {
    const poses = MOVES[info.id](t);
    buf.clear();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 'right' : 'left';
      const pose = poses.find((q) => q.hand === side);
      const h = hands[i];
      if (!pose) {
        h.tool = null;
        h.mask.fill(0);
        tr[i].update(null, side, DT);
        continue;
      }
      const j = poseToJoints(pose);
      projectHand(j, buf, i * SEGS_PER_HAND, { forearm: true, shoulderX: side === 'right' ? 0.18 : -0.18 });
      rasterize(buf, h.mask, false, i * SEGS_PER_HAND, SEGS_PER_HAND);
      let tool: Tool | null = tr[i].update(j, side, DT);
      if (info.tools !== 'any' && tool && !info.tools.includes(tool)) tool = null;
      h.tool = tool;
      h.palmUp = tr[i].f.palmUp;
      const pc = projectPoint((j[0] + j[33]) / 2, (j[1] + j[34]) / 2, (j[2] + j[35]) / 2, [0, 0]);
      if (pc) {
        h.vx = (pc[0] - h.x) / DT;
        h.vy = (pc[1] - h.y) / DT;
        h.x = pc[0];
        h.y = pc[1];
      }
      seen.add(`${side}:${tool ?? 'ghost'}`);
    }
    p.step(DT, hands);
    p.events.length = 0;
    if (process.env.ASCII && Math.abs(t - Number(process.env.ASCII)) < DT / 2) {
      const m = new Uint8Array(GRID_W * GRID_H);
      for (let i = 0; i < m.length; i++) m[i] = hands[0].mask[i] ? 1 : hands[1].mask[i] ? 2 : 0;
      for (const d of p.drops) if (d.alive) {
        const gx = Math.floor((d.x + 0.8) / 1.6 * GRID_W), gy = Math.floor((d.y + 0.55) / 1.1 * GRID_H);
        if (gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H) m[gy * GRID_W + gx] = d.pearl ? 4 : 3;
      }
      for (let gy = GRID_H - 1; gy >= 0; gy -= 2) { let row = ''; for (let gx = 0; gx < GRID_W; gx++) row += '.#=o@'[m[gy * GRID_W + gx]]; console.log(row); }
    }
  }
  const counts = p.targets.map((x) => `${x.style} ${x.count}/${x.goal}`).join(', ');
  if (!p.solved) fails++;
  console.log(`${p.solved ? 'ok  ' : 'FAIL'} ${info.id}: ${counts} in ${t.toFixed(1)} s; ice ${p.ice}; tools seen ${[...seen].join(' ')}`);
}
if (fails) process.exit(1);
