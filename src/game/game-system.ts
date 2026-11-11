import { AdditiveBlending, Color, createSystem, Matrix4, MeshBasicMaterial, Vector3, VisibilityState, type WebGLRenderer } from '@iwsdk/core';
import { Sfx } from './audio.js';
import { dailyLevel, dayNumber } from './daily.js';
import { type Handedness, type HandPose, JOINT_COUNT, JOINT_NAMES, poseToJoints } from './hand-model.js';
import { LEVELS, type Level, type Motion } from './levels.js';
import {
  clearHand,
  GRID_H,
  GRID_W,
  gridToWall,
  Matcher,
  projectHand,
  projectPoint,
  rasterize,
  SegmentBuffer,
  shapeStats,
  SEGS_PER_HAND,
  WALL_H,
  WALL_W,
} from './silhouette.js';
import { FireflyPuzzle, PUZZLES, RainPuzzle } from './puzzles.js';
import { loadProgress, type Progress, saveProgress } from './storage.js';
import { HandViz } from './hand-viz.js';
import { SkinnedHands } from './skinned-hands.js';
import { Theater } from './theater.js';

type State = 'intro' | 'level' | 'wake' | 'book' | 'finale' | 'free' | 'puzzle';

const HOLD_TIME = 0.7;
const WAKE_TIME = 4.5;
const INTRO_AREA = 120;
const SIDES_LR = ['left', 'right'] as const;
const SIDES_RL = ['right', 'left'] as const;

interface DebugApi {
  setPoses(poses: HandPose[] | null): void;
  state(): { state: State; level: string; score: number; found: string[]; hands: number; puzzleCount: number; puzzleDone: boolean };
  press(id: string): void;
  reset(): void;
  /** Render the music offline and return it as base64 WAV, to check it without a headset. */
  renderMusic(seconds: number, cues?: { t: number; type: string }[]): Promise<string>;
  /** Desktop only: tilt the view down (negative degrees) to show the button tray. */
  setCameraPitch(deg: number): void;
  /** The poses of a story creature, by id, to test free play. */
  posesFor(id: string): HandPose[];
  /** Current target poses, shifted in position (meters) to test the matcher. */
  targetPoses(dx: number, dy: number): HandPose[];
}

declare global {
  interface Window {
    __shadowfolk?: DebugApi;
  }
}

export class GameSystem extends createSystem({}) {
  private theater!: Theater;
  private handViz = new HandViz();
  private skinned: SkinnedHands | null = null;
  /** Faint golden hand that shows the pose, placed where the player's hand should go. */
  private guide = new HandViz(
    new MeshBasicMaterial({
      color: new Color(1.0, 0.6, 0.16),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
    }),
  );
  private guideAlpha = 0;
  /** The target shadow only needs a redraw when the level changes. */
  private targetDirty = true;
  /** Gentle mode: one matcher per hand of a two-hand shape, so one hand is enough. */
  private halfMatchers: Matcher[] = [];
  private halfSegs = new SegmentBuffer();
  private activeMatcher: Matcher | null = null;
  private stuckShown = false;
  /** Chapter three: the running shadow puzzle. */
  private rain: RainPuzzle | null = null;
  private flies: FireflyPuzzle | null = null;
  private puzzleMask = new Uint8Array(GRID_W * GRID_H);
  private puzzleCount = -1;
  private puzzleDoneAt = -1;
  /** Free play: one matcher per creature the player has found. */
  private freeCands: { level: Level; m: Matcher }[] = [];
  private freePlay = false;
  private freeBest = -1;
  private freeShown = -1;
  private targetJoints: Float32Array[] = [];
  private mirrorJoints: Float32Array[] = [];
  private guideHands: (Float32Array | null)[] = [null, null];
  /** The guide, drawn with the real hand model, and buffers for its moved joints. */
  private guideSkin = new SkinnedHands(
    new MeshBasicMaterial({
      color: new Color(1.0, 0.6, 0.16),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
    }),
    'Guide Hands (model)',
  );
  private guideBuf = [new Float32Array(JOINT_COUNT * 3), new Float32Array(JOINT_COUNT * 3)];
  private guideSide: (Handedness | null)[] = [null, null];
  private eyeBase: [number, number] | null = null;
  private eyeTmp: [number, number] = [0, 0];
  private vizHands: (Float32Array | null)[] = [null, null];
  private sfx = new Sfx();
  private progress!: Progress;

  private live = new SegmentBuffer();
  private creature = new SegmentBuffer();
  private targetSegs = new SegmentBuffer();
  private mask = new Uint8Array(GRID_W * GRID_H);
  private tmask = new Uint8Array(GRID_W * GRID_H);
  private matcher = new Matcher();

  private joints = { left: new Float32Array(JOINT_COUNT * 3), right: new Float32Array(JOINT_COUNT * 3) };
  private present = { left: false, right: false };
  private poseBuf = new Float32Array(16 * JOINT_COUNT);
  private jointSpaces = new WeakMap<XRHand, XRJointSpace[]>();
  private m4 = new Matrix4();
  private inv = new Matrix4();
  private v = new Vector3();
  private v2 = new Vector3();

  private state: State = 'intro';
  private stateTime = 0;
  private level: Level = LEVELS[0];
  private score = 0;
  private hold = 0;
  private introHold = 0;
  private anchored = false;
  private anchorFrames = 0;
  private paused = false;
  private simPoses: HandPose[] | null = null;
  private demo = false;
  private wakeFrom = { x: 0, y: 0, s: 1, mirror: false };
  private isDaily = false;

  init(): void {
    this.progress = loadProgress();
    this.theater = new Theater();
    this.world.createTransformEntity(this.theater.root, { persistent: true });
    this.theater.root.add(this.handViz.root, this.guide.root, this.guideSkin.root);
    // real hand models only where we draw simulated hands (desktop demo and capture)
    const params = new URLSearchParams(location.search);
    if (params.has('demo') || params.has('capture')) {
      this.skinned = new SkinnedHands();
      this.theater.root.add(this.skinned.root);
    }
    this.demo = new URLSearchParams(location.search).has('demo');

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((vs) => {
        this.paused = vs === VisibilityState.VisibleBlurred;
        if (this.paused) this.sfx.suspend();
        else this.sfx.resume();
        // Re-anchor the room to the head on every change between desktop and XR.
        const immersive = vs !== VisibilityState.NonImmersive;
        if (immersive !== this.wasImmersive) {
          this.anchored = false;
          this.anchorFrames = 0;
          this.wasImmersive = immersive;
        }
        if (vs === VisibilityState.Visible) this.sfx.start();
      }),
    );

    this.installDomUi();
    this.installDebug();
    this.applyContrast();
    this.enter('intro');
  }

  // --------------------------------------------------------------- states

  private enter(s: State) {
    this.state = s;
    this.stateTime = 0;
    this.hold = 0;
    const u = this.theater.wallMat.uniforms;
    switch (s) {
      case 'intro':
        this.introDone = false;
        u.uTargetAlpha.value = 0;
        u.uMeter.value = 0;
        if (this.progress.found.length > 0)
          this.ink(['Welcome back'], ['Lift a hand into the lamplight to go on.'], `Found ${this.progress.found.length}  ·  streak ${this.progress.streak}`);
        else this.ink(['Shadowfolk'], ['Sit back. Lift a hand into the lamplight.'], 'The shadows on this paper are asleep.');
        break;
      case 'level':
        this.freePlay = false;
        this.loadTarget();
        u.uTargetMode.value = 0;
        u.uLiveAlpha.value = 1;
        u.uMeter.value = 1;
        u.uThreshold.value = this.threshold();
        this.inkLevel(false);
        break;
      case 'wake':
        u.uTargetMode.value = 1;
        u.uMeter.value = 0;
        this.sfx.chime();
        this.sfx.setCloseness(0, 1);
        this.ink([this.level.name], wrap(this.level.wake, 52), '');
        this.recordFound();
        break;
      case 'book':
        u.uTargetAlpha.value = 0;
        u.uMeter.value = 0;
        this.sfx.setCloseness(0, 1);
        this.drawBook();
        break;
      case 'finale':
        u.uTargetAlpha.value = 0;
        u.uMeter.value = 0;
        this.freePlay = false;
        this.ink(
          ['Every shadow is awake'],
          this.progress.dailyDay === dayNumber()
            ? ['Come back tomorrow for a new shadow.', 'Press Free play to make any shadow you know.']
            : ['A new shadow wakes each day.', 'Press Daily to meet it.'],
          `Found ${this.progress.found.length}  ·  streak ${this.progress.streak}`,
        );
        break;
      case 'puzzle': {
        const info = PUZZLES[this.progress.puzzle];
        u.uTargetAlpha.value = 0;
        u.uMeter.value = 0;
        u.uLiveAlpha.value = 1;
        this.rain = info.id === 'rain' ? new RainPuzzle(this.progress.gentle) : null;
        this.flies = info.id === 'fireflies' ? new FireflyPuzzle(this.progress.gentle) : null;
        u.uDotKind.value = this.flies ? 1 : 0;
        this.puzzleCount = -1;
        this.puzzleDoneAt = -1;
        this.inkPuzzle();
        break;
      }
      case 'free':
        this.freePlay = true;
        this.isDaily = false;
        this.buildFreeCands();
        u.uTargetAlpha.value = 0;
        u.uMeter.value = 1;
        u.uLiveAlpha.value = 1;
        this.freeBest = -1;
        this.freeShown = -1;
        this.inkFree();
        break;
    }
    this.updateLabels();
  }

  private progressIndex() {
    return Math.min(this.progress.level, LEVELS.length - 1);
  }

  private threshold() {
    return this.level.threshold - (this.progress.gentle ? 0.1 : 0);
  }

  private startNextLevel() {
    if (this.progress.level < LEVELS.length) {
      this.isDaily = false;
      this.level = LEVELS[this.progress.level];
      this.enter('level');
    } else if ((this.progress.puzzle ?? 0) < PUZZLES.length) {
      this.isDaily = false;
      this.enter('puzzle');
    } else if (this.progress.dailyDay !== dayNumber()) {
      this.startDaily();
    } else {
      this.enter('finale');
    }
  }

  private startDaily() {
    this.isDaily = true;
    this.level = dailyLevel(dayNumber());
    this.enter('level');
  }

  private recordFound() {
    const p = this.progress;
    if (!p.found.includes(this.level.id)) p.found.push(this.level.id);
    if (this.isDaily) {
      const today = dayNumber();
      p.streak = p.dailyDay === today - 1 ? p.streak + 1 : p.dailyDay === today ? p.streak : 1;
      p.dailyDay = today;
    } else if (LEVELS[p.level]?.id === this.level.id) {
      p.level++;
    }
    saveProgress(p);
  }

  private loadTarget() {
    this.targetSegs.clear();
    this.targetJoints = this.level.hands.map((h) => poseToJoints(h));
    this.mirrorJoints = this.level.hands.map((h) => poseToJoints(mirrorPose(h)));
    this.targetJoints.forEach((j, k) => projectHand(j, this.targetSegs, k * SEGS_PER_HAND));
    this.targetDirty = true;
    this.stuckShown = false;
    this.halfMatchers = [];
    if (this.targetJoints.length === 2) {
      for (const j of this.targetJoints) {
        this.halfSegs.clear();
        projectHand(j, this.halfSegs, 0);
        rasterize(this.halfSegs, this.tmask);
        const hm = new Matcher();
        hm.setTarget(this.tmask);
        this.halfMatchers.push(hm);
      }
    }
    this.guideAlpha = 0;
    this.eyeBase = null;
    const eye = this.level.eye;
    const ej = eye ? this.targetJoints[eye.hand ?? 0] : undefined;
    if (eye && ej) {
      const p = projectPoint(ej[eye.joint * 3], ej[eye.joint * 3 + 1], ej[eye.joint * 3 + 2], this.eyeTmp);
      if (p) this.eyeBase = [p[0] + (eye.dx ?? 0), p[1] + (eye.dy ?? 0)];
    }
    rasterize(this.targetSegs, this.tmask);
    this.matcher.setTarget(this.tmask);
    this.theater.wallMat.uniforms.uTargetAlpha.value = 0;
  }

  // ---------------------------------------------------------------- input

  private press(id: string) {
    this.sfx.tap();
    if (id === 'gentle') {
      this.progress.gentle = !this.progress.gentle;
      saveProgress(this.progress);
      this.applyContrast();
      if (this.state === 'level') {
        this.theater.wallMat.uniforms.uThreshold.value = this.threshold();
        this.inkLevel(this.stuckShown);
      }
      this.updateLabels();
      return;
    }
    if (id === 'book') {
      if (this.state === 'book') this.resumeFromBook();
      else this.enter('book');
      return;
    }
    if (id === 'next') {
      if (this.state === 'intro') this.startNextLevel();
      else if (this.state === 'book') this.resumeFromBook();
      else if (this.state === 'finale') {
        if (this.progress.dailyDay === dayNumber()) this.enter('free');
        else this.startDaily();
      } else if (this.state === 'free') this.enter('finale');
      else if (this.state === 'puzzle') {
        this.progress.puzzle = (this.progress.puzzle ?? 0) + 1;
        saveProgress(this.progress);
        this.startNextLevel();
      }
      else if (this.state === 'level') {
        // skip: move on without marking the shape found
        if (!this.isDaily && this.progress.level < LEVELS.length) {
          this.progress.level++;
          saveProgress(this.progress);
        }
        this.startNextLevel();
      } else if (this.state === 'wake') {
        if (this.freePlay) this.enter('free');
        else this.startNextLevel();
      }
    }
  }

  private resumeFromBook() {
    if (this.progress.found.length === 0 && this.progress.level === 0) this.enter('intro');
    else this.startNextLevel();
  }

  private updateLabels() {
    const next =
      this.state === 'intro'
        ? 'Begin'
        : this.state === 'book'
          ? 'Back'
          : this.state === 'finale'
            ? this.progress.dailyDay === dayNumber()
              ? 'Free play'
              : 'Daily'
            : this.state === 'free'
              ? 'Done'
              : this.state === 'wake'
                ? 'Next'
                : 'Skip';
    this.theater.drawLabels({
      book: this.state === 'book' ? 'Close' : 'Book',
      gentle: this.progress.gentle ? 'Gentle: on' : 'Gentle: off',
      next,
    });
  }

  private applyContrast() {
    // Gentle mode also raises contrast, which helps low vision.
    this.theater.wallMat.uniforms.uContrast.value = this.progress.gentle ? 1 : 0;
  }

  private readHands() {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.session;
    this.present.left = false;
    this.present.right = false;
    if (this.simPoses || this.demo) {
      const poses = this.simPoses ?? this.demoPoses();
      for (const p of poses) {
        poseToJoints(p, this.joints[p.hand]);
        this.present[p.hand] = true;
      }
      return;
    }
    if (!frame || !ref || !session) return;
    // XR reference space -> world (player rig) -> theater space
    this.player.updateWorldMatrix(true, false);
    this.theater.root.updateWorldMatrix(true, false);
    this.inv.copy(this.theater.root.matrixWorld).invert().multiply(this.player.matrixWorld);
    for (const src of session.inputSources) {
      const hand = src.hand;
      if (!hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      let spaces = this.jointSpaces.get(hand);
      if (!spaces) {
        spaces = JOINT_NAMES.map((n) => hand.get(n as XRHandJoint)!) as XRJointSpace[];
        this.jointSpaces.set(hand, spaces);
      }
      let ok = false;
      const f = frame as XRFrame & {
        fillPoses?: (spaces: XRSpace[], base: XRSpace, out: Float32Array) => boolean;
      };
      if (typeof f.fillPoses === 'function') {
        ok = f.fillPoses(spaces, ref, this.poseBuf);
      } else {
        ok = true;
        for (let j = 0; j < JOINT_COUNT; j++) {
          const pose = frame.getJointPose?.(spaces[j], ref);
          if (!pose) {
            ok = false;
            break;
          }
          this.poseBuf.set(pose.transform.matrix, j * 16);
        }
      }
      if (!ok) continue;
      const out = this.joints[src.handedness];
      for (let j = 0; j < JOINT_COUNT; j++) {
        const o = j * 16;
        this.v.set(this.poseBuf[o + 12], this.poseBuf[o + 13], this.poseBuf[o + 14]).applyMatrix4(this.inv);
        out[j * 3] = this.v.x;
        out[j * 3 + 1] = this.v.y;
        out[j * 3 + 2] = this.v.z;
      }
      this.present[src.handedness] = true;
    }
  }

  /** Desktop demo: hands drift in, then settle into the target shape. */
  private demoPoses(): HandPose[] {
    const t = this.stateTime;
    const base = this.state === 'intro' ? LEVELS[0].hands : this.level.hands;
    const k = this.state === 'level' ? Math.max(0, 1 - t / 3.5) : this.state === 'intro' ? 0.4 : 0;
    return base.map((h) => ({
      ...h,
      pos: [h.pos[0] + Math.sin(t * 0.9) * 0.05 * k + 0.03, h.pos[1] + Math.cos(t * 0.7) * 0.03 * k, h.pos[2]],
      rot: [(h.rot?.[0] ?? 0) + 25 * k * Math.sin(t * 1.3), h.rot?.[1] ?? 0, (h.rot?.[2] ?? 0) + 30 * k],
    }));
  }

  private checkButtons(dt: number) {
    for (const b of this.theater.buttons) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      let touching = false;
      for (const side of SIDES_LR) {
        if (!this.present[side]) continue;
        const j = this.joints[side];
        const tx = j[9 * 3], ty = j[9 * 3 + 1], tz = j[9 * 3 + 2]; // index tip
        const dxz = Math.hypot(tx - b.x, tz - b.z);
        if (dxz < 0.032 && ty < b.y + 0.012 && ty > b.y - 0.04) touching = true;
      }
      if (touching && !b.pressed && b.cooldown === 0) {
        b.pressed = true;
        b.cooldown = 0.6;
        this.theater.flash(b.id, true);
        this.press(b.id);
      } else if (!touching && b.pressed) {
        b.pressed = false;
        this.theater.flash(b.id, false);
      }
    }
  }

  // --------------------------------------------------------------- anchor

  private anchor() {
    if (this.anchored) return;
    const inXR = !!this.world.session;
    if (inXR) {
      // wait a few frames for a stable head pose
      if (++this.anchorFrames < 8) return;
      this.player.head.getWorldPosition(this.v);
      this.player.head.getWorldDirection(this.v2);
    } else {
      this.world.camera.getWorldPosition(this.v);
      this.world.camera.getWorldDirection(this.v2);
    }
    // getWorldDirection on a camera returns its -Z look direction; on a Group it returns +Z.
    const yaw = inXR ? Math.atan2(this.v2.x, this.v2.z) : Math.atan2(-this.v2.x, -this.v2.z);
    this.theater.root.position.copy(this.v);
    this.theater.root.rotation.set(0, yaw, 0);
    this.anchored = true;
    if (inXR) {
      const ref = this.world.xrReferenceSpace;
      ref?.addEventListener?.('reset', () => {
        this.anchored = false;
        this.anchorFrames = 0;
      });
    }
  }

  // --------------------------------------------------------------- update

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    this.anchor();
    const u = this.theater.wallMat.uniforms;
    u.uTime.value = time;
    if (this.paused) return;
    this.stateTime += dt;

    this.readHands();
    this.checkButtons(dt);
    const simulated = !!this.simPoses || this.demo;
    const showR = simulated && this.present.right;
    const showL = simulated && this.present.left;
    if (this.skinned?.loaded) {
      this.skinned.update(showL ? this.joints.left : null, showR ? this.joints.right : null);
      this.vizHands[0] = null;
      this.vizHands[1] = null;
    } else {
      this.vizHands[0] = showR ? this.joints.right : null;
      this.vizHands[1] = showL ? this.joints.left : null;
    }
    this.handViz.update(this.vizHands);

    // live shadow from tracked hands
    this.live.clear();
    for (const side of SIDES_RL) {
      const slot = side === 'right' ? 0 : SEGS_PER_HAND;
      if (this.present[side]) projectHand(this.joints[side], this.live, slot, { forearm: true, shoulderX: side === 'right' ? 0.18 : -0.18 });
      else clearHand(this.live, slot);
    }
    const renderer = this.world.renderer as WebGLRenderer;
    this.theater.live.render(renderer, this.live);

    const area = this.present.left || this.present.right ? rasterize(this.live, this.mask) : 0;

    this.updateGuide(dt);
    u.uEye.value.w = 0;
    if (this.state !== 'puzzle') u.uDotCount.value = 0;

    switch (this.state) {
      case 'intro': {
        if (this.introDone) {
          if (this.stateTime > 2.2) this.startNextLevel();
          break;
        }
        this.introHold = area > INTRO_AREA ? this.introHold + dt : Math.max(0, this.introHold - dt);
        if (this.introHold > 1.2) {
          this.introHold = 0;
          this.introDone = true;
          this.stateTime = 0;
          this.sfx.chime();
          this.ink(['Shadowfolk'], ['Good. The paper knows your hands now.'], '');
        }
        break;
      }
      case 'level': {
        u.uTargetAlpha.value = Math.min(1, this.stateTime / 1.2);
        if (this.targetDirty) {
          this.theater.target.render(renderer, this.targetSegs);
          this.targetDirty = false;
        }
        let raw = 0;
        let m = this.matcher;
        if (area > 0) {
          if (this.oneHandOk()) {
            // Gentle mode with one hand: either half of the shape counts
            const st = shapeStats(this.mask);
            for (const hm of this.halfMatchers) {
              const sc = hm.scoreWithStats(this.mask, st, true);
              if (sc > raw) {
                raw = sc;
                m = hm;
              }
            }
          } else raw = this.matcher.score(this.mask, true);
        }
        this.activeMatcher = m;
        this.score += (raw - this.score) * Math.min(1, dt * 8);
        u.uScore.value = this.score;
        const thr = this.threshold();
        this.sfx.setCloseness(this.score, thr);
        this.hold = raw >= thr ? this.hold + dt : Math.max(0, this.hold - dt * 2);
        u.uHold.value = Math.min(1, this.hold / HOLD_TIME);
        if (this.hold >= HOLD_TIME) {
          const am = this.activeMatcher ?? this.matcher;
          const st = am.lastStats;
          const ts = am.targetStats;
          const [px, py] = gridToWall(st.cx, st.cy);
          const [tx, ty] = gridToWall(ts.cx, ts.cy);
          this.wakeFrom = { x: px - tx, y: py - ty, s: Math.sqrt(st.area / ts.area), mirror: am.lastMirrored };
          this.wakeCenter = [tx, ty];
          this.enter('wake');
        }
        break;
      }
      case 'wake': {
        const k = Math.min(1, this.stateTime / WAKE_TIME);
        u.uLiveAlpha.value = Math.max(0.15, 1 - this.stateTime * 1.5);
        u.uTargetAlpha.value = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
        const eyeOut = animateCreature(
          this.targetSegs, this.creature, this.level.motion, this.stateTime, this.wakeFrom, this.wakeCenter, this.eyeBase, this.eyeTmp,
        );
        if (eyeOut) {
          // the eye opens after the creature starts to move, and blinks twice
          const t = this.stateTime;
          const open = Math.min(1, Math.max(0, (t - 0.35) / 0.4));
          const blink = (t > 1.7 && t < 1.82) || (t > 3.1 && t < 3.22) ? 0 : 1;
          u.uEye.value.set(eyeOut[0], eyeOut[1], 0.017 * this.wakeFrom.s, open * blink * u.uTargetAlpha.value);
        }
        this.theater.target.render(renderer, this.creature);
        if (this.stateTime > WAKE_TIME + 0.4) {
          u.uLiveAlpha.value = 1;
          if (this.freePlay) this.enter('free');
          else this.startNextLevel();
        }
        break;
      }
      case 'free':
        this.updateFree(dt, area);
        break;
      case 'puzzle':
        this.updatePuzzle(dt);
        break;
      default:
        break;
    }
  }

  /** Chapter three: step the puzzle with the full shadow (forearm included) as solid ground. */
  private updatePuzzle(dt: number) {
    const u = this.theater.wallMat.uniforms;
    if (this.present.left || this.present.right) rasterize(this.live, this.puzzleMask, false);
    else this.puzzleMask.fill(0);
    const p = this.rain ?? this.flies;
    if (!p) return;
    p.step(dt, this.puzzleMask);
    // hand the dots to the wall shader: x, y, radius, brightness
    const dots = this.rain ? this.rain.drops : this.flies!.flies;
    const arr = u.uDots.value as Float32Array;
    let n = 0;
    for (const d of dots) {
      if (!d.alive || n >= 32) continue;
      const glow = this.flies ? 0.75 + 0.25 * Math.sin(d.phase * 2.3) : 1;
      arr[n * 4] = d.x;
      arr[n * 4 + 1] = d.y;
      arr[n * 4 + 2] = this.flies ? 0.013 : 0.0105;
      arr[n * 4 + 3] = glow;
      n++;
    }
    u.uDotCount.value = n;
    const count = this.rain ? this.rain.collected : this.flies!.caught;
    if (count !== this.puzzleCount) {
      if (count > this.puzzleCount && this.puzzleCount >= 0) this.sfx.tap();
      this.puzzleCount = count;
      this.inkPuzzle();
    }
    if (this.puzzleDoneAt < 0 && p.solved) {
      this.puzzleDoneAt = this.stateTime;
      this.sfx.chime();
      this.inkPuzzle();
    }
    if (this.puzzleDoneAt >= 0 && this.stateTime - this.puzzleDoneAt > 4) {
      this.progress.puzzle = (this.progress.puzzle ?? 0) + 1;
      saveProgress(this.progress);
      this.startNextLevel();
    }
  }

  private inkPuzzle() {
    const info = PUZZLES[this.progress.puzzle] ?? PUZZLES[0];
    const done = this.puzzleDoneAt >= 0;
    const goal = this.rain ? this.rain.goal : this.flies?.goal ?? 0;
    const count = Math.max(0, this.puzzleCount);
    const what = this.rain ? 'drops in the cup' : 'fireflies in the jar';
    this.ink(
      [info.name],
      wrap(done ? info.done : info.hint, 52),
      `Puzzle ${this.progress.puzzle + 1} of ${PUZZLES.length}  ·  ${Math.min(count, goal)} of ${goal} ${what}`,
    );
    // ink the props onto the paper
    const g = this.theater.ink.getContext('2d')!;
    const X = (x: number) => ((x + WALL_W / 2) / WALL_W) * 1024;
    const Y = (y: number) => ((WALL_H / 2 - y) / WALL_H) * 704;
    const S = 1024 / WALL_W;
    g.save();
    g.strokeStyle = '#000';
    g.fillStyle = '#000';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (this.rain) {
      const c = this.rain.cloud;
      g.globalAlpha = 0.55;
      for (const [dx, dy, r] of [[-0.07, 0, 0.04], [0, 0.02, 0.055], [0.07, 0, 0.042], [0.03, -0.015, 0.04], [-0.035, -0.015, 0.038]]) {
        g.beginPath();
        g.arc(X(c.x + dx), Y(c.y + 0.04 + dy), r * S, 0, Math.PI * 2);
        g.fill();
      }
      const k = this.rain.cup;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.moveTo(X(k.x - k.w / 2), Y(k.y + k.h / 2));
      g.lineTo(X(k.x - k.w / 2 + 0.015), Y(k.y - k.h / 2));
      g.lineTo(X(k.x + k.w / 2 - 0.015), Y(k.y - k.h / 2));
      g.lineTo(X(k.x + k.w / 2), Y(k.y + k.h / 2));
      g.stroke();
      // water level
      const f = Math.min(1, count / goal);
      if (f > 0) {
        g.globalAlpha = 0.35;
        const top = k.y - k.h / 2 + k.h * 0.85 * f;
        const bottom = k.y - k.h / 2;
        g.fillRect(X(k.x - k.w / 2 + 0.018), Y(top), (k.w - 0.036) * S, Y(bottom) - Y(top));
      }
    }
    if (this.flies) {
      const j = this.flies.jar;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.ellipse(X(j.x), Y(j.y), j.r * S, j.r * S * 1.15, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(X(j.x - j.r * 0.6), Y(j.y + j.r * 1.15));
      g.lineTo(X(j.x - j.r * 0.6), Y(j.y + j.r * 1.4));
      g.lineTo(X(j.x + j.r * 0.6), Y(j.y + j.r * 1.4));
      g.lineTo(X(j.x + j.r * 0.6), Y(j.y + j.r * 1.15));
      g.stroke();
    }
    g.restore();
    this.theater.inkTex.needsUpdate = true;
  }

  private buildFreeCands() {
    const found = new Set(this.progress.found);
    const levels = LEVELS.filter((l) => found.has(l.id));
    const today = dailyLevel(dayNumber());
    if (found.has(today.id)) levels.push(today);
    const buf = new SegmentBuffer();
    const m = new Uint8Array(GRID_W * GRID_H);
    this.freeCands = levels.map((level) => {
      buf.clear();
      level.hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
      rasterize(buf, m);
      const matcher = new Matcher();
      matcher.setTarget(m);
      return { level, m: matcher };
    });
  }

  /** Free play: score the shadow against every found creature and wake the best one. */
  private updateFree(dt: number, area: number) {
    const u = this.theater.wallMat.uniforms;
    let best = -1;
    let bestScore = 0;
    let bestRatio = 0;
    if (area > 0 && this.freeCands.length) {
      const st = shapeStats(this.mask);
      this.freeCands.forEach((c, i) => {
        const sc = c.m.scoreWithStats(this.mask, st, true);
        const thr = c.level.threshold - (this.progress.gentle ? 0.1 : 0);
        // rank by how close each creature is to its own threshold
        if (sc / thr > bestRatio) {
          bestRatio = sc / thr;
          bestScore = sc;
          best = i;
        }
      });
    }
    const thr = best >= 0 ? this.freeCands[best].level.threshold - (this.progress.gentle ? 0.1 : 0) : 1;
    this.score += (bestScore - this.score) * Math.min(1, dt * 8);
    u.uScore.value = this.score;
    if (best >= 0) u.uThreshold.value = thr;
    this.sfx.setCloseness(this.score, thr);
    // the same creature must stay on top for the whole hold
    if (best !== this.freeBest) this.hold = 0;
    this.freeBest = best;
    this.hold = best >= 0 && bestScore >= thr ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    u.uHold.value = Math.min(1, this.hold / HOLD_TIME);
    // name the creature on the paper once the shape is close to one
    const shown = best >= 0 && bestScore >= thr - 0.08 ? best : -1;
    if (shown !== this.freeShown) {
      this.freeShown = shown;
      this.inkFree();
    }
    if (best >= 0 && this.hold >= HOLD_TIME) {
      const c = this.freeCands[best];
      this.level = c.level;
      this.loadTarget();
      const st = c.m.lastStats;
      const ts = c.m.targetStats;
      const [px, py] = gridToWall(st.cx, st.cy);
      const [tx, ty] = gridToWall(ts.cx, ts.cy);
      this.wakeFrom = { x: px - tx, y: py - ty, s: Math.sqrt(st.area / ts.area), mirror: c.m.lastMirrored };
      this.wakeCenter = [tx, ty];
      this.enter('wake');
    }
  }

  private inkFree() {
    const name = this.freeShown >= 0 ? this.freeCands[this.freeShown].level.name : '';
    this.ink(
      ['Free play'],
      ['Make any shadow from your Book.', 'Hold it still, and it wakes.'],
      name ? `${name}?` : `${this.freeCands.length} shadows you know`,
    );
  }

  private wakeCenter: [number, number] = [0, 0];

  /** Show the guide hand when the player seems stuck; hide it as soon as they are close. */
  private updateGuide(dt: number) {
    let want = 0;
    if (this.state === 'level') {
      const thr = this.threshold();
      const wait = this.progress.gentle ? 1.5 : 6;
      if (this.stateTime > wait && this.hold === 0 && this.score < thr - 0.04) want = 1;
    }
    this.guideAlpha += (want - this.guideAlpha) * Math.min(1, dt * (want ? 1.2 : 4));
    const show = this.guideAlpha > 0.01 && this.targetJoints.length > 0;
    // a lone left hand on a right-hand shape: mirror the guide for that hand
    const mirror = this.level.hands.length === 1 && this.level.hands[0].hand === 'right' && this.present.left && !this.present.right;
    const src = mirror ? this.mirrorJoints : this.targetJoints;
    this.guideHands[0] = null;
    this.guideHands[1] = null;
    this.guideSide[0] = null;
    this.guideSide[1] = null;
    if (show) {
      // which target hands to draw, and which real hand each one belongs to
      let n = 0;
      for (let k = 0; k < src.length; k++) {
        const side: Handedness = mirror ? (this.level.hands[k].hand === 'right' ? 'left' : 'right') : this.level.hands[k].hand;
        if (this.oneHandOk() && !this.present[side]) continue;
        this.guideHands[n] = src[k];
        this.guideSide[n] = side;
        n++;
      }
      // follow the player's hands: move the guide so its wrists sit on the
      // real wrists, so only the pose and the turn of the hand are left to match
      let ox = 0, oy = 0, oz = 0, m = 0;
      for (let k = 0; k < n; k++) {
        const side = this.guideSide[k]!;
        if (!this.present[side]) continue;
        const real = this.joints[side];
        const g = this.guideHands[k]!;
        ox += real[0] - g[0];
        oy += real[1] - g[1];
        oz += real[2] - g[2];
        m++;
      }
      if (m) {
        ox /= m; oy /= m; oz /= m;
      }
      for (let k = 0; k < n; k++) {
        const g = this.guideHands[k]!;
        const out = this.guideBuf[k];
        for (let i = 0; i < JOINT_COUNT; i++) {
          out[i * 3] = g[i * 3] + ox;
          out[i * 3 + 1] = g[i * 3 + 1] + oy;
          out[i * 3 + 2] = g[i * 3 + 2] + oz;
        }
        this.guideHands[k] = out;
      }
    }
    const opacity = 0.55 * this.guideAlpha;
    if (this.guideSkin.loaded) {
      let l: Float32Array | null = null, r: Float32Array | null = null;
      for (let k = 0; k < 2; k++) {
        if (this.guideSide[k] === 'left') l = this.guideHands[k];
        if (this.guideSide[k] === 'right') r = this.guideHands[k];
      }
      this.guideSkin.update(l, r);
      this.guideSkin.setOpacity(opacity);
      this.guideHands[0] = null;
      this.guideHands[1] = null;
    }
    this.guide.update(this.guideHands);
    this.guide.material.opacity = opacity;
    // once the guide is fully up, point a stuck player at the tray
    if (this.state === 'level' && !this.stuckShown && this.guideAlpha > 0.9) {
      this.stuckShown = true;
      this.inkLevel(true);
    }
  }
  private introDone = false;
  private wasImmersive = false;

  /** Gentle mode accepts one hand on a two-hand shape. */
  private oneHandOk() {
    return this.progress.gentle && this.halfMatchers.length === 2 && this.present.left !== this.present.right;
  }

  private inkLevel(stuck: boolean) {
    const twoHands = this.level.hands.length === 2;
    const hint = this.level.hint + (twoHands && this.progress.gentle ? ' Gentle mode: one hand is enough.' : '');
    const where = this.isDaily ? `Daily shadow  ·  streak ${this.progress.streak}` : `Shadow ${this.progressIndex() + 1} of ${LEVELS.length}`;
    let foot = where;
    if (stuck) foot = 'Stuck? Look down: poke Gentle or Skip on the tray.';
    else if (!this.isDaily && this.progress.level === 0) foot = `${where}  ·  Look down for the tray: Book, Gentle, Skip`;
    this.ink([this.level.name], wrap(hint, 52), foot);
  }

  // ---------------------------------------------------------------- ink

  private ink(title: string[], body: string[], foot: string) {
    const c = this.theater.ink;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = 'italic 600 64px Georgia, serif';
    title.forEach((t, i) => g.fillText(t, 512, 92 + i * 70));
    g.font = '36px Georgia, serif';
    body.forEach((t, i) => g.fillText(t, 512, 150 + title.length * 20 + i * 44));
    g.font = '26px Georgia, serif';
    g.globalAlpha = 0.7;
    if (foot) g.fillText(foot, 512, 640);
    g.globalAlpha = 1;
    this.theater.inkTex.needsUpdate = true;
  }

  private drawBook() {
    const c = this.theater.ink;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.font = 'italic 600 60px Georgia, serif';
    g.fillText('Shadow Book', 512, 84);
    const buf = new SegmentBuffer();
    const m = new Uint8Array(GRID_W * GRID_H);
    const all: Level[] = [...LEVELS];
    const today = dailyLevel(dayNumber());
    if (this.progress.found.includes(today.id)) all.push(today);
    const cols = all.length > 9 ? 4 : 3;
    const img = g.createImageData(GRID_W, GRID_H);
    const off = document.createElement('canvas');
    off.width = GRID_W;
    off.height = GRID_H;
    const og = off.getContext('2d')!;
    const shown = all.slice(0, 12);
    // fit every row between the title and the footer
    const rows = Math.ceil(shown.length / cols);
    const ch = Math.min(230, 520 / rows);
    const colW = cols === 4 ? 240 : 310;
    const cw = Math.min(cols === 4 ? 220 : 280, ((ch - 40) * GRID_W) / GRID_H);
    shown.forEach((lv, i) => {
      const x0 = 512 + ((i % cols) - (cols - 1) / 2) * colW - cw / 2;
      const y0 = 112 + Math.floor(i / cols) * ch;
      const found = this.progress.found.includes(lv.id);
      buf.clear();
      lv.hands.forEach((h, k) => projectHand(poseToJoints(h), buf, k * SEGS_PER_HAND));
      rasterize(buf, m);
      for (let y = 0; y < GRID_H; y++)
        for (let x = 0; x < GRID_W; x++) {
          const o = ((GRID_H - 1 - y) * GRID_W + x) * 4;
          const on = m[y * GRID_W + x];
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
          img.data[o + 3] = on ? (found ? 235 : 40) : 0;
        }
      og.clearRect(0, 0, GRID_W, GRID_H);
      og.putImageData(img, 0, 0);
      g.drawImage(off, x0, y0, cw, (cw * GRID_H) / GRID_W);
      g.font = `${Math.round(Math.min(28, ch / 7))}px Georgia, serif`;
      g.globalAlpha = found ? 0.9 : 0.4;
      g.fillText(found ? lv.name : '? ? ?', x0 + cw / 2, y0 + (cw * GRID_H) / GRID_W + Math.min(30, ch / 6));
      g.globalAlpha = 1;
    });
    g.font = '26px Georgia, serif';
    g.globalAlpha = 0.7;
    g.fillText(`Found ${this.progress.found.length}  ·  daily streak ${this.progress.streak}`, 512, 680);
    g.globalAlpha = 1;
    this.theater.inkTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ dom + debug

  private installDomUi() {
    const btn = document.createElement('button');
    btn.textContent = 'Enter Shadowfolk';
    btn.setAttribute('aria-label', 'Enter Shadowfolk in VR');
    Object.assign(btn.style, {
      position: 'fixed', left: '50%', bottom: '32px', transform: 'translateX(-50%)', zIndex: '10',
      padding: '14px 28px', font: '600 18px Georgia, serif', color: '#2a160b', background: '#f2d9a6',
      border: '2px solid #6b3f1f', borderRadius: '999px', cursor: 'pointer',
    });
    btn.addEventListener('click', () => {
      this.sfx.start();
      if (this.world.xrEnabled) this.world.launchXR();
    });
    if (new URLSearchParams(location.search).has('capture')) btn.hidden = true;
    document.body.appendChild(btn);

    // On a phone or computer, offer Meta's Web Launch: it opens this page in
    // the headset's browser, so nobody has to type the address on a Quest.
    const onQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
    if (!onQuest && !btn.hidden) {
      const send = document.createElement('a');
      send.textContent = 'Open on Meta Quest';
      send.href = 'https://www.oculus.com/open_url/?url=' + encodeURIComponent(location.origin + '/');
      send.target = '_blank';
      send.rel = 'noopener';
      Object.assign(send.style, {
        position: 'fixed', left: '50%', bottom: '96px', transform: 'translateX(-50%)', zIndex: '10',
        padding: '10px 22px', font: '600 16px Georgia, serif', color: '#f2d9a6', background: 'rgba(20,10,6,.85)',
        border: '2px solid #f2d9a6', borderRadius: '999px', textDecoration: 'none',
      });
      document.body.appendChild(send);
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe((vs) => {
          send.style.display = vs === VisibilityState.NonImmersive ? 'block' : 'none';
        }),
      );
    }
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((vs) => {
        btn.style.display = vs === VisibilityState.NonImmersive && !btn.hidden ? 'block' : 'none';
      }),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'n' || e.key === ' ') this.press('next');
      if (e.key === 'b') this.press('book');
      if (e.key === 'g') this.press('gentle');
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
  }

  private installDebug() {
    window.__shadowfolk = {
      setPoses: (p) => {
        this.simPoses = p;
      },
      state: () => ({
        state: this.state,
        level: this.state === 'puzzle' ? `puzzle-${PUZZLES[this.progress.puzzle]?.id}` : this.level.id,
        puzzleCount: this.puzzleCount,
        puzzleDone: this.puzzleDoneAt >= 0,
        score: this.score,
        found: [...this.progress.found],
        hands: (this.present.left ? 1 : 0) + (this.present.right ? 1 : 0),
      }),
      press: (id) => this.press(id),
      renderMusic: async (seconds, cues) => {
        const bytes = await Sfx.renderPreview(seconds, cues);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      setCameraPitch: (deg) => {
        this.world.camera.rotation.set((deg * Math.PI) / 180, 0, 0, 'YXZ');
      },
      posesFor: (id) => LEVELS.find((l) => l.id === id)?.hands ?? [],
      targetPoses: (dx, dy) =>
        this.level.hands.map((h) => ({ ...h, pos: [h.pos[0] + dx, h.pos[1] + dy, h.pos[2]] as [number, number, number] })),
      reset: () => {
        this.progress = { level: 0, found: [], gentle: false, dailyDay: -1, streak: 0, puzzle: 0 };
        saveProgress(this.progress);
        this.applyContrast();
        this.enter('intro');
      },
    };
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/** Move the target shape so it starts where the player's shadow was, then let it act. */
function animateCreature(
  src: SegmentBuffer,
  dst: SegmentBuffer,
  motion: Motion,
  t: number,
  from: { x: number; y: number; s: number; mirror: boolean },
  center: [number, number],
  eyeIn: [number, number] | null,
  eyeOut: [number, number],
): [number, number] | null {
  const [cx, cy] = center;
  let ox = 0, oy = 0, sx = 1, sy = 1, rot = 0;
  const e = Math.max(0, t - 0.5); // brief pause before it moves
  switch (motion) {
    case 'flutter':
      ox = -e * 0.12 + Math.sin(e * 5) * 0.05;
      oy = e * 0.09;
      sx = 1 - 0.35 * Math.abs(Math.sin(e * 14));
      break;
    case 'hop':
      ox = e * 0.22;
      oy = Math.abs(Math.sin(e * Math.PI * 1.6)) * 0.12;
      rot = -Math.sin(e * Math.PI * 1.6) * 0.15;
      break;
    case 'snap':
      sy = 1 + 0.12 * Math.max(0, Math.sin(e * 18)) * Math.max(0, 1 - e);
      ox = -Math.max(0, e - 0.8) * 0.3;
      oy = Math.sin(e * 4) * 0.01;
      break;
    case 'bark':
      oy = Math.abs(Math.sin(e * 10)) * 0.03 * Math.max(0, 1.5 - e);
      ox = Math.max(0, e - 1.2) * 0.3;
      break;
    case 'glide':
      ox = e * 0.18;
      oy = Math.sin(e * 2) * 0.015;
      break;
    case 'fly':
      ox = e * 0.12;
      oy = e * 0.14;
      sx = 1 - 0.4 * Math.abs(Math.sin(e * 12));
      sy = 1 - e * 0.12;
      break;
    case 'drift':
      ox = e * 0.1;
      oy = Math.sin(e * 1.5) * 0.02;
      rot = Math.sin(e * 1.2) * 0.08;
      break;
    case 'scuttle':
      // quick little steps up and to the side
      ox = e * 0.2 + Math.sin(e * 34) * 0.005;
      oy = e * 0.09;
      rot = Math.sin(e * 17) * 0.05;
      break;
    case 'sway':
      ox = e * 0.12;
      rot = Math.sin(e * 2.4) * 0.12;
      break;
  }
  const s = from.s;
  const mir = from.mirror ? -1 : 1;
  const c = Math.cos(rot), sn = Math.sin(rot);
  const a = src.data, d = dst.data;
  d.set(a);
  if (eyeIn) {
    const x = (eyeIn[0] - cx) * mir * sx;
    const y = (eyeIn[1] - cy) * sy;
    eyeOut[0] = cx + from.x + (x * c - y * sn) * s + ox;
    eyeOut[1] = cy + from.y + (x * sn + y * c) * s + oy;
  }
  for (let i = 0; i < a.length; i += 4) {
    if ((i / 4) % 2 === 0 && a[i + 2] <= 0) {
      // unused segment: skip both endpoints
      i += 4;
      continue;
    }
    let x = (a[i] - cx) * mir * sx;
    let y = (a[i + 1] - cy) * sy;
    const rx = x * c - y * sn;
    const ry = x * sn + y * c;
    x = cx + from.x + rx * s + ox;
    y = cy + from.y + ry * s + oy;
    d[i] = x;
    d[i + 1] = y;
    d[i + 2] = a[i + 2] * s;
    d[i + 3] = a[i + 3];
  }
  return eyeIn ? eyeOut : null;
}

/** The same pose made with the other hand, mirrored left to right. */
function mirrorPose(h: HandPose): HandPose {
  const r = h.rot ?? [0, 0, 0];
  return { ...h, hand: h.hand === 'right' ? 'left' : 'right', pos: [-h.pos[0], h.pos[1], h.pos[2]], rot: [r[0], -r[1], -r[2]] };
}
