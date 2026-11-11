/** Puzzle physics checks with drawn shadows. Run: npx tsx tools/test-puzzles.ts */
import { FireflyPuzzle, RainPuzzle } from '../src/game/puzzles.js';
import { GRID_H, GRID_W, WALL_H, WALL_W } from '../src/game/silhouette.js';

const mask = new Uint8Array(GRID_W * GRID_H);
const toGrid = (x: number, y: number) => [((x + WALL_W / 2) / WALL_W) * GRID_W, ((y + WALL_H / 2) / WALL_H) * GRID_H];
function bar(x0: number, y0: number, x1: number, y1: number, thick: number) {
  for (let gy = 0; gy < GRID_H; gy++)
    for (let gx = 0; gx < GRID_W; gx++) {
      const x = ((gx + 0.5) / GRID_W) * WALL_W - WALL_W / 2;
      const y = ((gy + 0.5) / GRID_H) * WALL_H - WALL_H / 2;
      const vx = x1 - x0, vy = y1 - y0;
      let t = ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy);
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t)) < thick) mask[gy * GRID_W + gx] = 1;
    }
}
void toGrid;
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};
const DT = 1 / 72;

// Rain: nothing in the way
{
  mask.fill(0);
  const p = new RainPuzzle(false);
  for (let t = 0; t < 40; t += DT) p.step(DT, mask);
  check(p.collected <= 1, `rain without a shadow: ${p.collected} drops in the cup`);
}
// Rain: a diagonal slide from under the cloud to above the cup
{
  mask.fill(0);
  bar(-0.48, 0.03, 0.22, -0.27, 0.03);
  const p = new RainPuzzle(false);
  let t = 0;
  for (; t < 60 && !p.solved; t += DT) p.step(DT, mask);
  check(p.solved, `rain with a slide: ${p.collected}/${p.goal} drops in ${t.toFixed(1)} s`);
}
// Fireflies: no shadow
{
  mask.fill(0);
  const p = new FireflyPuzzle(false);
  for (let t = 0; t < 30; t += DT) p.step(DT, mask);
  check(p.caught <= 1, `fireflies without a shadow: ${p.caught} caught`);
}
// Fireflies: a shadow wall sweeps right to left, then top to bottom on the left
{
  const p = new FireflyPuzzle(false);
  let t = 0;
  for (; t < 90 && !p.solved; t += DT) {
    mask.fill(0);
    const k = (t % 20) / 20;
    if (k < 0.55) {
      const x = 0.75 - (k / 0.55) * 1.0;
      bar(x, -0.5, x, 0.5, 0.05);
    } else {
      const y = 0.5 - ((k - 0.55) / 0.45) * 0.75;
      bar(-0.75, y, -0.15, y, 0.05);
    }
    p.step(DT, mask);
  }
  check(p.solved, `fireflies herded: ${p.caught}/${p.goal} in ${t.toFixed(1)} s`);
}
if (failures) process.exit(1);
