/**
 * Scripted hand moves that solve the shadow puzzles, shared by the video
 * capture and the Node planner (tools/plan-puzzles.ts).
 */
import type { HandPose } from '../src/game/hand-model.js';

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (10 - 15 * x + 6 * x * x);
};

/** Rain: a flat hand and forearm held as a long slide from under the cloud down toward the cup. */
export function rainPose(t: number, p = { x: -0.16, y: -0.22, z: -0.42, roll: 66 }): HandPose[] {
  // rise into place over the first 1.5 s, then hold with a slight sway
  const k = ease(t / 1.5);
  return [
    {
      hand: 'right',
      pos: [lerp(0.25, p.x, k), lerp(-0.5, p.y, k) + Math.sin(t * 1.3) * 0.004, p.z],
      rot: [0, 0, lerp(0, p.roll, k)],
      thumb: { out: 0.05, opp: 0 },
      index: { splay: 2 },
      middle: { splay: 0 },
      ring: { splay: -2 },
      pinky: { splay: -4 },
    },
  ];
}

/**
 * Fireflies: an open hand sweeps right to left across the paper as a wall,
 * then turns flat and presses down on the left, over and over.
 */
export function fliesPose(t: number, p = { period: 9, xr: 0.32, xl: -0.16, yTop: -0.06, yBot: -0.3, z: -0.42 }): HandPose[] {
  const c = (t % p.period) / p.period;
  let x: number, y: number, roll: number;
  if (c < 0.55) {
    // fingers up, a vertical wall moving left
    const k = ease(c / 0.55);
    x = lerp(p.xr, p.xl, k);
    y = -0.24;
    roll = 0;
  } else if (c < 0.7) {
    // turn flat above the jar side
    const k = ease((c - 0.55) / 0.15);
    x = p.xl;
    y = lerp(-0.24, p.yTop, k);
    roll = lerp(0, 90, k);
  } else if (c < 0.9) {
    // press down toward the jar
    const k = ease((c - 0.7) / 0.2);
    x = p.xl;
    y = lerp(p.yTop, p.yBot, k);
    roll = 90;
  } else {
    // swing back to the right side, low and out of the way
    const k = ease((c - 0.9) / 0.1);
    x = lerp(p.xl, p.xr, k);
    y = lerp(p.yBot, -0.5, Math.sin(k * Math.PI));
    roll = lerp(90, 0, k);
  }
  return [
    {
      hand: 'right',
      pos: [x, y, p.z],
      rot: [0, 0, roll],
      thumb: { out: 0.1, opp: 0 },
      index: { splay: 3 },
      middle: { splay: 0 },
      ring: { splay: -3 },
      pinky: { splay: -6 },
    },
  ];
}
