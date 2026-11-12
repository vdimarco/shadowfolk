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
  /**
   * Turn (degrees, counterclockwise on the paper) for showing the outline and
   * the guide at a comfortable angle for a seated arm. Matching allows up to
   * MAX_TILT either way from the stored pose, so this must stay inside it.
   */
  show?: number;
  /** Where the creature's eye opens when it wakes: a joint of hands[hand], plus a wall offset in meters. */
  eye?: { hand?: number; joint: number; dx?: number; dy?: number };
}

const R = (p: Omit<HandPose, 'hand'>): HandPose => ({ hand: 'right', ...p });
const L = (p: Omit<HandPose, 'hand'>): HandPose => ({ hand: 'left', ...p });

export const LEVELS: Level[] = [
  {
    id: 'moth',
    name: 'The Starfish',
    hint: 'Raise one open hand, palm away from you. Spread your fingers.',
    wake: 'The starfish stretches its arms and drifts down to the sea floor.',
    motion: 'drift',
    threshold: 0.64,
    eye: { joint: 11, dx: 0.0, dy: -0.02 },
    hands: [R({ pos: [0.08, -0.24, -0.42], thumb: { out: 0.85, opp: 0 }, index: { splay: 10 }, middle: { splay: 2 }, ring: { splay: -6 }, pinky: { splay: -14 } })],
  },
  {
    id: 'hare',
    name: 'The Hare',
    hint: 'Make a peace sign: two fingers up for the ears.',
    wake: 'The hare twitches its ears and hops away.',
    motion: 'hop',
    threshold: 0.66,
    eye: { joint: 11, dx: 0.0, dy: -0.03 },
    hands: [R({ pos: [0.08, -0.26, -0.42], rot: [0, 0, -18], thumb: { out: 0.3, opp: 0.7, curl: 0.6 }, index: { splay: 9 }, middle: { splay: -7 }, ring: 1, pinky: 1 })],
  },
  {
    id: 'crocodile',
    name: 'The Crocodile',
    hint: 'Fingers together, pointing up and over. Your thumb underneath is the jaw.',
    wake: 'Snap! The crocodile slides off down the river.',
    motion: 'snap',
    threshold: 0.68,
    show: -45,
    eye: { joint: 6, dx: 0.045, dy: 0.055 },
    hands: [R({ pos: [0.12, -0.24, -0.42], rot: [0, 0, 90], thumb: { out: 0.4, opp: 0, curl: 0 }, index: { splay: 0 }, middle: { splay: 0 }, ring: { splay: 0 }, pinky: { splay: 0 } })],
  },
  {
    id: 'dog',
    name: 'The Dog',
    hint: 'Fingers together, thumb up for an ear. Drop your little finger to open the mouth.',
    wake: 'Woof! The dog wags and trots off to find a stick.',
    motion: 'bark',
    threshold: 0.64,
    show: 45,
    eye: { joint: 6, dx: -0.015, dy: 0.012 },
    hands: [R({ pos: [0.0, -0.24, -0.42], rot: [0, 0, -90], thumb: { out: 0.85, opp: 0, curl: 0 }, index: { splay: 2 }, middle: { splay: 0 }, ring: { splay: -3 }, pinky: { splay: -28, mcp: 10 } })],
  },
  {
    id: 'bird',
    name: 'The Bird',
    hint: 'Palms toward you, cross your wrists and hook your thumbs. Spread the wings.',
    wake: 'The bird beats its wings and flies into the night.',
    motion: 'fly',
    threshold: 0.64,
    eye: { hand: 0, joint: 3, dx: 0.0, dy: -0.01 },
    hands: [
      R({ pos: [-0.035, -0.26, -0.42], rot: [0, 180, -55], thumb: { out: 0.9, opp: 0, curl: 0 }, index: { splay: 6 }, middle: { splay: 0 }, ring: { splay: -6 }, pinky: { splay: -12 } }),
      L({ pos: [0.035, -0.26, -0.42], rot: [0, 180, 55], thumb: { out: 0.9, opp: 0, curl: 0 }, index: { splay: 6 }, middle: { splay: 0 }, ring: { splay: -6 }, pinky: { splay: -12 } }),
    ],
  },
  {
    id: 'deer',
    name: 'The Deer',
    hint: 'Both hands open, wrists together. Spread your fingers for the antlers.',
    wake: 'The deer lifts its head, listens, and steps into the trees.',
    motion: 'drift',
    threshold: 0.62,
    eye: { hand: 0, joint: 2, dx: -0.025, dy: 0.0 },
    hands: [
      R({ pos: [0.035, -0.27, -0.42], rot: [0, 0, -35], thumb: { out: 0.45, opp: 0.1 }, index: { splay: 14 }, middle: { splay: 3 }, ring: { splay: -7 }, pinky: { splay: -18 } }),
      L({ pos: [-0.035, -0.27, -0.42], rot: [0, 0, 35], thumb: { out: 0.45, opp: 0.1 }, index: { splay: 14 }, middle: { splay: 3 }, ring: { splay: -7 }, pinky: { splay: -18 } }),
    ],
  },
  // ---------------------------------------------------------- chapter two
  {
    id: 'fox',
    name: 'The Fox',
    hint: 'Touch your thumb to your middle and ring fingers. Point the other two up for ears.',
    wake: 'The fox flicks its ears and slips away through the grass.',
    motion: 'hop',
    threshold: 0.64,
    eye: { joint: 12, dx: 0.0, dy: 0.0 },
    hands: [R({ pos: [0.06, -0.24, -0.42], rot: [0, -45, -25], thumb: { out: 0.6, opp: 0.9, curl: 0.35 }, index: { splay: 10 }, middle: { curl: 0.65 }, ring: { curl: 0.65 }, pinky: { splay: -14 } })],
  },
  {
    id: 'butterfly',
    name: 'The Butterfly',
    hint: 'Both hands up, palms away. Hook your thumbs together, fingers close, and tilt the wings out.',
    wake: 'The butterfly opens its wings and floats up into the lamplight.',
    motion: 'flutter',
    threshold: 0.64,
    eye: { hand: 0, joint: 3, dx: 0.0, dy: 0.0 },
    hands: [
      R({ pos: [0.065, -0.23, -0.42], rot: [0, 0, -30], thumb: { out: 0.9, opp: 0, curl: 0 }, index: { splay: 0 }, middle: { splay: 0 }, ring: { splay: 0 }, pinky: { splay: 0 } }),
      L({ pos: [-0.065, -0.23, -0.42], rot: [0, 0, 30], thumb: { out: 0.9, opp: 0, curl: 0 }, index: { splay: 0 }, middle: { splay: 0 }, ring: { splay: 0 }, pinky: { splay: 0 } }),
    ],
  },
  {
    id: 'owl',
    name: 'The Owl',
    hint: 'Two fists up side by side, palms toward you. Thumbs straight up for the ear tufts.',
    wake: 'The owl blinks its round eyes and glides off without a sound.',
    motion: 'fly',
    threshold: 0.68,
    eye: { hand: 0, joint: 11, dx: 0.0, dy: -0.01 },
    hands: [
      R({ pos: [0.07, -0.27, -0.42], rot: [0, 180, 0], thumb: { out: 0.3, opp: 0, curl: 0 }, index: 1, middle: 1, ring: 1, pinky: 1 }),
      L({ pos: [-0.07, -0.27, -0.42], rot: [0, 180, 0], thumb: { out: 0.3, opp: 0, curl: 0 }, index: 1, middle: 1, ring: 1, pinky: 1 }),
    ],
  },
  {
    id: 'spider',
    name: 'The Spider',
    hint: 'Cross your wrists, palms away. Spread and curl your fingers like legs.',
    wake: 'The spider tiptoes up its thread and out of sight.',
    motion: 'scuttle',
    threshold: 0.64,
    eye: { hand: 0, joint: 3, dx: -0.02, dy: 0.0 },
    hands: [
      R({ pos: [-0.03, -0.26, -0.38], rot: [0, 0, -50], thumb: { out: 0.5, opp: 0, curl: 0.2 }, index: { curl: 0.35, splay: 16 }, middle: { curl: 0.35, splay: 4 }, ring: { curl: 0.35, splay: -8 }, pinky: { curl: 0.35, splay: -20 } }),
      L({ pos: [0.03, -0.26, -0.38], rot: [0, 0, 50], thumb: { out: 0.5, opp: 0, curl: 0.2 }, index: { curl: 0.35, splay: 16 }, middle: { curl: 0.35, splay: 4 }, ring: { curl: 0.35, splay: -8 }, pinky: { curl: 0.35, splay: -20 } }),
    ],
  },
];
