import type { HandPose } from './hand-model.js';

export type Motion = 'flutter' | 'hop' | 'snap' | 'bark' | 'glide' | 'fly' | 'drift';

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
}

const R = (p: Omit<HandPose, 'hand'>): HandPose => ({ hand: 'right', ...p });
const L = (p: Omit<HandPose, 'hand'>): HandPose => ({ hand: 'left', ...p });

export const LEVELS: Level[] = [
  {
    id: 'moth',
    name: 'The Moth',
    hint: 'Raise one open hand. Spread your fingers wide.',
    wake: 'The moth shakes off the dust and flutters to the lamp.',
    motion: 'flutter',
    threshold: 0.66,
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
    hands: [
      R({
        pos: [0.08, -0.26, -0.42],
        thumb: { out: 0.2, opp: 1, curl: 0.8 },
        index: { splay: 12 },
        middle: { splay: -10 },
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
    threshold: 0.7,
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
    hands: [
      R({
        pos: [0.0, -0.24, -0.42],
        rot: [0, 0, -90],
        thumb: { out: 1, opp: 0, curl: 0 },
        index: { splay: 0, mcp: 5 },
        middle: { splay: 0, mcp: 5 },
        ring: { splay: -3, mcp: 10 },
        pinky: { splay: -48, mcp: 8, pip: 10 },
      }),
    ],
  },
  {
    id: 'bird',
    name: 'The Bird',
    hint: 'Use both hands. Cross them at the wrists and hook your thumbs. Spread the wings.',
    wake: 'The bird beats its wings and flies into the night.',
    motion: 'fly',
    threshold: 0.62,
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
    hint: 'Both hands up, wrists together. Spread every finger for the antlers.',
    wake: 'The deer lifts its head, listens, and steps into the trees.',
    motion: 'drift',
    threshold: 0.62,
    hands: [
      R({
        pos: [0.035, -0.27, -0.42],
        rot: [0, 0, -28],
        thumb: { out: 0.6, opp: 0.2 },
        index: { splay: 16 },
        middle: { splay: 4 },
        ring: { splay: -8 },
        pinky: { splay: -20 },
      }),
      L({
        pos: [-0.035, -0.27, -0.42],
        rot: [0, 0, 28],
        thumb: { out: 0.6, opp: 0.2 },
        index: { splay: 16 },
        middle: { splay: 4 },
        ring: { splay: -8 },
        pinky: { splay: -20 },
      }),
    ],
  },
];
