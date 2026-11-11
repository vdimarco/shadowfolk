import type { HandPose } from './hand-model.js';

export type Motion = 'flutter' | 'hop' | 'snap' | 'bark' | 'glide' | 'fly' | 'drift' | 'scuttle' | 'sway';

export interface Level {
  id: string;
  name: string;
  /** One short line shown before the shape. */
  hint: string;
  /** One short line shown when the shadow wakes up. */
  wake: string;
  motion: Motion;
  hands: HandPose[];
  /** Score needed in normal mode. Gentle mode subtracts 0.1. */
  threshold: number;
  /** Where the creature's eye opens when it wakes: a joint of hands[hand], plus a wall offset in meters. */
  eye?: { hand?: number; joint: number; dx?: number; dy?: number };
}

const R = (p: Omit<HandPose, 'hand'>): HandPose => ({ hand: 'right', ...p });
const L = (p: Omit<HandPose, 'hand'>): HandPose => ({ hand: 'left', ...p });

export const LEVELS: Level[] = [
  {
    id: 'moth',
    name: 'The Starfish',
    hint: 'Raise one open hand. Spread your fingers wide.',
    wake: 'The starfish stretches its arms and drifts down to the sea floor.',
    motion: 'drift',
    threshold: 0.66,
    eye: { joint: 11, dx: 0.0, dy: -0.02 },
    hands: [
      R({
        pos: [0.08, -0.24, -0.42],
        thumb: { out: 1, opp: 0 },
        index: { splay: 14 },
        middle: { splay: 2 },
        ring: { splay: -10 },
        pinky: { splay: -22 },
      }),
    ],
  },
  {
    id: 'hare',
    name: 'The Hare',
    hint: 'Two fingers up for ears. Fold the rest into a fist.',
    wake: 'The hare twitches its ears and hops away.',
    motion: 'hop',
    threshold: 0.7,
    eye: { joint: 11, dx: 0.0, dy: -0.03 },
    hands: [
      R({
        pos: [0.08, -0.26, -0.42],
        rot: [0, 0, -18],
        thumb: { out: 0.3, opp: 0.7, curl: 0.6 },
        index: { splay: 9 },
        middle: { splay: -7 },
        ring: 1,
        pinky: 1,
      }),
    ],
  },
  {
    id: 'crocodile',
    name: 'The Crocodile',
    hint: 'Turn your hand on its side. Fingers together, thumb below. Open the jaw.',
    wake: 'Snap! The crocodile slides off down the river.',
    motion: 'snap',
    threshold: 0.73,
    eye: { joint: 6, dx: 0.045, dy: 0.055 },
    hands: [
      R({
        pos: [0.12, -0.24, -0.42],
        rot: [0, 0, 90],
        thumb: { out: 0.45, opp: 0, curl: 0 },
        index: { splay: 0 },
        middle: { splay: 0 },
        ring: { splay: 0 },
        pinky: { splay: 0 },
      }),
    ],
  },
  {
    id: 'dog',
    name: 'The Dog',
    hint: 'Hand on its side, thumb up for an ear. Drop your little finger for the jaw.',
    wake: 'Woof! The dog wags and trots off to find a stick.',
    motion: 'bark',
    threshold: 0.7,
    eye: { joint: 6, dx: -0.015, dy: 0.012 },
    hands: [
      R({
        pos: [0.0, -0.24, -0.42],
        rot: [0, 0, -90],
        thumb: { out: 1, opp: 0, curl: 0 },
        index: { splay: 0, mcp: 5 },
        middle: { splay: 0, mcp: 5 },
        ring: { splay: -6, mcp: 10 },
        pinky: { splay: -58, mcp: 8, pip: 10 },
      }),
    ],
  },
  {
    id: 'bird',
    name: 'The Bird',
    hint: 'Use both hands. Cross them at the wrists and hook your thumbs. Spread the wings.',
    wake: 'The bird beats its wings and flies into the night.',
    motion: 'fly',
    threshold: 0.67,
    eye: { hand: 0, joint: 3, dx: 0.0, dy: -0.01 },
    hands: [
      R({
        pos: [-0.035, -0.26, -0.42],
        rot: [0, 180, -40],
        thumb: { out: 0.9, opp: 0, curl: 0 },
        index: { splay: 6 },
        middle: { splay: 0 },
        ring: { splay: -6 },
        pinky: { splay: -12 },
      }),
      L({
        pos: [0.035, -0.26, -0.42],
        rot: [0, 180, 40],
        thumb: { out: 0.9, opp: 0, curl: 0 },
        index: { splay: 6 },
        middle: { splay: 0 },
        ring: { splay: -6 },
        pinky: { splay: -12 },
      }),
    ],
  },
  {
    id: 'deer',
    name: 'The Deer',
    hint: 'Both hands up, wrists together, thumbs tucked in. Spread every finger wide for the antlers.',
    wake: 'The deer lifts its head, listens, and steps into the trees.',
    motion: 'drift',
    threshold: 0.62,
    eye: { hand: 0, joint: 2, dx: -0.025, dy: 0.0 },
    hands: [
      R({
        pos: [0.035, -0.27, -0.42],
        rot: [0, 0, -40],
        thumb: { out: 0.2, opp: 0.8, curl: 0.8 },
        index: { splay: 22 },
        middle: { splay: 6 },
        ring: { splay: -10 },
        pinky: { splay: -28 },
      }),
      L({
        pos: [-0.035, -0.27, -0.42],
        rot: [0, 0, 40],
        thumb: { out: 0.2, opp: 0.8, curl: 0.8 },
        index: { splay: 22 },
        middle: { splay: 6 },
        ring: { splay: -10 },
        pinky: { splay: -28 },
      }),
    ],
  },
  // ---------------------------------------------------------- chapter two
  {
    id: 'turkey',
    name: 'The Turkey',
    hint: 'Spread one hand wide behind for the tail. In front, make a fist with the thumb up for the head.',
    wake: 'Gobble! The turkey fluffs its tail and struts away.',
    motion: 'bark',
    threshold: 0.68,
    eye: { hand: 0, joint: 3, dx: -0.012, dy: 0.0 },
    hands: [
      R({
        pos: [0.075, -0.3, -0.38],
        rot: [0, 0, -10],
        thumb: { out: 0.35, opp: 0, curl: 0 },
        index: 1,
        middle: 1,
        ring: 1,
        pinky: 1,
      }),
      L({
        pos: [-0.02, -0.24, -0.45],
        rot: [0, 0, 20],
        thumb: { out: 1, opp: 0 },
        index: { splay: 16 },
        middle: { splay: 4 },
        ring: { splay: -8 },
        pinky: { splay: -22 },
      }),
    ],
  },
  {
    id: 'bat',
    name: 'The Bat',
    hint: 'Make the bird again, then turn it upside down. Keep the fingers close for the wings.',
    wake: 'The bat drops from its perch and flits into the dark.',
    motion: 'flutter',
    threshold: 0.67,
    eye: { hand: 0, joint: 3, dx: 0.0, dy: 0.01 },
    hands: [
      R({
        pos: [0.035, -0.16, -0.42],
        rot: [0, 180, 140],
        thumb: { out: 0.9, opp: 0, curl: 0 },
        index: { splay: 3, curl: 0.12 },
        middle: { splay: 0, curl: 0.12 },
        ring: { splay: -3, curl: 0.12 },
        pinky: { splay: -6, curl: 0.12 },
      }),
      L({
        pos: [-0.035, -0.16, -0.42],
        rot: [0, 180, -140],
        thumb: { out: 0.9, opp: 0, curl: 0 },
        index: { splay: 3, curl: 0.12 },
        middle: { splay: 0, curl: 0.12 },
        ring: { splay: -3, curl: 0.12 },
        pinky: { splay: -6, curl: 0.12 },
      }),
    ],
  },
  {
    id: 'owl',
    name: 'The Owl',
    hint: 'Two fists side by side. Thumbs straight up for the ear tufts.',
    wake: 'The owl blinks twice and flies off without a sound.',
    motion: 'fly',
    threshold: 0.72,
    eye: { hand: 0, joint: 11, dx: 0.0, dy: -0.01 },
    hands: [
      R({
        pos: [0.05, -0.27, -0.42],
        rot: [0, 180, -8],
        thumb: { out: 0.1, opp: 0, curl: 0 },
        index: 1,
        middle: 1,
        ring: 1,
        pinky: 1,
      }),
      L({
        pos: [-0.05, -0.27, -0.42],
        rot: [0, 180, 8],
        thumb: { out: 0.1, opp: 0, curl: 0 },
        index: 1,
        middle: 1,
        ring: 1,
        pinky: 1,
      }),
    ],
  },
  {
    id: 'spider',
    name: 'The Spider',
    hint: 'Both hands, palms together, fingers out to the sides. Curl them a little for the legs.',
    wake: 'The spider tiptoes up its thread and out of sight.',
    motion: 'scuttle',
    threshold: 0.66,
    eye: { hand: 0, joint: 3, dx: -0.02, dy: 0.0 },
    hands: [
      R({
        pos: [0.02, -0.26, -0.42],
        rot: [0, 0, -80],
        thumb: { out: 0.5, opp: 0, curl: 0.2 },
        index: { curl: 0.45, splay: 18 },
        middle: { curl: 0.45, splay: 4 },
        ring: { curl: 0.45, splay: -10 },
        pinky: { curl: 0.45, splay: -24 },
      }),
      L({
        pos: [-0.02, -0.26, -0.42],
        rot: [0, 0, 80],
        thumb: { out: 0.5, opp: 0, curl: 0.2 },
        index: { curl: 0.45, splay: 18 },
        middle: { curl: 0.45, splay: 4 },
        ring: { curl: 0.45, splay: -10 },
        pinky: { curl: 0.45, splay: -24 },
      }),
    ],
  },
];
