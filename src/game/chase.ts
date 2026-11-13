/**
 * The Chase: the Ink Wolf hunts you across the paper. The journey scrolls,
 * obstacles rush in, and each one needs the right shadow before it hits:
 * the hare leaps a log, the crocodile swims a river, the bird flies a gap.
 * A miss lets the wolf gain; if it catches you, the stage starts again.
 *
 * Pure rules (no Three.js, no DOM), so Node tests can play whole runs.
 */

export type ObstacleKind = 'log' | 'river' | 'rock' | 'bats' | 'thorns' | 'dark' | 'gap';

export interface ObstacleInfo {
  /** Shown big when it comes: "A fallen log!" */
  name: string;
  /** The shape that clears it: a story creature id, or 'stone' for a fist. */
  shape: string;
  /** What the shape is called in the call-out. */
  shapeName: string;
  /** Shown when it is cleared. */
  done: string;
  /** How the creature moves past it: over in an arc, across flat, or a burst in place. */
  move: 'arc' | 'flat' | 'burst';
}

export const OBSTACLES: Record<ObstacleKind, ObstacleInfo> = {
  log: { name: 'A fallen log!', shape: 'hare', shapeName: 'Hare', done: 'The hare leaps the log!', move: 'arc' },
  river: { name: 'A rushing river!', shape: 'crocodile', shapeName: 'Crocodile', done: 'The crocodile carries you across!', move: 'flat' },
  gap: { name: 'The cliff ends!', shape: 'bird', shapeName: 'Bird', done: 'The bird flies you over the gap!', move: 'arc' },
  rock: { name: 'A boulder!', shape: 'stone', shapeName: 'Fist', done: 'Your fist smashes the rock!', move: 'burst' },
  bats: { name: 'Bats!', shape: 'dog', shapeName: 'Dog', done: 'The dog barks the bats away!', move: 'flat' },
  thorns: { name: 'A wall of thorns!', shape: 'deer', shapeName: 'Deer', done: 'The deer’s antlers part the thorns!', move: 'arc' },
  dark: { name: 'Living darkness!', shape: 'moth', shapeName: 'Starfish', done: 'The starfish shines it away!', move: 'burst' },
};

export interface Stage {
  name: string;
  /** One line when the stage starts. */
  line: string;
  kinds: ObstacleKind[];
  count: number;
  /** Seconds from when an obstacle appears to when it hits. */
  approach: number;
  /** Seconds between one obstacle and the next. */
  gap: number;
}

export const STAGES: Stage[] = [
  { name: 'The Forest', line: 'Run! The Ink Wolf is on your trail.', kinds: ['log', 'thorns', 'bats'], count: 6, approach: 4.2, gap: 1.4 },
  { name: 'The River', line: 'Faster! The water is rising.', kinds: ['river', 'log', 'rock', 'bats'], count: 7, approach: 3.6, gap: 1.2 },
  { name: 'The Cliffs', line: 'Up the mountain, along the edge!', kinds: ['gap', 'rock', 'thorns', 'river'], count: 7, approach: 3.2, gap: 1.0 },
  { name: 'The Storm', line: 'The sky goes black. Keep running!', kinds: ['dark', 'bats', 'gap', 'river', 'log'], count: 8, approach: 2.8, gap: 0.9 },
  { name: 'The Last Run', line: 'The wolf is right behind you. Everything at once!', kinds: ['log', 'river', 'rock', 'bats', 'thorns', 'dark', 'gap'], count: 9, approach: 2.5, gap: 0.8 },
];

/** Where the runner is on the paper (wall meters). */
export const HERO_X = -0.28;
export const GROUND_Y = -0.3;
/** Obstacles come in from here. */
export const SPAWN_X = 0.9;
/** Hold the right shape this long to clear an obstacle. */
export const CLEAR_HOLD = 0.22;
export const LEAD_MAX = 3;

export type ChaseEvent =
  | { type: 'stage'; stage: number }
  | { type: 'spawn'; kind: ObstacleKind }
  | { type: 'clear'; kind: ObstacleKind; early: number }
  | { type: 'miss'; kind: ObstacleKind; lead: number }
  | { type: 'pull' }
  | { type: 'caught' }
  | { type: 'escaped' };

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  gold: boolean;
}

export interface Obstacle {
  kind: ObstacleKind;
  /** Seconds since it appeared. */
  t: number;
  /** Seconds it takes to reach the runner. */
  approach: number;
  /** null while coming; then cleared or missed, with seconds since. */
  result: null | 'clear' | 'miss';
  since: number;
}

export class Chase {
  stage = 0;
  /** 'intro': the stage name shows; 'run'; 'caught': the wolf has you, the stage restarts; 'won': you escaped. */
  state: 'intro' | 'run' | 'caught' | 'won' = 'intro';
  stateTime = 0;
  /** Steps ahead of the wolf (0 = caught). */
  lead = LEAD_MAX;
  /** Clears in a row since the last miss. */
  streak = 0;
  best = 0;
  cleared = 0;
  missed = 0;
  /** How far the journey has scrolled (meters of paper), for the moving scenery. */
  distance = 0;
  /** Paper meters per second. */
  speed = 0;
  obstacle: Obstacle | null = null;
  readonly events: ChaseEvent[] = [];
  readonly particles: Particle[] = [];
  private left = 0;
  private wait = 0;
  private hold = 0;
  private seed: number;
  private order: ObstacleKind[] = [];
  /** Times caught in this stage: each one gives a longer lead and slower obstacles next try. */
  retries = 0;

  constructor(
    readonly gentle = false,
    seed = 3,
  ) {
    this.seed = seed;
    this.startStage(0);
  }

  get info() {
    return STAGES[this.stage];
  }
  /** 0..1: time left before the current obstacle hits. */
  get timeLeft() {
    const o = this.obstacle;
    return o && !o.result ? Math.max(0, 1 - o.t / o.approach) : 0;
  }
  /** The shape the player must make now, or null. */
  get wanted(): string | null {
    const o = this.obstacle;
    return this.state === 'run' && o && !o.result ? OBSTACLES[o.kind].shape : null;
  }
  /** Where the current obstacle is on the paper. */
  get obstacleX() {
    const o = this.obstacle;
    if (!o) return SPAWN_X;
    const k = Math.min(1, o.t / o.approach);
    return SPAWN_X + (HERO_X + 0.12 - SPAWN_X) * k - (o.result ? o.since * this.speed : 0);
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private startStage(i: number) {
    if (i !== this.stage) this.retries = 0;
    this.stage = i;
    this.state = 'intro';
    this.stateTime = 0;
    this.obstacle = null;
    this.left = STAGES[i].count;
    this.wait = 0;
    this.hold = 0;
    this.lead = (this.gentle ? LEAD_MAX + 2 : LEAD_MAX) + Math.min(this.retries, 2);
    // a shuffled order that uses every kind of the stage before repeating
    const kinds = STAGES[i].kinds;
    this.order = [];
    while (this.order.length < this.left) {
      const bag = [...kinds];
      for (let k = bag.length - 1; k > 0; k--) {
        const j = Math.floor(this.rnd() * (k + 1));
        [bag[k], bag[j]] = [bag[j], bag[k]];
      }
      // never the same obstacle twice in a row
      if (this.order.length && bag[0] === this.order[this.order.length - 1]) bag.push(bag.shift()!);
      this.order.push(...bag);
    }
    this.order.length = this.left;
    this.events.push({ type: 'stage', stage: i });
  }

  /**
   * One frame. `making`: the shape the player is making now (a creature id,
   * 'stone', or null), as read by the scene.
   */
  step(dt: number, making: string | null) {
    this.stateTime += dt;
    const st = STAGES[this.stage];
    const slow = (this.gentle ? 1.4 : 1) * (1 + 0.12 * Math.min(this.retries, 3));
    // the paper scrolls faster as the stages go on, and stops when caught
    const want = this.state === 'caught' ? 0 : this.state === 'won' ? 0.15 : 0.32 / (st.approach / 4.2);
    this.speed += (want - this.speed) * Math.min(1, dt * 3);
    this.distance += this.speed * dt;
    this.stepParticles(dt);

    if (this.state === 'intro') {
      if (this.stateTime > 2.4) {
        this.state = 'run';
        this.stateTime = 0;
        this.wait = 0.4;
      }
      return;
    }
    if (this.state === 'caught') {
      if (this.stateTime > 3.2) this.startStage(this.stage);
      return;
    }
    if (this.state === 'won') return;

    const o = this.obstacle;
    if (o) {
      if (!o.result) {
        o.t += dt;
        const ok = making === OBSTACLES[o.kind].shape;
        this.hold = ok ? this.hold + dt : 0;
        if (this.hold >= (this.gentle ? CLEAR_HOLD * 0.7 : CLEAR_HOLD)) {
          o.result = 'clear';
          o.since = 0;
          this.hold = 0;
          this.cleared++;
          this.streak++;
          this.best = Math.max(this.best, this.streak);
          this.events.push({ type: 'clear', kind: o.kind, early: 1 - o.t / o.approach });
          this.burst(this.obstacleX, GROUND_Y + 0.06, 14, true);
          // three in a row: you pull a step ahead
          if (this.streak % 3 === 0 && this.lead < (this.gentle ? LEAD_MAX + 2 : LEAD_MAX) + Math.min(this.retries, 2)) {
            this.lead++;
            this.events.push({ type: 'pull' });
          }
        } else if (o.t >= o.approach) {
          o.result = 'miss';
          o.since = 0;
          this.hold = 0;
          this.missed++;
          this.streak = 0;
          this.lead--;
          this.events.push({ type: 'miss', kind: o.kind, lead: this.lead });
          this.burst(HERO_X + 0.06, GROUND_Y + 0.05, 10, false);
          if (this.lead <= 0) {
            this.retries++;
            this.state = 'caught';
            this.stateTime = 0;
            this.events.push({ type: 'caught' });
            return;
          }
        }
      } else {
        o.since += dt;
        if (o.since > 0.9) {
          this.obstacle = null;
          this.left--;
          this.wait = st.gap * slow;
        }
      }
      return;
    }
    // between obstacles
    this.wait -= dt;
    if (this.wait > 0) return;
    if (this.left <= 0) {
      if (this.stage + 1 < STAGES.length) this.startStage(this.stage + 1);
      else {
        this.state = 'won';
        this.stateTime = 0;
        this.events.push({ type: 'escaped' });
      }
      return;
    }
    const kind = this.order[STAGES[this.stage].count - this.left];
    this.obstacle = { kind, t: 0, approach: st.approach * slow, result: null, since: 0 };
    this.hold = 0;
    this.events.push({ type: 'spawn', kind });
  }

  private burst(x: number, y: number, n: number, gold: boolean) {
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const v = 0.15 + this.rnd() * 0.35;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 0.15, life: 0.6 + this.rnd() * 0.5, size: gold ? 0.012 : 0.016, gold });
    }
    if (this.particles.length > 40) this.particles.splice(0, this.particles.length - 40);
  }

  private stepParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= 0.6 * dt;
      p.x += (p.vx - this.speed * 0.5) * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].life <= 0) this.particles.splice(i, 1);
  }
}
