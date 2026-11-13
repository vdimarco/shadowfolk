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
export function rainPose(t: number, p = { x: -0.12, y: -0.22, z: -0.42, roll: 54 }): HandPose[] {
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

// ------------------------------------------------------------ shadow tools

/** Theater-space hand position whose shadow falls at wall point (wx, wy). */
export function handAt(wx: number, wy: number, z = -0.42): [number, number, number] {
  const t = (-1.3 - 0.2) / (z - 0.2);
  return [wx / t, (wy + 0.3) / t - 0.3, z];
}
const flat = { thumb: { out: 0.05, opp: 0 }, index: { splay: 2 }, middle: { splay: 0 }, ring: { splay: -2 }, pinky: { splay: -4 } };
const spread = { thumb: { out: 0.9, opp: 0 }, index: { splay: 16 }, middle: { splay: 0 }, ring: { splay: -14 }, pinky: { splay: -28 } };
const cup = { thumb: { out: 0.2 }, index: { curl: 0.5, splay: 2 }, middle: { curl: 0.5 }, ring: { curl: 0.5, splay: -2 }, pinky: { curl: 0.5, splay: -4 } };
const fist = { thumb: { curl: 0.6, opp: 0.6 }, index: { curl: 0.95 }, middle: { curl: 0.95 }, ring: { curl: 0.95 }, pinky: { curl: 0.95 } };

/**
 * The Bowl: a cupped hand, palm up, waits under the cloud, carries the rain
 * to the high cup on the right, turns over to pour, and comes back.
 */
export function bowlPose(t: number, p = { period: 12 }): HandPose[] {
  const c = t % p.period;
  const A = handAt(-0.3, -0.12), B = handAt(0.54, 0.2);
  let k = 0, roll = 70;
  if (c < 6) k = 0;
  else if (c < 8.5) k = ease((c - 6) / 2.5);
  else if (c < 10) {
    k = 1;
    roll = lerp(70, -60, (c - 8.5) / 0.6);
  } else {
    k = 1 - ease((c - 10) / 2);
    roll = lerp(-60, 70, (c - 10) / 0.5);
  }
  return [{ hand: 'right', pos: [lerp(A[0], B[0], k), lerp(A[1], B[1], k), A[2]], rot: [roll, 0, 90], ...cup }];
}

/** The Pearls: spread fingers held as a tilted sieve under the cloud, sloping down toward the shell. */
export function pearlsPose(t: number): HandPose[] {
  const k = ease(t / 1.5);
  return [{ hand: 'right', pos: [lerp(0.25, -0.06, k), lerp(-0.5, -0.25, k), -0.42], rot: [0, 0, lerp(0, 58, k)], ...spread }];
}

/** The Frozen Cloud: a fist knocks the ice three times, then the hand opens into a slide. */
export function icePose(t: number): HandPose[] {
  const ice = handAt(-0.38, -0.13);
  if (t < 3.6) {
    // knock: in for 0.6 s, out for 0.6 s
    const c = t % 1.2;
    const k = c < 0.6 ? ease(c / 0.3) : 1 - ease((c - 0.6) / 0.3);
    return [{ hand: 'left', pos: [ice[0], lerp(ice[1] - 0.12, ice[1], k), ice[2]], ...fist }];
  }
  return [{ hand: 'right', pos: [-0.12, -0.22, -0.42], rot: [0, 0, 54], ...flat }];
}

/** The Moon Garden: knock twice, then a sieve (right) over a slide (left) sorts pearls from rain. */
export function gardenPose(t: number): HandPose[] {
  const ice = handAt(-0.2, -0.13);
  if (t < 2.4) {
    const c = t % 1.2;
    const k = c < 0.6 ? ease(c / 0.3) : 1 - ease((c - 0.6) / 0.3);
    return [{ hand: 'left', pos: [ice[0], lerp(ice[1] - 0.12, ice[1], k), ice[2]], ...fist }];
  }
  return [
    { hand: 'right', pos: [-0.04, -0.25, -0.42], rot: [0, 0, 58], ...spread },
    { hand: 'left', pos: [0.0, -0.34, -0.45], rot: [0, 0, -62], ...flat },
  ];
}
