/**
 * The Chase on the paper: the runner with the lantern, the Ink Wolf behind,
 * obstacles rushing in, and the creature that clears each one. Reads the
 * player's shadow (creature shapes by the matcher, a fist by its joints) and
 * runs the Chase rules.
 */
import type { WebGLRenderer } from '@iwsdk/core';
import type { Sfx } from './audio.js';
import { Chase, type ChaseEvent, GROUND_Y, HERO_X, OBSTACLES, STAGES } from './chase.js';
import { ART, ArtSprite } from './creature-art.js';
import { type HandPose, poseToJoints } from './hand-model.js';
import { LEVELS } from './levels.js';
import { FOREARM_SLOT, GRID_H, GRID_W, gridToWall, Matcher, projectHand, rasterize, SegmentBuffer, SEGS_PER_HAND, shapeStats } from './silhouette.js';
import type { Theater } from './theater.js';
import { degreeFor, type HandMusic, instrumentFor } from './music.js';
import { ToolTracker } from './tools.js';

interface Cand {
  id: string;
  m: Matcher | null;
  threshold: number;
  segs: Float32Array;
  cx: number;
  cy: number;
}

/** The fist that smashes rocks, for the guide outline. */
const FIST: HandPose = {
  hand: 'right',
  pos: [0.1, -0.22, -0.42],
  thumb: { curl: 0.6, opp: 0.6 },
  index: { curl: 0.95 },
  middle: { curl: 0.95 },
  ring: { curl: 0.95 },
  pinky: { curl: 0.95 },
};
/** Where the guide outline of the wanted shape sits (wall meters) and its scale. */
const GUIDE: [number, number, number] = [0.46, 0.06, 0.5];

export class ChaseScene {
  chase: Chase | null = null;
  private cands = new Map<string, Cand>();
  private segs = new SegmentBuffer(4);
  private trackers = [new ToolTracker(), new ToolTracker()];
  private time = 0;
  private eventCount = 0;
  private gentle = false;
  private guideAlpha = 0;
  private hurtFlash = 0;
  private hitFlash = 0;
  private shake = 0;
  /** A creature clearing an obstacle: which, and seconds since. */
  private act: { id: string; move: 'arc' | 'flat' | 'burst'; t: number; x0: number; x1: number } | null = null;
  private jump = 0;
  private line = '';
  private sub = '';
  /** Every clear, miss and stage with its time, for the video's soundtrack. */
  readonly log: { t: number; type: string }[] = [];
  score = 0;
  /** 0..1: how close the player's shadow is to the wanted shape, for the glow. */
  magic = 0;

  private runner = new ArtSprite(6);
  private wolf = new ArtSprite(5);
  private obstacle = new ArtSprite(5);
  private creature = new ArtSprite(7);

  /** Seconds between drum steps in the current stage. */
  private every = 0.3;
  /** The player's hand height (theater y), for the note a clear adds to the tune. */
  private handY = -0.25;

  constructor(
    private theater: Theater,
    private sfx: Sfx,
    private music: HandMusic,
  ) {
    theater.root.add(this.wolf.mesh, this.obstacle.mesh, this.runner.mesh, this.creature.mesh);
  }

  start(gentle: boolean) {
    this.gentle = gentle;
    const buf = new SegmentBuffer();
    const m = new Uint8Array(GRID_W * GRID_H);
    const ids = new Set(Object.values(OBSTACLES).map((o) => o.shape));
    this.cands.clear();
    for (const id of ids) {
      const hands = id === 'stone' ? [FIST] : LEVELS.find((l) => l.id === id)?.hands;
      if (!hands) continue;
      buf.clear();
      hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
      rasterize(buf, m);
      const matcher = new Matcher();
      matcher.setTarget(m);
      const [cx, cy] = gridToWall(matcher.targetStats.cx, matcher.targetStats.cy);
      const threshold = LEVELS.find((l) => l.id === id)?.threshold ?? 0.6;
      this.cands.set(id, { id, m: id === 'stone' ? null : matcher, threshold, segs: buf.data.slice(), cx, cy });
    }
    this.chase = new Chase(gentle, 3);
    this.eventCount = 0;
    this.act = null;
    this.sfx.setBattle(true);
    this.sfx.setTempo(0.3);
    this.every = 0.3;
    this.music.reset();
    this.log.push({ t: this.time, type: 'chase' });
    this.line = '';
    this.inkPanel();
  }

  stop() {
    this.sfx.setBattle(false);
    this.sfx.setTempo(0.375);
    for (const s of [this.runner, this.wolf, this.obstacle, this.creature]) {
      s.set(0);
      s.hide();
    }
    const u = this.theater.wallMat.uniforms;
    u.uChase.value = 0;
    u.uDark.value = 0;
    u.uFlash.value.set(0, 0, 0, 0);
    u.uDotCount.value = 0;
    u.uMeter.value = 0;
    u.uTargetAlpha.value = 0;
    u.uTargetAura.value.setRGB(1.0, 0.72, 0.3);
    this.chase = null;
  }

  get info() {
    const c = this.chase;
    return c
      ? { stage: c.stage, state: c.state, lead: c.lead, streak: c.streak, cleared: c.cleared, missed: c.missed, wanted: c.wanted, timeLeft: c.timeLeft }
      : null;
  }

  /** Returns true once the player has escaped and the moment has played out. */
  update(dt: number, renderer: WebGLRenderer, mask: Uint8Array, area: number, joints: { left: Float32Array; right: Float32Array }, present: { left: boolean; right: boolean }, handY: number): boolean {
    const c = this.chase;
    if (!c) return false;
    this.time += dt;
    this.handY = handY;
    const u = this.theater.wallMat.uniforms;

    // ---- read the player's shadow as the wanted shape
    const tR = this.trackers[0].update(present.right ? joints.right : null, 'right', dt);
    const tL = this.trackers[1].update(present.left ? joints.left : null, 'left', dt);
    const wanted = c.wanted;
    let making: string | null = null;
    let ratio = 0;
    if (wanted === 'stone') {
      ratio = tR === 'stone' || tL === 'stone' ? 1 : 0;
      if (ratio >= 1) making = 'stone';
    } else if (wanted && area > 0) {
      const cand = this.cands.get(wanted);
      if (cand?.m) {
        const sc = cand.m.scoreWithStats(mask, shapeStats(mask), true);
        ratio = sc / (cand.threshold - 0.04 - (this.gentle ? 0.1 : 0));
        this.score += (sc - this.score) * Math.min(1, dt * 8);
        if (ratio >= 1) making = wanted;
      }
    }
    this.magic += (Math.max(0, Math.min(1, (ratio - 0.7) / 0.3)) - this.magic) * Math.min(1, dt * 8);
    c.step(dt, making);
    for (; this.eventCount < c.events.length; this.eventCount++) this.onEvent(c.events[this.eventCount]);
    // the tune the player has built loops over the drums
    if (c.state === 'run' || c.state === 'intro') this.music.tick(this.time, this.every);

    // ---- the runner, the wolf, the obstacle, and the creature that clears it
    const bob = Math.abs(Math.sin(c.distance * 16)) * 0.012;
    this.jump = Math.max(0, this.jump - dt * 1.6);
    const jy = Math.sin(Math.min(1, 1 - this.jump) * Math.PI) * (this.jump > 0 ? 0.1 : 0);
    const caught = c.state === 'caught' ? Math.min(1, c.stateTime / 0.5) : 0;
    const sh = this.shake * Math.sin(this.time * 70) * 0.012;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.runner.id === 'runner' || this.runner.show('runner')) {
      const h = ART.runner.height;
      this.runner.place(HERO_X + sh, GROUND_Y + h / 2 + bob + jy, h, (this.hurtFlash > 0.3 ? -0.3 : 0) + caught * 0.6);
      this.runner.set(1, 1, this.time, this.hurtFlash * 0.4);
    }
    // the wolf runs behind, closer with every miss; when it catches you it pounces
    const lead = c.state === 'won' ? 6 : c.lead;
    const wolfX = HERO_X - 0.14 - Math.min(lead, 4) * 0.11 + caught * 0.1 + Math.sin(this.time * 1.7) * 0.01;
    if (this.wolf.id === 'wolf' || this.wolf.show('wolf')) {
      const h = ART.wolf.height * 0.62;
      const wbob = Math.abs(Math.sin(c.distance * 11 + 1)) * 0.016;
      this.wolf.place(wolfX, GROUND_Y + h / 2 - 0.01 + wbob, h, 0.08 * Math.sin(c.distance * 11), 1, 1, true);
      this.wolf.set(c.state === 'won' ? Math.max(0, 1 - c.stateTime) : 1, 1, this.time);
    }
    const o = c.obstacle;
    if (o && (this.obstacle.id === o.kind || this.obstacle.show(o.kind))) {
      const info = ART[o.kind];
      const h = info.height;
      const y = o.kind === 'bats' ? GROUND_Y + 0.2 + Math.sin(this.time * 6) * 0.015 : o.kind === 'river' || o.kind === 'gap' ? GROUND_Y + h / 2 - 0.05 : GROUND_Y + h / 2 - 0.01;
      const x = c.obstacleX + (o.result === 'miss' ? sh : 0);
      this.obstacle.place(x, y, h);
      const alpha = Math.min(1, o.t * 5) * (o.result === 'clear' ? Math.max(0, 1 - o.since * 1.4) : o.result === 'miss' ? Math.max(0, 1 - Math.max(0, o.since - 0.4) * 2) : 1);
      this.obstacle.set(alpha, o.result === 'clear' ? Math.max(0, 1 - o.since * 1.8) : 1, this.time, o.result === 'clear' ? Math.max(0, 0.6 - o.since) : 0);
    } else {
      this.obstacle.set(0);
    }
    if (this.act) {
      const a = this.act;
      a.t += dt;
      const k = Math.min(1, a.t / 0.85);
      const id = a.id;
      if (id !== 'stone' && (this.creature.id === id || this.creature.show(id))) {
        const h = ART[id].height * (a.move === 'burst' ? 0.5 + k * 0.6 : 0.5);
        const x = a.move === 'burst' ? a.x1 : a.x0 + (a.x1 - a.x0) * k;
        const y = a.move === 'arc' ? GROUND_Y + 0.12 + Math.sin(Math.PI * k) * 0.22 : a.move === 'flat' ? GROUND_Y + 0.08 : GROUND_Y + 0.14;
        const tilt = a.move === 'arc' ? Math.cos(Math.PI * k) * 0.35 : 0;
        this.creature.place(x, y, h, tilt);
        this.creature.set(Math.min(1, k * 6) * (k > 0.75 ? (1 - k) / 0.25 : 1), Math.min(1, k * 5), this.time, Math.max(0, 0.5 - k));
      }
      if (k >= 1) {
        this.act = null;
        this.creature.set(0);
      }
    }

    // ---- the guide: the outline of the wanted shape, top right
    const wantedNow = c.wanted;
    this.guideAlpha += ((wantedNow ? 1 : 0) - this.guideAlpha) * Math.min(1, dt * 8);
    this.segs.data.fill(0);
    const gc = wantedNow ? this.cands.get(wantedNow) : null;
    if (gc) placeShadow(gc, GUIDE[0], GUIDE[1], GUIDE[2], this.segs.data);
    this.theater.target.render(renderer, this.segs);
    u.uTargetMode.value = 0;
    u.uTargetAlpha.value = this.guideAlpha;
    u.uTargetAura.value.setRGB(1.0, 0.72, 0.3);
    u.uEye.value.w = 0;
    u.uRedEye.value.set(0, 0, 0, 0);
    u.uFlames.value = -1;

    // ---- paper, effects, the time bar
    u.uChase.value = Math.min(1, (u.uChase.value as number) + dt * 2);
    u.uScroll.value = c.distance;
    const dark = c.stage === 3 ? 0.55 : c.stage === 4 ? 0.3 : 0;
    u.uDark.value += (dark - (u.uDark.value as number)) * Math.min(1, dt * 2);
    // the storm: lightning lights the paper for a moment
    if (c.stage === 3 && this.time % 3.7 < 0.1) u.uDark.value = -0.4;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    // danger: the paper pulses red as an obstacle is about to hit
    const tl = c.timeLeft;
    if (wantedNow && tl < 0.3) this.hurtFlash = Math.max(this.hurtFlash, 0.22 * (0.5 + 0.5 * Math.sin(this.time * 18)) * (1 - tl / 0.3));
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    u.uFlash.value.set(this.hurtFlash, this.hitFlash, 0, 0);
    u.uFxPos.value.set(0, 0, c.obstacleX, GROUND_Y + 0.08);
    u.uMeter.value = wantedNow ? 1 : 0;
    u.uScore.value = c.timeLeft;
    u.uThreshold.value = 2;
    u.uHold.value = 0;
    const arr = u.uDots.value as Float32Array;
    let n = 0;
    for (const p of c.particles) {
      if (n >= 32) break;
      arr[n * 4] = p.x;
      arr[n * 4 + 1] = p.y;
      arr[n * 4 + 2] = p.size;
      arr[n * 4 + 3] = p.gold ? -Math.min(1, p.life * 1.5) : 1;
      n++;
    }
    u.uDotKind.value = 2;
    u.uDotCount.value = n;

    return c.state === 'won' && c.stateTime > 3.5;
  }

  private onEvent(e: ChaseEvent) {
    const c = this.chase!;
    switch (e.type) {
      case 'stage': {
        const st = STAGES[e.stage];
        this.line = st.name;
        this.sub = st.line;
        this.every = Math.max(0.2, 0.3 * (st.approach / 4.2));
        this.sfx.setTempo(this.every);
        this.sfx.cue('growl');
        this.log.push({ t: this.time, type: 'growl' });
        break;
      }
      case 'spawn': {
        const ob = OBSTACLES[e.kind];
        this.line = ob.name;
        this.sub = `Make the ${ob.shapeName}!`;
        this.sfx.cue('whoosh');
        this.log.push({ t: this.time, type: 'whoosh' });
        break;
      }
      case 'clear': {
        const ob = OBSTACLES[e.kind];
        this.line = e.early > 0.5 ? 'Brilliant!' : e.early > 0.25 ? 'Nice!' : 'Just in time!';
        this.sub = ob.done;
        this.hitFlash = 1;
        this.jump = ob.move === 'arc' ? 1 : 0;
        this.act = { id: ob.shape, move: ob.move, t: 0, x0: HERO_X - 0.05, x1: c.obstacleX + (ob.move === 'burst' ? 0 : 0.22) };
        // the creature's note joins the tune, on the beat
        this.music.add(this.time, { inst: instrumentFor(ob.shape), degree: degreeFor(this.handY) }, this.every);
        if (ob.shape === 'stone') {
          this.sfx.cue('thump');
          this.log.push({ t: this.time, type: 'thump' });
        }
        break;
      }
      case 'pull':
        this.sub = 'Three in a row! You pull ahead of the wolf.';
        break;
      case 'miss':
        this.line = 'Too slow!';
        this.sub = e.lead > 0 ? `The wolf gains on you. ${e.lead} ${e.lead === 1 ? 'step' : 'steps'} ahead.` : '';
        this.hurtFlash = 1;
        this.shake = 1;
        this.music.drop(this.time);
        this.sfx.cue('hurt');
        this.log.push({ t: this.time, type: 'hurt' });
        break;
      case 'caught':
        this.music.drop(this.time);
        this.line = 'The wolf caught you!';
        this.sub = 'Shake it off and run this stretch again.';
        this.sfx.cue('growl');
        this.log.push({ t: this.time, type: 'growl' });
        break;
      case 'escaped':
        this.line = 'You escaped!';
        this.sub = 'But the wolf is waiting at the top of the cliff...';
        this.sfx.setBattle(false);
        this.sfx.cue('win');
        this.log.push({ t: this.time, type: 'win' });
        this.log.push({ t: this.time, type: 'calm' });
        break;
    }
    this.inkPanel();
  }

  /** The stage, the call-out, and the lead and streak along the bottom. */
  private inkPanel() {
    const c = this.chase!;
    const cv = this.theater.ink;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.globalAlpha = 0.6;
    g.font = 'italic 26px Georgia, serif';
    g.fillText(`${STAGES[c.stage].name}  ·  stage ${c.stage + 1} of ${STAGES.length}`, 512, 44);
    g.globalAlpha = 1;
    g.font = 'italic 700 64px Georgia, serif';
    g.fillText(this.line, 512, 112);
    g.font = '600 36px Georgia, serif';
    g.fillText(this.sub, 512, 160);
    // lead: one lantern dot per step ahead of the wolf
    const max = this.gentle ? 5 : 3;
    g.globalAlpha = 0.75;
    g.font = '24px Georgia, serif';
    g.textAlign = 'left';
    g.fillText('Ahead', 40, 676);
    for (let i = 0; i < max; i++) {
      g.beginPath();
      g.arc(132 + i * 26, 668, 9, 0, Math.PI * 2);
      if (i < c.lead) g.fill();
      else {
        g.lineWidth = 2;
        g.stroke();
      }
    }
    g.textAlign = 'right';
    g.fillText(c.streak > 1 ? `Streak ${c.streak}` : '', 990, 676);
    g.globalAlpha = 1;
    this.theater.inkTex.needsUpdate = true;
  }
}

/** Write a shape's shadow into `out` (from slot 0), centered at x, y and scaled by s. */
function placeShadow(c: Cand, x: number, y: number, s: number, out: Float32Array) {
  const d = c.segs;
  const n = Math.min(d.length, out.length) / 8;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    if (d[o + 2] <= 0 || i % SEGS_PER_HAND === FOREARM_SLOT) {
      out[o + 2] = 0;
      continue;
    }
    out[o] = x + (d[o] - c.cx) * s;
    out[o + 1] = y + (d[o + 1] - c.cy) * s;
    out[o + 2] = d[o + 2] * s;
    out[o + 3] = d[o + 3];
    out[o + 4] = x + (d[o + 4] - c.cx) * s;
    out[o + 5] = y + (d[o + 5] - c.cy) * s;
    out[o + 6] = d[o + 6] * s;
    out[o + 7] = d[o + 7];
  }
}
