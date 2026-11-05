import type { FingerSpec, HandPose } from './hand-model.js';
import type { Level, Motion } from './levels.js';

/** Local calendar day number. Same for everyone on the same local date. */
export function dayNumber(d = new Date()): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((utc - Date.UTC(2026, 0, 1)) / 86400000);
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ['Lantern', 'Crooked', 'Velvet', 'Midnight', 'Paper', 'Ember', 'Hollow', 'Silver', 'Quiet', 'Moss', 'Willow', 'Ink'];
const NOUN = ['Heron', 'Fox', 'Beetle', 'Owl', 'Hound', 'Wren', 'Toad', 'Stag', 'Eel', 'Lynx', 'Bat', 'Snail', 'Crane', 'Mole'];
const MOTIONS: Motion[] = ['flutter', 'hop', 'snap', 'bark', 'glide', 'fly', 'drift'];

/** A new shape every day, built from real hand poses so it can always be made. */
export function dailyLevel(day: number): Level {
  const r = rng(day * 7919 + 17);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const finger = (): FingerSpec => {
    const c = pick([0, 0, 0, 0.5, 1]);
    return { curl: c, splay: (r() - 0.5) * 24 };
  };
  const roll = pick([-90, -45, 0, 0, 45, 90]) + (r() - 0.5) * 20;
  const base: Omit<HandPose, 'hand'> = {
    pos: [0.07, -0.24, -0.42],
    rot: [0, 0, roll],
    thumb: { out: r(), opp: r() * 0.8, curl: r() * 0.7 },
    index: finger(),
    middle: finger(),
    ring: finger(),
    pinky: finger(),
  };
  // At least one finger must stay straight, or the shape is only a blob.
  if (![base.index, base.middle, base.ring, base.pinky].some((f) => typeof f === 'object' && f.curl === 0)) {
    base.index = { curl: 0, splay: 8 };
  }
  const two = r() < 0.35;
  const hands: HandPose[] = two
    ? [
        { hand: 'right', ...base, pos: [0.04, -0.26, -0.42], rot: [0, 0, -Math.abs(roll) * 0.4 - 15] },
        { hand: 'left', ...base, pos: [-0.04, -0.26, -0.42], rot: [0, 0, Math.abs(roll) * 0.4 + 15] },
      ]
    : [{ hand: 'right', ...base }];
  const name = `The ${pick(ADJ)} ${pick(NOUN)}`;
  return {
    id: `daily-${day}`,
    name,
    hint: two ? "Today's shadow needs both hands. Follow the golden line." : "Today's shadow. Follow the golden line.",
    wake: `${name.replace('The ', 'The ')} wakes, and slips away until tomorrow.`,
    motion: pick(MOTIONS),
    threshold: two ? 0.6 : 0.64,
    hands,
  };
}
