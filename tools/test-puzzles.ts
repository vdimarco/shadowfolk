/** Puzzle physics checks with drawn shadows. Run: npx tsx tools/test-puzzles.ts */
import { poseToJoints, type HandPose } from '../src/game/hand-model.js';
import { FireflyPuzzle, type HandInput, RainPuzzle, ToolPuzzle } from '../src/game/puzzles.js';
import { classify, handFeatures, type HandFeatures } from '../src/game/tools.js';
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

// ------------------------------------------------------------ shadow tools
// the shape of each hand picks its tool
{
  const f: HandFeatures = { ext: 0, spread: 0, palmUp: 0 };
  const all = (c: number, sp?: number[]) => ({ index: { curl: c, splay: sp?.[0] }, middle: { curl: c, splay: sp?.[1] }, ring: { curl: c, splay: sp?.[2] }, pinky: { curl: c, splay: sp?.[3] } });
  const cases: [string, Partial<HandPose>, string][] = [
    ['flat hand', all(0, [2, 0, -2, -4]), 'slide'],
    ['relaxed open hand', {}, 'slide'],
    ['spread fingers', { ...all(0, [16, 0, -14, -28]), thumb: { out: 0.9 } }, 'sieve'],
    ['cupped hand', all(0.5, [2, 0, -2, -4]), 'bowl'],
    ['fist', { ...all(0.95), thumb: { curl: 0.6, opp: 0.6 } }, 'stone'],
  ];
  for (const side of ['right', 'left'] as const)
    for (const [name, p, want] of cases) {
      const j = poseToJoints({ hand: side, pos: [0.1, -0.2, -0.42], ...p } as HandPose);
      const got = classify(handFeatures(j, side, f), null);
      check(got === want, `${side} ${name}: ${got}`);
    }
  for (const side of ['right', 'left'] as const) {
    // base pose: palm toward the wall; pitched 90 degrees the palm faces up, -90 down
    const up = handFeatures(poseToJoints({ hand: side, pos: [0, -0.2, -0.42], rot: [90, 0, 0] }), side, f).palmUp;
    const down = handFeatures(poseToJoints({ hand: side, pos: [0, -0.2, -0.42], rot: [-90, 0, 0] }), side, f).palmUp;
    check(up > 0.7 && down < -0.7, `${side} palm up ${up.toFixed(2)}, palm down ${down.toFixed(2)}`);
  }
}

const hand = (): HandInput => ({ mask: new Uint8Array(GRID_W * GRID_H), tool: null, x: 0, y: 0, vx: 0, vy: 0, palmUp: 1 });
/** Draw into one hand's mask (cleared first). */
function draw(h: HandInput, fn: () => void) {
  mask.fill(0);
  fn();
  h.mask.set(mask);
}
/** A bowl: a U of shadow with its bottom at (x, y). */
function bowl(x: number, y: number) {
  bar(x - 0.08, y + 0.06, x - 0.05, y, 0.015);
  bar(x - 0.05, y, x + 0.05, y, 0.015);
  bar(x + 0.05, y, x + 0.08, y + 0.06, 0.015);
}

// The Bowl: a slide is a ghost here, so nothing reaches the high cup
{
  const p = new ToolPuzzle('bowl', false);
  const R = hand(), L = hand();
  draw(R, () => bar(-0.5, -0.1, 0.4, 0.08, 0.03));
  R.tool = null; // a flat hand: not allowed, a ghost
  for (let t = 0; t < 30; t += DT) p.step(DT, [R, L]);
  check(p.collected === 0, `bowl puzzle with a ghost slide: ${p.collected} in the cup`);
}
// The Bowl: catch under the cloud, carry to the cup, turn over, repeat
{
  const p = new ToolPuzzle('bowl', false);
  const R = hand(), L = hand();
  R.tool = 'bowl';
  let t = 0;
  let trips = 0;
  const a = { x: -0.42, y: -0.15 }, b = { x: 0.42, y: 0.2 };
  while (t < 120 && !p.solved) {
    // fill (6 s), carry (2 s), pour (1.5 s), return (2 s)
    const k = t % 11.5;
    let x = a.x, y = a.y, up = 1;
    if (k >= 6 && k < 8) {
      const s2 = (k - 6) / 2;
      x = a.x + (b.x - a.x) * s2;
      y = a.y + (b.y - a.y) * s2;
    } else if (k >= 8 && k < 9.5) {
      x = b.x;
      y = b.y;
      up = -1;
    } else if (k >= 9.5) {
      const s2 = (k - 9.5) / 2;
      x = b.x + (a.x - b.x) * s2;
      y = b.y + (a.y - b.y) * s2;
      up = k < 9.6 ? -1 : 1;
      if (k - DT < 9.5) trips++;
    }
    R.vx = (x - R.x) / DT;
    R.vy = (y - R.y) / DT;
    R.x = x;
    R.y = y;
    R.palmUp = up;
    draw(R, () => bowl(x, y));
    p.step(DT, [R, L]);
    p.events.length = 0;
    t += DT;
  }
  check(p.solved, `bowl carried: ${p.collected}/${p.goal} in ${t.toFixed(1)} s (${trips} trips)`);
}
// The Pearls: no hands, pearls fall in the cup and spill it
{
  const p = new ToolPuzzle('pearls', false);
  const R = hand(), L = hand();
  for (let t = 0; t < 40; t += DT) p.step(DT, [R, L]);
  check(!p.solved && p.targets[1].count === 0, `pearls with no hands: cup ${p.targets[0].count}, shell ${p.targets[1].count}`);
}
// The Pearls: a sieve tilted down toward the shell
{
  const p = new ToolPuzzle('pearls', false);
  const R = hand(), L = hand();
  R.tool = 'sieve';
  draw(R, () => bar(-0.34, -0.05, 0.5, -0.3, 0.025));
  let t = 0;
  for (; t < 90 && !p.solved; t += DT) p.step(DT, [R, L]);
  check(p.solved, `pearls sorted by a sieve: cup ${p.targets[0].count}/${p.targets[0].goal}, shell ${p.targets[1].count}/${p.targets[1].goal} in ${t.toFixed(1)} s`);
}
// The Frozen Cloud: a slide does nothing until a fist knocks the ice three times
{
  const p = new ToolPuzzle('ice', false);
  const R = hand(), L = hand();
  R.tool = 'slide';
  draw(R, () => bar(-0.46, -0.02, 0.24, -0.27, 0.03));
  for (let t = 0; t < 10; t += DT) p.step(DT, [R, L]);
  check(p.collected === 0 && p.ice === 3, `frozen cloud with a slide only: ${p.collected} drops, ice ${p.ice}`);
  // the left fist knocks: in and out of the ice three times
  L.tool = 'stone';
  for (let k = 0; k < 3; k++) {
    draw(L, () => bar(-0.39, 0.12, -0.37, 0.12, 0.03));
    for (let t = 0; t < 0.4; t += DT) p.step(DT, [R, L]);
    draw(L, () => bar(-0.39, 0.4, -0.37, 0.4, 0.03));
    for (let t = 0; t < 0.4; t += DT) p.step(DT, [R, L]);
  }
  check(p.ice === 0, `three knocks free the cloud: ice ${p.ice}, events ${p.events.join(',')}`);
  L.mask.fill(0);
  let t = 0;
  for (; t < 60 && !p.solved; t += DT) p.step(DT, [R, L]);
  check(p.solved, `then the slide fills the cup: ${p.collected}/${p.goal} in ${t.toFixed(1)} s`);
}
// The Moon Garden: knock the ice, then a sieve over a slide sorts pearls from rain
{
  const p = new ToolPuzzle('garden', false);
  const R = hand(), L = hand();
  L.tool = 'stone';
  for (let k = 0; k < 2; k++) {
    draw(L, () => bar(-0.16, 0.12, -0.14, 0.12, 0.03));
    for (let t = 0; t < 0.4; t += DT) p.step(DT, [R, L]);
    L.mask.fill(0);
    for (let t = 0; t < 0.4; t += DT) p.step(DT, [R, L]);
  }
  R.tool = 'sieve';
  draw(R, () => bar(-0.25, -0.02, 0.3, -0.16, 0.025));
  L.tool = 'slide';
  draw(L, () => bar(0.0, -0.12, -0.5, -0.3, 0.03));
  let t = 0;
  for (; t < 120 && !p.solved; t += DT) p.step(DT, [R, L]);
  check(p.solved, `garden: pot ${p.targets[0].count}/${p.targets[0].goal}, lantern ${p.targets[1].count}/${p.targets[1].goal} in ${t.toFixed(1)} s`);
}
if (failures) process.exit(1);
