/**
 * Chapter four: the Ink Wolf. A spell battle on the paper.
 * Every creature you know is a spell: make its shape and it flies at the wolf.
 * Pure game rules in wall meters (origin at the wall center), so Node tests
 * can play whole battles. No Three.js, no DOM.
 */

export type SpellKind = 'swoop' | 'charge' | 'ward' | 'web' | 'heal';

export interface Spell {
  kind: SpellKind;
  name: string;
  damage: number;
}

/** What each story creature does as a spell. Unknown ids (daily shadows) swoop. */
export const SPELLS: Record<string, Spell> = {
  moth: { kind: 'ward', name: 'Starfish Ward', damage: 0 },
  hare: { kind: 'swoop', name: 'Hare Leap', damage: 1 },
  crocodile: { kind: 'charge', name: 'Crocodile Snap', damage: 2 },
  dog: { kind: 'charge', name: 'Dog Bite', damage: 2 },
  bird: { kind: 'swoop', name: 'Bird Swoop', damage: 1 },
  deer: { kind: 'heal', name: 'Deer Blessing', damage: 0 },
  turkey: { kind: 'swoop', name: 'Turkey Rush', damage: 1 },
  bat: { kind: 'swoop', name: 'Bat Dive', damage: 1 },
  owl: { kind: 'swoop', name: 'Owl Strike', damage: 1 },
  spider: { kind: 'web', name: 'Spider Web', damage: 0 },
};
export const spellFor = (id: string): Spell => SPELLS[id] ?? { kind: 'swoop', name: 'Shadow Swoop', damage: 1 };

/** Size of the wolf on the paper. */
export const WOLF_SCALE = 1.25;

export interface WolfLook {
  /** 0..1 jaw open. */
  open: number;
  /** Walk cycle phase, radians. */
  walk: number;
  /** 0..1 mid-leap: legs stretch and stop walking (move `x` for the leap itself). */
  lunge: number;
  /** 0..1 crouch before a lunge. */
  crouch: number;
}

/**
 * Draw the wolf as capsules straight onto the wall (it is a shadow puppet,
 * not a hand), facing left. Fills one hand slot (32 segments) from `slot0`
 * in the SegmentBuffer layout. Returns the eye position in `eye`.
 */
export function drawWolf(d: Float32Array, slot0: number, x: number, y: number, look: WolfLook, eye: [number, number]) {
  const S = WOLF_SCALE;
  const ox = x;
  const oy = y - look.crouch * 0.025;
  let i = slot0;
  const pen = 0.0035;
  const cap = (ax: number, ay: number, ar: number, bx: number, by: number, br: number) => {
    const o = i * 8;
    d[o] = ox + ax * S; d[o + 1] = oy + ay * S; d[o + 2] = ar * S; d[o + 3] = pen;
    d[o + 4] = ox + bx * S; d[o + 5] = oy + by * S; d[o + 6] = br * S; d[o + 7] = pen;
    i++;
  };
  const w = look.walk;
  const step = (ph: number) => Math.sin(w + ph) * 0.03 * (1 - look.lunge);
  const lift = (ph: number) => Math.max(0, Math.cos(w + ph)) * 0.012 * (1 - look.lunge);
  // head rises with the open jaw; the whole front dips in the crouch
  const hy = 0.0 - look.crouch * 0.03 + look.open * 0.01;
  // body: chest, belly, hips
  cap(-0.1, 0.0, 0.075, 0.02, 0.005, 0.066);
  cap(0.02, 0.005, 0.066, 0.13, 0.015, 0.06);
  // neck and head
  cap(-0.12, 0.03, 0.055, -0.19, 0.1 + hy, 0.045);
  cap(-0.19, 0.11 + hy, 0.045, -0.215, 0.115 + hy, 0.042);
  // snout tilts up a little as the jaw opens; lower jaw drops
  const up = look.open * 0.025;
  cap(-0.22, 0.12 + hy, 0.03, -0.33, 0.1 + hy + up, 0.017);
  cap(-0.21, 0.085 + hy, 0.02, -0.31, 0.07 + hy - look.open * 0.06, 0.01);
  // teeth when the jaw opens
  if (look.open > 0.3) {
    cap(-0.3, 0.092 + hy + up, 0.004, -0.296, 0.078 + hy + up, 0.002);
    cap(-0.27, 0.095 + hy + up * 0.8, 0.004, -0.266, 0.08 + hy + up * 0.8, 0.002);
  } else {
    // zero radius: unused slots
    cap(0, 0, 0, 0, 0, 0);
    cap(0, 0, 0, 0, 0, 0);
  }
  // ears, back one a little lower
  cap(-0.185, 0.15 + hy, 0.02, -0.165, 0.215 + hy, 0.004);
  cap(-0.215, 0.15 + hy, 0.018, -0.205, 0.205 + hy, 0.004);
  // hackles along the back: short spikes
  for (let k = 0; k < 5; k++) {
    const bx = -0.13 + k * 0.05;
    const by = 0.06 + (k === 0 ? 0.03 : 0);
    cap(bx, by, 0.014, bx + 0.025, by + 0.035 + look.crouch * 0.02, 0.003);
  }
  // legs: front pair and back pair, a simple walk
  cap(-0.1, -0.04, 0.026, -0.11 + step(0), -0.19 + lift(0), 0.016);
  cap(-0.07, -0.04, 0.024, -0.075 + step(Math.PI), -0.19 + lift(Math.PI), 0.015);
  cap(0.12, -0.0, 0.04, 0.115 + step(Math.PI), -0.1, 0.022);
  cap(0.115 + step(Math.PI), -0.1, 0.022, 0.13 + step(Math.PI), -0.19 + lift(Math.PI), 0.015);
  cap(0.1, -0.0, 0.036, 0.09 + step(0), -0.1, 0.02);
  cap(0.09 + step(0), -0.1, 0.02, 0.1 + step(0), -0.19 + lift(0), 0.014);
  // paws
  cap(-0.11 + step(0) - 0.02, -0.195 + lift(0), 0.012, -0.11 + step(0) + 0.005, -0.195 + lift(0), 0.012);
  cap(0.13 + step(Math.PI) - 0.02, -0.195 + lift(Math.PI), 0.012, 0.13 + step(Math.PI) + 0.005, -0.195 + lift(Math.PI), 0.012);
  // a bushy tail that swings
  const tw = Math.sin(w * 0.5) * 0.02;
  cap(0.18, 0.04, 0.03, 0.26, 0.0 + tw, 0.035);
  cap(0.26, 0.0 + tw, 0.035, 0.32, -0.07 + tw, 0.012);
  // clear the rest of the slot
  for (; i < slot0 + 32; i++) d[i * 8 + 2] = 0;
  eye[0] = ox - 0.235 * S;
  eye[1] = oy + (0.128 + hy) * S;
}

export type BattleEvent =
  | { type: 'cast'; spell: Spell }
  | { type: 'hit'; damage: number }
  | { type: 'windup' }
  | { type: 'blocked' }
  | { type: 'hurt' }
  | { type: 'healed' }
  | { type: 'howl' }
  | { type: 'won' }
  | { type: 'lost' };

export interface Particle {
  /** Gold sparks of a spell, or drops of the wolf's ink. */
  gold: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

/** Where the lamp's light pools on the paper: the wolf must not reach it. */
export const LAMP_X = -0.6;
export const WOLF_START_X = 0.4;
export const WOLF_Y = -0.06;
/** The wolf creeps no closer than this; there it strikes again and again. */
export const WOLF_NEAR_X = 0.0;

let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export class Battle {
  readonly maxHp: number;
  hp: number;
  flames = 3;
  x = WOLF_START_X;
  t = 0;
  wardUntil = -1;
  webUntil = -1;
  /** 0 when calm; counts up through the wind-up before a lunge. */
  windup = 0;
  lunge = 0;
  state: 'fight' | 'won' | 'lost' = 'fight';
  /** Below half health the wolf howls and fights harder. */
  angry = false;
  readonly events: BattleEvent[] = [];
  readonly particles: Particle[] = [];
  private nextAttack: number;
  private windupTime: number;
  private speed: number;
  private readonly gentle: boolean;

  constructor(gentle: boolean, s = 5) {
    seed = s;
    this.gentle = gentle;
    this.maxHp = gentle ? 8 : 12;
    this.hp = this.maxHp;
    this.windupTime = gentle ? 2.2 : 1.6;
    this.speed = gentle ? 0.012 : 0.02;
    this.nextAttack = gentle ? 6 : 4.5;
  }

  get warded() {
    return this.t < this.wardUntil;
  }
  get webbed() {
    return this.t < this.webUntil;
  }

  cast(spell: Spell) {
    if (this.state !== 'fight') return;
    this.events.push({ type: 'cast', spell });
    switch (spell.kind) {
      case 'swoop':
      case 'charge':
        // damage lands when the projectile arrives: see hitNow()
        break;
      case 'ward':
        this.wardUntil = this.t + 9;
        break;
      case 'web':
        this.webUntil = this.t + 6;
        break;
      case 'heal':
        if (this.flames < 3) {
          this.flames++;
          this.events.push({ type: 'healed' });
        }
        break;
    }
  }

  /** A swoop or charge reached the wolf. */
  hitNow(damage: number) {
    if (this.state !== 'fight') return;
    this.hp = Math.max(0, this.hp - damage);
    this.x = Math.min(WOLF_START_X + 0.15, this.x + 0.05 * damage);
    // a lunge in progress is broken by a hit
    if (this.windup > 0) this.windup = Math.max(0, this.windup - 0.6);
    this.events.push({ type: 'hit', damage });
    if (!this.angry && this.hp > 0 && this.hp <= this.maxHp / 2) {
      this.angry = true;
      this.windupTime -= this.gentle ? 0.2 : 0.25;
      this.speed *= 1.4;
      this.nextAttack = Math.min(this.nextAttack, 2.5);
      this.events.push({ type: 'howl' });
    }
    this.splash(this.x - 0.15, WOLF_Y + 0.02, 6 + damage * 3, false);
    this.splash(this.x - 0.15, WOLF_Y + 0.02, 8, true);
    if (this.hp <= 0) {
      this.state = 'won';
      this.events.push({ type: 'won' });
      this.splash(this.x, WOLF_Y, 30, false);
    }
  }

  step(dt: number) {
    this.t += dt;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= 0.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    this.lunge = Math.max(0, this.lunge - dt * 3);
    if (this.state !== 'fight') return;
    // creep toward the lamp; the web slows it
    this.x = Math.max(WOLF_NEAR_X, this.x - this.speed * (this.webbed ? 0.3 : 1) * dt);
    this.nextAttack -= dt;
    if (this.windup === 0 && (this.nextAttack <= 0 || this.x <= WOLF_NEAR_X + 0.02)) {
      this.windup = 0.0001;
      this.events.push({ type: 'windup' });
    }
    if (this.windup > 0) {
      this.windup += dt * (this.webbed ? 0.6 : 1);
      if (this.windup >= this.windupTime) {
        this.windup = 0;
        this.lunge = 1;
        this.nextAttack = (this.angry ? 3.5 : 4.5) + rnd() * 2.5;
        if (this.warded) {
          this.wardUntil = -1;
          this.events.push({ type: 'blocked' });
          this.splash(LAMP_X + 0.1, -0.3, 12, true);
        } else {
          this.flames--;
          this.events.push({ type: 'hurt' });
          this.splash(LAMP_X, -0.36, 16, false);
          this.x = Math.min(WOLF_START_X, this.x + 0.12); // it falls back after a strike
          if (this.flames <= 0) {
            this.state = 'lost';
            this.events.push({ type: 'lost' });
          }
        }
      }
    }
  }

  /** How far the wind-up has gone, 0..1. */
  get windupK() {
    return this.windup > 0 ? Math.min(1, this.windup / this.windupTime) : 0;
  }

  private splash(x: number, y: number, n: number, gold: boolean) {
    for (let i = 0; i < n && this.particles.length < 32; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 0.1 + rnd() * 0.35;
      this.particles.push({ gold, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.1, life: 0.5 + rnd() * 0.6, size: gold ? 0.008 + rnd() * 0.008 : 0.006 + rnd() * 0.012 });
    }
  }
}
