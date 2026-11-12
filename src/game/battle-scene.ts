/**
 * Chapter four on the paper: draws the Ink Wolf and the flying spells,
 * reads the player's shadow as spells, and runs the Battle rules.
 */
import type { WebGLRenderer } from '@iwsdk/core';
import type { Sfx } from './audio.js';
import { Battle, type BattleEvent, drawWolf, LAMP_X, type Spell, spellFor, WOLF_Y, type WolfLook } from './battle.js';
import { poseToJoints } from './hand-model.js';
import { LEVELS, type Level } from './levels.js';
import { FOREARM_SLOT, GRID_H, GRID_W, gridToWall, Matcher, projectHand, rasterize, SegmentBuffer, shapeStats, SEGS_PER_HAND } from './silhouette.js';
import type { Theater } from './theater.js';
import { ART, ArtSprite, WOLF_EYE_UV } from './creature-art.js';

/** Hold a spell shape this long to cast it. */
const CAST_HOLD = 0.35;
const CAST_HOLD_GENTLE = 0.25;
const WARD_POS: [number, number] = [-0.625, -0.33];
const FLAMES_POS: [number, number] = [-0.625, -0.38];

interface SpellCand {
  level: Level;
  spell: Spell;
  m: Matcher;
  /** The creature's shadow, two hand slots, and its centroid and area. */
  segs: Float32Array;
  cx: number;
  cy: number;
  area: number;
}

interface Shot {
  cand: SpellCand;
  t: number;
  dur: number;
  from: [number, number, number];
  to: [number, number, number];
  arc: number;
}

export class BattleScene {
  battle: Battle | null = null;
  private cands: SpellCand[] = [];
  private segs = new SegmentBuffer(4);
  private hold = 0;
  private best = -1;
  /** After a cast, the shape must change (or loosen) before the same spell casts again. */
  private needRelease = -1;
  private cool = 0;
  private shot: Shot | null = null;
  private hurtFlash = 0;
  private hitFlash = 0;
  private wardAlpha = 0;
  private webAlpha = 0;
  private flames = 3;
  private endAt = -1;
  private gentle = false;
  private eye: [number, number] = [0, 0];
  private look: WolfLook = { open: 0, walk: 0, lunge: 0, crouch: 0 };
  private wolfAlpha = 1;
  private time = 0;
  private line = '';
  private eventCount = 0;
  private warnedThisWindup = false;
  private seed = 5;
  /** Every cast, hit and strike with its time, for the video's soundtrack. */
  readonly log: { t: number; type: string }[] = [];
  score = 0;
  /** 0..1: how close the player's shadow is to any spell, for the glow. */
  magic = 0;

  /** The illustrated wolf, and the illustrated creature of a flying spell. */
  private wolfSprite = new ArtSprite(5);
  private shotSprite = new ArtSprite(7);
  private shotArt = false;

  constructor(
    private theater: Theater,
    private sfx: Sfx,
  ) {
    theater.root.add(this.wolfSprite.mesh, this.shotSprite.mesh);
  }

  /** Build the spellbook from the creatures the player has found (all of them if fewer than three). */
  start(gentle: boolean, found: string[]) {
    this.gentle = gentle;
    const known = LEVELS.filter((l) => found.includes(l.id));
    const levels = known.length >= 3 ? known : LEVELS;
    const buf = new SegmentBuffer();
    const m = new Uint8Array(GRID_W * GRID_H);
    this.cands = levels.map((level) => {
      buf.clear();
      level.hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
      const area = rasterize(buf, m);
      const matcher = new Matcher();
      matcher.setTarget(m);
      const [cx, cy] = gridToWall(matcher.targetStats.cx, matcher.targetStats.cy);
      return { level, spell: spellFor(level.id), m: matcher, segs: buf.data.slice(), cx, cy, area };
    });
    this.reset();
  }

  private reset() {
    this.battle = new Battle(this.gentle, this.seed++);
    this.hold = 0;
    this.best = -1;
    this.needRelease = -1;
    this.cool = 0;
    this.shot = null;
    this.flames = 3;
    this.endAt = -1;
    this.wolfAlpha = 1;
    this.eventCount = 0;
    this.warnedThisWindup = false;
    const ward = this.cands.find((c) => c.spell.kind === 'ward');
    this.line = ward
      ? `It wants your flames. Cast spells at it. Its eyes burn red before it bites: the ${short(ward.level)} blocks.`
      : 'It wants your flames. Make shadows from your Book to cast them at it.';
    this.sfx.setBattle(true);
    this.log.push({ t: this.time, type: 'battle' });
    this.inkPanel();
  }

  stop() {
    this.sfx.setBattle(false);
    this.wolfSprite.set(0);
    this.wolfSprite.hide();
    this.shotSprite.set(0);
    this.shotSprite.hide();
    const u = this.theater.wallMat.uniforms;
    u.uRedEye.value.set(0, 0, 0, 0);
    u.uTargetAura.value.setRGB(1.0, 0.72, 0.3);
    u.uFlash.value.set(0, 0, 0, 0);
    u.uFlames.value = -1;
    u.uDotCount.value = 0;
    u.uMeter.value = 0;
    u.uTargetAlpha.value = 0;
    this.battle = null;
  }

  get info() {
    const b = this.battle;
    return b ? { hp: b.hp, maxHp: b.maxHp, flames: b.flames, state: b.state, windup: b.windupK, warded: b.warded, spells: this.cands.map((c) => c.level.id) } : null;
  }

  /** Returns true once the wolf is beaten and the victory has played out. */
  update(dt: number, renderer: WebGLRenderer, mask: Uint8Array, area: number): boolean {
    const b = this.battle;
    if (!b) return false;
    this.time += dt;
    const u = this.theater.wallMat.uniforms;

    // ---- read the player's shadow as a spell
    this.cool = Math.max(0, this.cool - dt);
    let best = -1, bestScore = 0, bestRatio = 0;
    if (area > 0 && b.state === 'fight') {
      const st = shapeStats(mask);
      for (let i = 0; i < this.cands.length; i++) {
        const c = this.cands[i];
        const sc = c.m.scoreWithStats(mask, st, true);
        const thr = this.thr(c);
        if (sc / thr > bestRatio) {
          bestRatio = sc / thr;
          bestScore = sc;
          best = i;
        }
      }
    }
    this.score += (bestScore - this.score) * Math.min(1, dt * 8);
    this.magic = best >= 0 ? Math.max(0, Math.min(1, (bestRatio - 0.7) / 0.3)) : 0;
    if (this.needRelease >= 0 && (best !== this.needRelease || bestRatio < 0.88)) this.needRelease = -1;
    if (best !== this.best) this.hold = 0;
    this.best = best;
    const ready = best >= 0 && bestRatio >= 1 && best !== this.needRelease && !this.shot && this.cool === 0;
    this.hold = ready ? this.hold + dt : 0;
    if (ready && this.hold >= (this.gentle ? CAST_HOLD_GENTLE : CAST_HOLD)) this.cast(best);

    // ---- the flying spell
    this.segs.data.fill(0, SEGS_PER_HAND * 8);
    if (this.shot) {
      const s = this.shot;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = s.cand.spell.kind === 'charge' ? k * k : 1 - (1 - k) * (1 - k);
      const x = s.from[0] + (s.to[0] - s.from[0]) * e;
      const y = s.from[1] + (s.to[1] - s.from[1]) * e + Math.sin(Math.PI * k) * s.arc;
      const sc = s.from[2] + (s.to[2] - s.from[2]) * e;
      if (this.shotArt) {
        // the creature itself flies, tilted along its path, small and bright
        const dx = s.to[0] - s.from[0];
        const tilt = Math.atan2(Math.cos(Math.PI * k) * s.arc * Math.PI, Math.abs(dx) + 0.001) * 0.5;
        this.shotSprite.place(x, y, ART[s.cand.level.id].height * 0.55 * Math.max(0.5, sc), dx >= 0 ? tilt : -tilt, 1, 1, dx < 0);
        this.shotSprite.set(1, Math.min(1, k * 4), this.time);
      } else placeShadow(s.cand, x, y, sc, this.segs.data, SEGS_PER_HAND);
      if (k >= 1) {
        this.shotSprite.set(0);
        this.land(s);
      }
    }

    // ---- rules
    b.step(dt);
    for (; this.eventCount < b.events.length; this.eventCount++) this.onEvent(b.events[this.eventCount]);

    // ---- the wolf
    const wk = b.windupK;
    if (wk === 0) this.warnedThisWindup = false;
    this.look.walk += dt * (b.state === 'fight' && wk === 0 ? (b.webbed ? 1.5 : 5) : 0);
    this.look.open = b.state === 'won' ? 1 : Math.max(wk, b.lunge);
    this.look.crouch = wk < 0.75 ? wk / 0.75 : 1 - (wk - 0.75) / 0.25;
    // the leap: in the last quarter of the wind-up the wolf springs at the flames, then falls back
    const leap = wk > 0.75 ? easeIn((wk - 0.75) / 0.25) : b.lunge;
    this.look.lunge = leap;
    const snoutReach = (b.warded || this.wardAlpha > 0.5 ? WARD_POS[0] + 0.2 : LAMP_X + 0.02) - (b.x - 0.43);
    const wx = b.x + Math.min(0, snoutReach) * leap;
    const shake = b.state === 'won' ? Math.sin(this.time * 60) * 0.006 : this.hitFlash * Math.sin(this.time * 70) * 0.01;
    drawWolf(this.segs.data, 0, wx + shake, WOLF_Y, this.look, this.eye);
    if (b.state === 'won') this.wolfAlpha = Math.max(0, this.wolfAlpha - dt * 0.8);
    const wolfArt = this.wolfSprite.id === 'wolf' || this.wolfSprite.show('wolf');
    if (wolfArt) {
      // the illustrated wolf takes the place of the shadow wolf
      this.segs.data.fill(0, 0, SEGS_PER_HAND * 8);
      const bob = Math.abs(Math.sin(this.look.walk)) * 0.006;
      this.wolfSprite.place(wx + shake, WOLF_Y + 0.01 + bob - this.look.crouch * 0.02, ART.wolf.height, -0.07 * leap, 1 + 0.06 * leap, 1 - 0.08 * this.look.crouch);
      this.wolfSprite.set(this.wolfAlpha, this.wolfAlpha, this.time, this.hitFlash * 0.55);
      this.wolfSprite.pointAt(WOLF_EYE_UV[0], WOLF_EYE_UV[1], this.eye);
    }
    u.uTargetMode.value = 1;
    u.uTargetAlpha.value = 1;
    // the wolf's glow is cold and red, brighter as it gathers to bite
    u.uTargetAura.value.setRGB(0.55 + 0.4 * wk, 0.08, 0.32 - 0.1 * wk);
    // the wolf fades by shrinking its capsules away into ink
    if (this.wolfAlpha < 1) {
      const d = this.segs.data;
      for (let i = 0; i < SEGS_PER_HAND; i++) {
        d[i * 8 + 2] *= this.wolfAlpha;
        d[i * 8 + 6] *= this.wolfAlpha;
        if (d[i * 8 + 2] < 0.002) d[i * 8 + 2] = 0;
      }
    }
    this.theater.target.render(renderer, this.segs);
    u.uRedEye.value.set(this.eye[0], this.eye[1], this.wolfAlpha > 0.3 ? 0.013 : 0, b.state === 'fight' ? Math.max(0.1 * (0.5 + 0.5 * Math.sin(this.time * 2)), wk) : 0);

    // ---- effects
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.wardAlpha += ((b.warded ? 1 : 0) - this.wardAlpha) * Math.min(1, dt * 6);
    this.webAlpha += ((b.webbed ? 1 : 0) - this.webAlpha) * Math.min(1, dt * 4);
    this.flames += (b.flames - this.flames) * Math.min(1, dt * 5);
    u.uFlash.value.set(this.hurtFlash, this.hitFlash, this.wardAlpha, this.webAlpha);
    u.uFxPos.value.set(WARD_POS[0], WARD_POS[1], wx - 0.12, WOLF_Y + 0.03);
    u.uFlames.value = this.flames;
    // wolf health on the bar along the bottom
    u.uMeter.value = b.state === 'won' ? Math.max(0, 1 - (this.time - this.endAt) / 1.5) : 1;
    u.uScore.value = b.hp / b.maxHp;
    u.uThreshold.value = 2;
    u.uHold.value = Math.min(1, this.hold / CAST_HOLD);
    const arr = u.uDots.value as Float32Array;
    let n = 0;
    for (const p of b.particles) {
      if (n >= 32) break;
      arr[n * 4] = p.x;
      arr[n * 4 + 1] = p.y;
      arr[n * 4 + 2] = p.size;
      arr[n * 4 + 3] = p.gold ? -Math.min(1, p.life * 1.5) : 1;
      n++;
    }
    u.uDotKind.value = 2;
    u.uDotCount.value = n;

    // ---- the end
    if (b.state === 'lost' && this.time - this.endAt > 4) this.reset();
    return b.state === 'won' && this.time - this.endAt > 5.5;
  }

  private thr(c: SpellCand) {
    return c.level.threshold - (this.gentle ? 0.1 : 0) - 0.02;
  }

  private cast(i: number) {
    const b = this.battle!;
    const c = this.cands[i];
    this.needRelease = i;
    this.hold = 0;
    this.cool = 0.5;
    // start from where the player's shadow is, at its size
    const st = c.m.lastStats;
    const [px, py] = gridToWall(st.cx, st.cy);
    const s0 = Math.sqrt(st.area / c.area);
    let to: [number, number, number];
    let arc = 0;
    let dur = 0.55;
    switch (c.spell.kind) {
      case 'ward':
        to = [WARD_POS[0], WARD_POS[1] + 0.02, 0.45];
        dur = 0.35;
        break;
      case 'heal':
        to = [FLAMES_POS[0], FLAMES_POS[1] + 0.12, 0.35];
        arc = 0.08;
        break;
      case 'charge':
        to = [b.x - 0.12, WOLF_Y + 0.02, 0.6];
        dur = 0.45;
        break;
      default:
        to = [b.x - 0.12, WOLF_Y + 0.05, 0.5];
        arc = 0.14;
        break;
    }
    this.shot = { cand: c, t: 0, dur, from: [px, py, s0], to, arc };
    this.shotArt = this.shotSprite.show(c.level.id);
    this.sfx.cue('whoosh');
    this.log.push({ t: this.time, type: 'whoosh' });
    this.line = `${c.spell.name}!`;
    this.inkPanel();
  }

  private land(s: Shot) {
    const b = this.battle!;
    this.shot = null;
    const sp = s.cand.spell;
    if (sp.damage > 0) b.hitNow(sp.damage);
    else b.cast(sp);
    if (sp.kind === 'ward') {
      this.sfx.cue('ward');
      this.log.push({ t: this.time, type: 'ward' });
      this.line = 'The Starfish Ward shines. The next bite will break on it.';
      this.inkPanel();
    } else if (sp.kind === 'web') {
      this.sfx.cue('ward');
      this.log.push({ t: this.time, type: 'ward' });
      this.line = 'The web holds it. The wolf is slow.';
      this.inkPanel();
    } else if (sp.kind === 'heal' && b.events[b.events.length - 1]?.type !== 'healed') {
      this.line = 'The deer blesses your flames. They are all alight.';
      this.inkPanel();
    }
  }

  private onEvent(e: BattleEvent) {
    const b = this.battle!;
    switch (e.type) {
      case 'hit':
        this.hitFlash = 1;
        this.sfx.cue('thump');
        this.log.push({ t: this.time, type: 'thump' });
        this.line = e.damage > 1 ? 'A heavy hit! The wolf staggers back.' : 'A hit! The wolf yelps.';
        this.inkPanel();
        break;
      case 'windup':
        this.sfx.cue('growl');
        this.log.push({ t: this.time, type: 'growl' });
        if (!this.warnedThisWindup) {
          this.warnedThisWindup = true;
          const ward = this.cands.find((c) => c.spell.kind === 'ward');
          this.line = ward && !b.warded ? `Its eyes burn red! Quick: the ${short(ward.level)} blocks.` : 'Its eyes burn red!';
          this.inkPanel();
        }
        break;
      case 'blocked':
        this.hitFlash = 0.7;
        this.sfx.cue('ward');
        this.log.push({ t: this.time, type: 'ward' });
        this.line = 'Blocked! The bite breaks on the light.';
        this.inkPanel();
        break;
      case 'hurt':
        this.hurtFlash = 1;
        this.sfx.cue('hurt');
        this.log.push({ t: this.time, type: 'hurt' });
        this.line = b.flames > 0 ? `The wolf bites out a flame. ${b.flames} left.` : '';
        this.inkPanel();
        break;
      case 'healed':
        this.sfx.cue('chime');
        this.log.push({ t: this.time, type: 'chime' });
        this.line = 'The deer lights a flame again.';
        this.inkPanel();
        break;
      case 'howl':
        this.sfx.cue('growl');
        this.log.push({ t: this.time, type: 'growl' });
        this.line = 'The wolf howls. It is angry now, and bites faster.';
        this.inkPanel();
        break;
      case 'won':
        this.endAt = this.time;
        this.sfx.setBattle(false);
        this.sfx.cue('win');
        this.log.push({ t: this.time, type: 'win' });
        this.log.push({ t: this.time, type: 'calm' });
        this.inkPanel();
        break;
      case 'lost':
        this.endAt = this.time;
        this.sfx.setBattle(false);
        this.log.push({ t: this.time, type: 'calm' });
        this.inkPanel();
        break;
    }
  }

  /** Title, one line of news, and the spellbook along the bottom. */
  private inkPanel() {
    const b = this.battle!;
    const c = this.theater.ink;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (b.state === 'won') {
      g.font = 'italic 600 64px Georgia, serif';
      g.fillText('The Ink Wolf is gone', 512, 96);
      g.font = '34px Georgia, serif';
      g.fillText('Your shadows chased it into the night.', 512, 150);
      g.fillText('The flames are safe.', 512, 196);
    } else if (b.state === 'lost') {
      g.font = 'italic 600 64px Georgia, serif';
      g.fillText('The flames are out', 512, 96);
      g.font = '34px Georgia, serif';
      g.fillText('The wolf comes again. Light them and try once more.', 512, 150);
    } else {
      g.font = 'italic 600 54px Georgia, serif';
      g.fillText('The Ink Wolf', 512, 72);
      g.font = '30px Georgia, serif';
      wrapText(this.line, 58).forEach((t, i) => g.fillText(t, 512, 116 + i * 36));
    }
    // the spellbook
    g.font = '21px Georgia, serif';
    g.globalAlpha = 0.72;
    const parts = this.cands.map((k) => `${short(k.level)}: ${describe(k.spell)}`);
    const half = Math.ceil(parts.length / 2);
    g.fillText(parts.slice(0, half).join('  ·  '), 540, 612);
    g.fillText(parts.slice(half).join('  ·  '), 540, 640);
    // name the bar along the bottom: it is the wolf's strength
    if (b.state === 'fight') {
      g.textAlign = 'right';
      g.fillText('Wolf', 184, 690);
    }
    g.globalAlpha = 1;
    this.theater.inkTex.needsUpdate = true;
  }
}

const short = (l: Level) => l.name.replace(/^The /, '');

function describe(s: Spell): string {
  switch (s.kind) {
    case 'ward':
      return 'block';
    case 'web':
      return 'slow';
    case 'heal':
      return 'relight';
    default:
      return s.damage > 1 ? 'hit 2' : 'hit';
  }
}

/** Write a creature's shadow into `out` from `slot0`, centered at x, y and scaled by s. */
function placeShadow(c: SpellCand, x: number, y: number, s: number, out: Float32Array, slot0: number) {
  const d = c.segs;
  const n = d.length / 8;
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    const w = (slot0 + i) * 8;
    if (d[o + 2] <= 0 || i % SEGS_PER_HAND === FOREARM_SLOT) {
      out[w + 2] = 0;
      continue;
    }
    out[w] = x + (d[o] - c.cx) * s;
    out[w + 1] = y + (d[o + 1] - c.cy) * s;
    out[w + 2] = d[o + 2] * s;
    out[w + 3] = d[o + 3];
    out[w + 4] = x + (d[o + 4] - c.cx) * s;
    out[w + 5] = y + (d[o + 5] - c.cy) * s;
    out[w + 6] = d[o + 6] * s;
    out[w + 7] = d[o + 7];
  }
}

const easeIn = (k: number) => k * k;

function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).trim().length > width) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
