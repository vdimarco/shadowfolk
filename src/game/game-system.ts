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
  MAX_TILT,
  projectHand,
  projectPoint,
  rasterize,
  SegmentBuffer,
  shapeStats,
  SEGS_PER_HAND,
  WALL_H,
  WALL_W,
} from './silhouette.js';
import { FireflyPuzzle, type HandInput, PEARL_R, PUZZLES, RAIN_SOLUTION, type Target, ToolPuzzle } from './puzzles.js';
import { type Tool, TOOL_HOW, TOOL_NAMES, ToolTracker } from './tools.js';
import { loadProgress, type Progress, saveProgress } from './storage.js';
import { HandViz } from './hand-viz.js';
import { SkinnedHands } from './skinned-hands.js';
import { Theater } from './theater.js';
import { NightWorld } from './world.js';
import { BattleScene } from './battle-scene.js';
import { JointFilter } from './smooth.js';
import { ART, ArtSprite, CreatureArt } from './creature-art.js';
import { Creature3D } from './creature3d.js';

type State = 'intro' | 'level' | 'wake' | 'book' | 'finale' | 'free' | 'puzzle' | 'battle';

const HOLD_TIME = 0.55;
/** Close but not quite: stay this near the shape for NEAR_TIME and it wakes anyway. */
const NEAR_MARGIN = 0.06;
const NEAR_TIME = 2.0;
const WAKE_TIME = 4.5;
const INTRO_AREA = 120;
const SIDES_LR = ['left', 'right'] as const;
const SIDES_RL = ['right', 'left'] as const;

interface DebugApi {
  setPoses(poses: HandPose[] | null): void;
  state(): {
    state: State;
    level: string;
    score: number;
    found: string[];
    hands: number;
    puzzleCount: number;
    puzzleDone: boolean;
    xr: boolean;
    battle: { hp: number; maxHp: number; flames: number; state: string; windup: number; warded: boolean; spells: string[] } | null;
  };
  /** Battle cues so far (casts, hits, strikes), in battle seconds, for the video soundtrack. */
  battleLog(): { t: number; type: string }[];
  /** Camera and room positions, to check where the room was anchored. */
  where(): { camera: number[]; room: number[]; anchored: boolean };
  press(id: string): void;
  reset(): void;
  /** Render the music offline and return it as base64 WAV, to check it without a headset. */
  renderMusic(seconds: number, cues?: { t: number; type: string }[]): Promise<string>;
  /** Tilt the view down (negative degrees) to show the button tray: the camera on desktop, the emulated head in IWER. */
  setCameraPitch(deg: number): void;
  /** Start the immersive session (used with the IWER emulator for recording). */
  enterXR(): void;
  /** Store art: hide the paper's text and meter, and place the desktop camera (meters, degrees). */
  art(on: boolean, camera?: { pos: [number, number, number]; pitch: number; fov?: number }, title?: string, titleSize?: number): void;
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
  private nightWorld!: NightWorld;
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
  private rain: ToolPuzzle | null = null;
  private flies: FireflyPuzzle | null = null;
  private puzzleMask = new Uint8Array(GRID_W * GRID_H);
  /** Tool puzzles: each hand's own shadow, its tool, and where its palm is on the paper (0 right, 1 left). */
  private handMasks = [new Uint8Array(GRID_W * GRID_H), new Uint8Array(GRID_W * GRID_H)];
  private trackers = [new ToolTracker(), new ToolTracker()];
  private handIn: HandInput[] = [0, 1].map((i) => ({ mask: this.handMasks[i], tool: null, x: 0, y: 0, vx: 0, vy: 0, palmUp: 0 }));
  private palmPrev = [new Float32Array(3), new Float32Array(3)];
  private palmTmp: [number, number] = [0, 0];
  private toolKey = '';
  /** Per hand (0 right, 1 left): '' = not in view, 'x' = a shape not allowed here, else the tool. */
  private toolState = ['', ''];
  private puzzleCount = -1;
  private puzzleDoneAt = -1;
  private rainSolution = poseToJoints(RAIN_SOLUTION);
  private tipShown = false;
  /** Frame-time watch: drop shadow resolution once if the headset falls behind. */
  private slowTime = 0;
  private lowQuality = false;
  /** Capture mode steps a virtual clock at 30 fps, so the frame-time watch must stay off. */
  private capture = new URLSearchParams(location.search).has('capture');
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
  /** Chapter four: the Ink Wolf. */
  private battleScene!: BattleScene;
  /** The illustrated creature that appears when a shadow wakes. */
  private wakeSprite = new ArtSprite(6);
  private wakeArt = false;
  /** The 3D figure that steps out of the paper when a shadow wakes. */
  private creature3d = new Creature3D();
  private wake3d = false;
  private motion = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };

  private live = new SegmentBuffer();
  private creature = new SegmentBuffer();
  private targetSegs = new SegmentBuffer();
  private mask = new Uint8Array(GRID_W * GRID_H);
  private tmask = new Uint8Array(GRID_W * GRID_H);
  private matcher = new Matcher();

  private joints = { left: new Float32Array(JOINT_COUNT * 3), right: new Float32Array(JOINT_COUNT * 3) };
  private present = { left: false, right: false };
  /** Tracked joints shimmer a little; smooth them so the shadow's edge is calm. */
  private filters = { left: new JointFilter(), right: new JointFilter() };
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
  private nearHold = 0;
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
    CreatureArt.load();
    this.theater.root.add(this.wakeSprite.mesh, this.creature3d.root);
    this.battleScene = new BattleScene(this.theater, this.sfx);
    this.nightWorld = new NightWorld();
    this.theater.root.add(this.nightWorld.root);
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
    if (this.state === 'battle' && s !== 'battle') this.battleScene.stop();
    if (s !== 'wake') {
      this.wakeSprite.set(0);
      this.wakeSprite.hide();
      this.creature3d.end();
      this.wake3d = false;
    }
    this.state = s;
    this.stateTime = 0;
    this.hold = 0;
    this.nearHold = 0;
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
        u.uFlash.value.y = 0.7; // a soft golden flash as the shadow comes alive
        this.wakeArt = this.wakeSprite.show(this.level.id);
        this.wake3d =
          this.wakeArt &&
          this.creature3d.begin(this.level.id, this.wakeCenter[0] + this.wakeFrom.x, this.wakeCenter[1] + this.wakeFrom.y);
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
        this.rain = info.id !== 'fireflies' ? new ToolPuzzle(info.id, this.progress.gentle) : null;
        this.toolKey = '';
        this.toolState[0] = this.toolState[1] = '';
        for (const pp of this.palmPrev) pp[2] = 0;
        this.flies = info.id === 'fireflies' ? new FireflyPuzzle(this.progress.gentle) : null;
        u.uDotKind.value = this.flies ? 1 : 0;
        this.puzzleCount = -1;
        this.puzzleDoneAt = -1;
        this.tipShown = false;
        this.inkPuzzle();
        break;
      }
      case 'battle':
        this.isDaily = false;
        this.freePlay = false;
        this.targetJoints = [];
        u.uLiveAlpha.value = 1;
        this.battleScene.start(this.progress.gentle, this.progress.found);
        break;
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
    } else if (!this.progress.battle) {
      this.enter('battle');
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
    // show the outline at an angle a seated arm can reach; matching allows the tilt
    const show = this.level.show ?? 0;
    if (show) {
      const [cx, cy] = gridToWall(this.matcher.targetStats.cx, this.matcher.targetStats.cy);
      rotateSegs(this.targetSegs, cx, cy, show);
      if (this.eyeBase) rotate2(this.eyeBase, cx, cy, show);
    }
    this.guideTilt = show;
    this.creature3d.preload(this.level.id);
    this.theater.wallMat.uniforms.uTargetAlpha.value = 0;
  }
  /** Current turn of the guide hand (degrees), following the player's forearm. */
  private guideTilt = 0;

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
      } else if (this.state === 'battle') {
        this.progress.battle = true;
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

  private readHands(dt: number) {
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
      this.filters[src.handedness].apply(out, dt);
      this.present[src.handedness] = true;
    }
    if (!this.present.left) this.filters.left.reset();
    if (!this.present.right) this.filters.right.reset();
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
    // a safety net for the headset: if frames stay slow for 3 s, halve the shadow textures
    if (!this.lowQuality && this.world.session && !this.capture) {
      this.slowTime = delta > 1 / 55 ? this.slowTime + delta : Math.max(0, this.slowTime - delta);
      if (this.slowTime > 3) {
        this.lowQuality = true;
        this.theater.live.setSize(1024, 704);
        this.theater.target.setSize(1024, 704);
        this.targetDirty = true;
        console.warn('[shadowfolk] frames are slow: shadow resolution lowered');
      }
    }
    this.anchor();
    const u = this.theater.wallMat.uniforms;
    u.uTime.value = time;
    this.nightWorld.update(time);
    if (this.paused) return;
    this.stateTime += dt;

    this.readHands(dt);
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
    // in the puzzles the whole arm is the slide; elsewhere the arm fades to a stem
    this.theater.live.setFadeArm(this.state === 'puzzle' ? 0 : 1);
    if (this.state !== 'puzzle' || !this.rain) this.theater.live.setGhost(false, false);
    this.theater.live.render(renderer, this.live);

    const area = this.present.left || this.present.right ? rasterize(this.live, this.mask) : 0;

    this.updateGuide(dt);
    u.uEye.value.w = 0;
    if (this.state !== 'puzzle' && this.state !== 'battle') u.uDotCount.value = 0;

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
        this.nearHold = raw >= thr - NEAR_MARGIN ? this.nearHold + dt : Math.max(0, this.nearHold - dt * 2);
        u.uHold.value = Math.min(1, Math.max(this.hold / HOLD_TIME, this.nearHold / NEAR_TIME));
        if (this.hold >= HOLD_TIME || this.nearHold >= NEAR_TIME) {
          this.nearHold = 0;
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
        const t = this.stateTime;
        u.uLiveAlpha.value = Math.max(0.15, 1 - t * 1.5);
        u.uTargetAlpha.value = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
        const eyeOut = animateCreature(
          this.targetSegs, this.creature, this.level.motion, t, this.wakeFrom, this.wakeCenter, this.eyeBase, this.eyeTmp,
        );
        if (this.wakeArt) {
          // the shadow shape glows, then gives way to the creature it always was
          u.uTargetAlpha.value = t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) / 0.6);
          const m = creatureMotion(this.level.motion, t, this.motion);
          const info = ART[this.level.id];
          const h = info.height * Math.min(1.3, Math.max(0.85, this.wakeFrom.s));
          this.wakeSprite.place(
            this.wakeCenter[0] + this.wakeFrom.x + m.ox,
            this.wakeCenter[1] + this.wakeFrom.y + m.oy,
            h, m.rot, m.sx, m.sy, this.wakeFrom.mirror,
          );
          const reveal = Math.min(1, Math.max(0, (t - 0.15) / 0.9));
          // with a 3D figure, the illustration lifts off the paper into it
          const fade = this.wake3d
            ? Math.max(0, 1 - Math.max(0, t - 1.1) / 0.6)
            : k < 0.82 ? 1 : Math.max(0, 1 - (k - 0.82) / 0.18);
          this.wakeSprite.set(fade, reveal, time);
          if (this.wake3d) this.creature3d.update(t, WAKE_TIME + 0.4, time);
        } else if (eyeOut) {
          // the eye opens after the creature starts to move, and blinks twice
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
      case 'battle': {
        const done = this.battleScene.update(dt, renderer, this.mask, area);
        this.score = this.battleScene.score;
        if (done) {
          this.progress.battle = true;
          saveProgress(this.progress);
          this.startNextLevel();
        }
        break;
      }
      default:
        break;
    }
    // magic: the glow around the shadow follows how close it is to the shape
    let want = 0;
    if (this.state === 'level' || this.state === 'free') {
      const thr = u.uThreshold.value as number;
      want = Math.max(0, Math.min(1, (this.score - (thr - 0.24)) / 0.24));
    } else if (this.state === 'battle') {
      want = this.battleScene.magic;
    } else if (this.state === 'intro') {
      want = this.present.left || this.present.right ? 0.45 : 0;
    }
    this.magic += (want - this.magic) * Math.min(1, dt * 5);
    if (this.state !== 'battle') u.uFlash.value.y = Math.max(0, u.uFlash.value.y - dt * 1.6);
    u.uMagic.value = this.magic;
    // art mode (store images): a clean paper with no text and no meter
    if (this.artMode) {
      u.uMeter.value = 0;
      if (this.theater.inkTex.version !== this.artInkVersion) {
        const c = this.theater.ink;
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, c.width, c.height);
        if (this.artTitle) {
          g.fillStyle = '#000';
          g.textAlign = 'center';
          g.textBaseline = 'alphabetic';
          g.font = `italic 600 ${this.artTitleSize}px Georgia, serif`;
          g.fillText(this.artTitle, 512, 40 + this.artTitleSize);
        }
        this.theater.inkTex.needsUpdate = true;
        this.artInkVersion = this.theater.inkTex.version;
      }
    }
  }
  private magic = 0;
  private artMode = false;
  private artTitle = '';
  private artTitleSize = 150;
  private artInkVersion = -1;

  /** Chapter three: step the puzzle with the full shadow (forearm included) as solid ground. */
  private updatePuzzle(dt: number) {
    const u = this.theater.wallMat.uniforms;
    const r = this.rain;
    if (r) this.updateTools(dt);
    else if (this.present.left || this.present.right) rasterize(this.live, this.puzzleMask, false);
    else this.puzzleMask.fill(0);
    if (r) {
      r.step(dt, this.handIn);
      this.playPuzzleEvents();
    } else if (this.flies) this.flies.step(dt, this.puzzleMask);
    else return;
    // hand the dots to the wall shader: x, y, radius, brightness (negative: a pearl)
    const dots = r ? r.drops : this.flies!.flies;
    const arr = u.uDots.value as Float32Array;
    let n = 0;
    for (const d of dots) {
      if (!d.alive || n >= 32) continue;
      arr[n * 4] = d.x;
      arr[n * 4 + 1] = d.y;
      if (r) {
        arr[n * 4 + 2] = d.pearl ? PEARL_R * 1.05 : 0.0105;
        arr[n * 4 + 3] = d.pearl ? -1 : 1;
      } else {
        arr[n * 4 + 2] = 0.013;
        arr[n * 4 + 3] = 0.75 + 0.25 * Math.sin(d.phase * 2.3);
      }
      n++;
    }
    u.uDotCount.value = n;
    // redraw the ink when a count or the ice changes
    let count = 0;
    if (r) {
      for (let i = 0; i < r.targets.length; i++) count += Math.min(r.targets[i].count, 63) * 64 ** i;
      count += r.ice * 64 ** 3;
    } else count = this.flies!.caught;
    if (count !== this.puzzleCount) {
      if (!r && count > this.puzzleCount && this.puzzleCount >= 0) this.sfx.tap();
      this.puzzleCount = count;
      this.inkPuzzle();
    }
    const info = PUZZLES[this.progress.puzzle];
    const stuck = r ? this.stateTime > 30 && !r.solved : this.stateTime > 20 && this.flies!.caught < 3;
    if (!this.tipShown && info?.tip && stuck) {
      this.tipShown = true;
      this.inkPuzzle();
    }
    const solved = r ? r.solved : this.flies!.solved;
    if (this.puzzleDoneAt < 0 && solved) {
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

  /** Read each hand's tool from its shape; shapes this puzzle does not allow become ghosts. */
  private updateTools(dt: number) {
    const allowed = PUZZLES[this.progress.puzzle]?.tools ?? 'any';
    let key = '';
    let ghostR = false;
    let ghostL = false;
    for (let i = 0; i < 2; i++) {
      const side = SIDES_RL[i];
      const h = this.handIn[i];
      const prev = this.palmPrev[i];
      if (!this.present[side]) {
        this.trackers[i].update(null, side, dt);
        h.tool = null;
        h.mask.fill(0);
        prev[2] = 0;
        this.toolState[i] = '';
        key += '-|';
        continue;
      }
      rasterize(this.live, h.mask, false, i * SEGS_PER_HAND, SEGS_PER_HAND);
      const j = this.joints[side];
      let tool: Tool | null = this.trackers[i].update(j, side, dt);
      // gentle mode: any shape counts as the first tool allowed here
      if (allowed !== 'any' && tool && !allowed.includes(tool)) tool = this.progress.gentle ? allowed[0] : null;
      h.tool = tool;
      h.palmUp = this.trackers[i].f.palmUp;
      if (tool === null) {
        if (i === 0) ghostR = true;
        else ghostL = true;
      }
      // the palm center (between the wrist and the middle knuckle) on the paper
      const pc = projectPoint((j[0] + j[33]) / 2, (j[1] + j[34]) / 2, (j[2] + j[35]) / 2, this.palmTmp);
      if (pc) {
        if (prev[2] && dt > 0) {
          const k = Math.min(1, dt * 12);
          h.vx += ((pc[0] - prev[0]) / dt - h.vx) * k;
          h.vy += ((pc[1] - prev[1]) / dt - h.vy) * k;
        } else {
          h.vx = 0;
          h.vy = 0;
        }
        h.x = prev[0] = pc[0];
        h.y = prev[1] = pc[1];
        prev[2] = 1;
      }
      this.toolState[i] = tool ?? 'x';
      key += `${this.toolState[i]}|`;
    }
    this.theater.live.setGhost(ghostR, ghostL);
    if (key !== this.toolKey) {
      if (this.toolKey) this.sfx.tap();
      this.toolKey = key;
      this.inkPuzzle();
    }
  }

  private playPuzzleEvents() {
    const ev = this.rain!.events;
    for (const e of ev) {
      if (e === 'knock') this.sfx.cue('thump');
      else if (e === 'free') {
        this.sfx.cue('thump');
        this.sfx.chime();
      } else if (e === 'spill') {
        this.sfx.cue('hurt');
        if (!this.tipShown && PUZZLES[this.progress.puzzle]?.tip) {
          this.tipShown = true;
          this.inkPuzzle();
        }
      } else if (e === 'pour') this.sfx.cue('whoosh');
      else if (e === 'drop' || e === 'pearl') this.sfx.tap();
    }
    ev.length = 0;
  }

  private inkPuzzle() {
    const info = PUZZLES[this.progress.puzzle] ?? PUZZLES[0];
    const done = this.puzzleDoneAt >= 0;
    const r = this.rain;
    const c = this.theater.ink;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.save();
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = 'italic 600 60px Georgia, serif';
    g.fillText(info.name, 512, 88);
    // the tools this puzzle allows
    if (info.tools !== 'any') {
      g.globalAlpha = 0.72;
      g.font = 'italic 26px Georgia, serif';
      g.fillText('Tools:  ' + info.tools.map((t) => `${TOOL_NAMES[t]} (${TOOL_HOW[t]})`).join('   ·   '), 512, 126);
    }
    g.globalAlpha = 1;
    g.font = '32px Georgia, serif';
    const text = done ? info.done : this.tipShown && info.tip ? info.tip : info.hint;
    wrap(text, 58).slice(0, 2).forEach((t, i) => g.fillText(t, 512, 170 + i * 40));

    const X = (x: number) => ((x + WALL_W / 2) / WALL_W) * 1024;
    const Y = (y: number) => ((WALL_H / 2 - y) / WALL_H) * 704;
    const S = 1024 / WALL_W;
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (r) {
      const cl = r.cloud;
      g.globalAlpha = 0.55;
      for (const [dx, dy, rr] of [[-0.07, 0, 0.04], [0, 0.02, 0.055], [0.07, 0, 0.042], [0.03, -0.015, 0.04], [-0.035, -0.015, 0.038]]) {
        g.beginPath();
        g.arc(X(cl.x + dx), Y(cl.y + 0.04 + dy), rr * S, 0, Math.PI * 2);
        g.fill();
      }
      // the ice: a pale block around the cloud, cracking with each knock
      if (r.ice > 0) {
        const b = r.iceBox;
        g.globalAlpha = 0.16;
        g.fillRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * S, (b.y1 - b.y0) * S);
        g.globalAlpha = 0.75;
        g.lineWidth = 4;
        g.strokeRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * S, (b.y1 - b.y0) * S);
        g.lineWidth = 3;
        const knocks = r.iceMax - r.ice;
        for (let k = 0; k < knocks; k++) {
          const sx = b.x0 + (b.x1 - b.x0) * (0.3 + 0.25 * k);
          g.beginPath();
          g.moveTo(X(sx), Y(b.y1));
          g.lineTo(X(sx + 0.02), Y(b.y1 - 0.04));
          g.lineTo(X(sx - 0.01), Y(b.y1 - 0.08));
          g.lineTo(X(sx + 0.015), Y(b.y0));
          g.stroke();
        }
        g.lineWidth = 5;
      }
      if (r.shelf) {
        const sh = r.shelf;
        g.globalAlpha = 0.8;
        g.beginPath();
        g.moveTo(X(sh.x - sh.w / 2), Y(sh.y));
        g.lineTo(X(sh.x + sh.w / 2), Y(sh.y));
        g.moveTo(X(sh.x - sh.w / 2 + 0.03), Y(sh.y));
        g.lineTo(X(sh.x - sh.w / 2 + 0.06), Y(sh.y - 0.05));
        g.moveTo(X(sh.x + sh.w / 2 - 0.03), Y(sh.y));
        g.lineTo(X(sh.x + sh.w / 2 - 0.06), Y(sh.y - 0.05));
        g.stroke();
      }
      for (const t of r.targets) this.inkTarget(g, t, X, Y, S);
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
      g.globalAlpha = 0.8;
      g.font = '600 30px Georgia, serif';
      g.fillText(`${Math.min(this.flies.caught, this.flies.goal)} of ${this.flies.goal}`, X(j.x), Y(j.y + j.r * 1.4 + 0.04));
    }
    // what each hand is making now
    if (r && info.tools !== 'any') {
      const name = (i: number) => {
        const st = this.toolState[i];
        return st === '' ? '' : st === 'x' ? 'not a tool here' : TOOL_NAMES[st as Tool];
      };
      const parts = [name(1) && `Left hand: ${name(1)}`, name(0) && `Right hand: ${name(0)}`].filter(Boolean);
      g.globalAlpha = 0.62;
      g.font = '22px Georgia, serif';
      g.textAlign = 'left';
      g.fillText(parts.join('   ·   '), 24, 690);
    }
    g.globalAlpha = 0.55;
    g.font = '22px Georgia, serif';
    g.textAlign = 'right';
    g.fillText(`Puzzle ${this.progress.puzzle + 1} of ${PUZZLES.length}`, 1000, 690);
    g.restore();
    this.theater.inkTex.needsUpdate = true;
  }

  /** Draw a puzzle target (cup, pot, shell or lantern) and its count. */
  private inkTarget(g: CanvasRenderingContext2D, t: Target, X: (x: number) => number, Y: (y: number) => number, S: number) {
    const f = Math.min(1, t.count / t.goal);
    const l = t.x - t.w / 2, rr = t.x + t.w / 2, top = t.y + t.h / 2, bot = t.y - t.h / 2;
    g.globalAlpha = 0.85;
    g.lineWidth = 5;
    if (t.style === 'cup' || t.style === 'pot') {
      const inset = t.style === 'pot' ? 0.03 : 0.015;
      g.beginPath();
      g.moveTo(X(l), Y(top));
      g.lineTo(X(l + inset), Y(bot));
      g.lineTo(X(rr - inset), Y(bot));
      g.lineTo(X(rr), Y(top));
      g.stroke();
      if (t.style === 'pot') {
        // a rim, and a moon flower that grows as the seed drinks
        g.beginPath();
        g.moveTo(X(l - 0.012), Y(top));
        g.lineTo(X(rr + 0.012), Y(top));
        g.stroke();
        const stem = 0.04 + f * 0.2;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(X(t.x), Y(top));
        g.quadraticCurveTo(X(t.x - 0.03), Y(top + stem * 0.5), X(t.x), Y(top + stem));
        g.stroke();
        if (f > 0.3) {
          g.beginPath();
          g.ellipse(X(t.x + 0.025), Y(top + stem * 0.4), 0.022 * S, 0.01 * S, -0.5, 0, Math.PI * 2);
          g.fill();
        }
        if (f > 0.6) {
          g.beginPath();
          g.ellipse(X(t.x - 0.025), Y(top + stem * 0.65), 0.022 * S, 0.01 * S, 0.5, 0, Math.PI * 2);
          g.fill();
        }
        const bloom = f >= 1 ? 1 : f > 0.8 ? 0.45 : 0.2;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.beginPath();
          g.ellipse(X(t.x + Math.cos(a) * 0.018 * bloom), Y(top + stem + Math.sin(a) * 0.018 * bloom), 0.016 * S * bloom, 0.008 * S * bloom, a, 0, Math.PI * 2);
          g.fill();
        }
      } else if (f > 0) {
        g.globalAlpha = 0.35;
        const wt = bot + t.h * 0.85 * f;
        g.fillRect(X(l + 0.018), Y(wt), (t.w - 0.036) * S, Y(bot) - Y(wt));
      }
    } else if (t.style === 'shell') {
      // a scallop shell, open, with the pearls it holds
      g.beginPath();
      g.arc(X(t.x), Y(bot), (t.w / 2) * S, Math.PI, 0);
      g.stroke();
      g.lineWidth = 3;
      for (let k = 1; k < 5; k++) {
        const a = Math.PI + (k / 5) * Math.PI;
        g.beginPath();
        g.moveTo(X(t.x), Y(bot));
        g.lineTo(X(t.x + Math.cos(a) * t.w * 0.48), Y(bot - Math.sin(a) * t.w * 0.48));
        g.stroke();
      }
      g.globalAlpha = 0.5;
      for (let k = 0; k < Math.min(t.count, t.goal); k++) {
        g.beginPath();
        g.arc(X(t.x - 0.05 + k * 0.03), Y(bot + 0.022), 0.012 * S, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      // a paper lantern that fills with light
      g.beginPath();
      g.ellipse(X(t.x), Y(t.y), (t.w / 2) * S, (t.h / 2) * S, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(X(t.x), Y(top));
      g.lineTo(X(t.x), Y(top + 0.04));
      g.stroke();
      g.lineWidth = 3;
      for (const k of [-0.5, 0, 0.5]) {
        g.beginPath();
        g.ellipse(X(t.x + k * t.w * 0.3), Y(t.y), (t.w * 0.12 * (1 - Math.abs(k))) * S + 1, (t.h / 2) * S, 0, 0, Math.PI * 2);
        g.stroke();
      }
      if (f > 0) {
        g.globalAlpha = 0.18 * f;
        g.beginPath();
        g.ellipse(X(t.x), Y(t.y), (t.w / 2) * S, (t.h / 2) * S, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 0.8;
    g.font = '600 28px Georgia, serif';
    g.textAlign = 'center';
    const labelY = t.style === 'pot' ? top + 0.27 : t.style === 'lantern' ? top + 0.08 : top + 0.04;
    g.fillText(`${Math.min(t.count, t.goal)} of ${t.goal}`, X(t.x), Y(labelY));
  }

  private buildFreeCands() {
    const found = new Set(this.progress.found);
    const levels = LEVELS.filter((l) => found.has(l.id));
    const today = dailyLevel(dayNumber());
    if (found.has(today.id)) levels.push(today);
    const buf = new SegmentBuffer();
    const m = new Uint8Array(GRID_W * GRID_H);
    for (const l of levels) this.creature3d.preload(l.id);
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
    // rain puzzle: after a while with no luck, show a slide that works
    const rainHelp = this.state === 'puzzle' && this.rain?.id === 'rain' && this.puzzleDoneAt < 0 && this.stateTime > (this.progress.gentle ? 6 : 12) && this.rain.collected < 2;
    if (rainHelp) want = 1;
    this.guideAlpha += (want - this.guideAlpha) * Math.min(1, dt * (want ? 1.2 : 4));
    const show = this.guideAlpha > 0.01 && (rainHelp || this.targetJoints.length > 0);
    // a lone left hand on a right-hand shape: mirror the guide for that hand
    const mirror = this.level.hands.length === 1 && this.level.hands[0].hand === 'right' && this.present.left && !this.present.right;
    const src = mirror ? this.mirrorJoints : this.targetJoints;
    this.guideHands[0] = null;
    this.guideHands[1] = null;
    this.guideSide[0] = null;
    this.guideSide[1] = null;
    if (show && rainHelp) {
      // the solution slide, in its real place: no following the wrist
      this.guideHands[0] = this.rainSolution;
      this.guideSide[0] = 'right';
    } else if (show && this.state === 'level') {
      // which target hands to draw, and which real hand each one belongs to
      let n = 0;
      for (let k = 0; k < src.length; k++) {
        const side: Handedness = mirror ? (this.level.hands[k].hand === 'right' ? 'left' : 'right') : this.level.hands[k].hand;
        if (this.oneHandOk() && !this.present[side]) continue;
        this.guideHands[n] = src[k];
        this.guideSide[n] = side;
        n++;
      }
      // turn the guide to the angle of the player's own hand (inside the
      // tilt the matcher allows), so it never asks for a sideways wrist bend
      let want = this.level.show ?? 0, dsum = 0, dn = 0;
      for (let k = 0; k < n; k++) {
        const side = this.guideSide[k]!;
        if (!this.present[side]) continue;
        const g = this.guideHands[k]!;
        const real = this.joints[side];
        const ar = Math.atan2(real[34] - real[1], real[33] - real[0]);
        const ag = Math.atan2(g[34] - g[1], g[33] - g[0]);
        let d = ((ar - ag) * 180) / Math.PI;
        d = ((((d + 180) % 360) + 360) % 360) - 180;
        dsum += d;
        dn++;
      }
      if (dn) want = Math.max(-MAX_TILT, Math.min(MAX_TILT, dsum / dn));
      this.guideTilt += (want - this.guideTilt) * Math.min(1, dt * 5);
      const r = (this.guideTilt * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      let px = 0, py = 0;
      for (let k = 0; k < n; k++) {
        px += this.guideHands[k]![0] / n;
        py += this.guideHands[k]![1] / n;
      }
      for (let k = 0; k < n; k++) {
        const g = this.guideHands[k]!;
        const out = this.guideBuf[k];
        for (let i = 0; i < JOINT_COUNT; i++) {
          const x = g[i * 3] - px, y = g[i * 3 + 1] - py;
          out[i * 3] = px + c * x - sn * y;
          out[i * 3 + 1] = py + sn * x + c * y;
          out[i * 3 + 2] = g[i * 3 + 2];
        }
        this.guideHands[k] = out;
      }
      // then move the guide so its wrists sit on the real wrists
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
        const out = this.guideHands[k]!;
        for (let i = 0; i < JOINT_COUNT; i++) {
          out[i * 3] += ox;
          out[i * 3 + 1] += oy;
          out[i * 3 + 2] += oz;
        }
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
      // the illustrated creature, inked on the page (faint until it is found)
      const art = CreatureArt.texture(lv.id);
      const artImg = art?.image as CanvasImageSource | undefined;
      const info = ART[lv.id];
      if (artImg && info) {
        const boxH = (cw * GRID_H) / GRID_W;
        let w = boxH * info.aspect, h = boxH;
        if (w > cw) {
          w = cw;
          h = cw / info.aspect;
        }
        g.globalAlpha = found ? 0.95 : 0.14;
        g.drawImage(artImg, x0 + (cw - w) / 2, y0 + (boxH - h) / 2, w, h);
        g.globalAlpha = found ? 0.9 : 0.4;
        g.font = `${Math.round(Math.min(28, ch / 7))}px Georgia, serif`;
        g.fillText(found ? lv.name : '? ? ?', x0 + cw / 2, y0 + boxH + Math.min(30, ch / 6));
        g.globalAlpha = 1;
        return;
      }
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
        level: this.state === 'puzzle' ? `puzzle-${PUZZLES[this.progress.puzzle]?.id}` : this.state === 'battle' ? 'battle' : this.level.id,
        battle: this.state === 'battle' ? this.battleScene.info : null,
        puzzleCount: this.puzzleCount,
        puzzleDone: this.puzzleDoneAt >= 0,
        score: this.score,
        found: [...this.progress.found],
        hands: (this.present.left ? 1 : 0) + (this.present.right ? 1 : 0),
        xr: !!this.world.session,
      }),
      press: (id) => this.press(id),
      battleLog: () => [...this.battleScene.log],
      where: () => {
        this.world.camera.getWorldPosition(this.v);
        const r = this.theater.root.position;
        return { camera: [this.v.x, this.v.y, this.v.z], room: [r.x, r.y, r.z], anchored: this.anchored };
      },
      renderMusic: async (seconds, cues) => {
        const bytes = await Sfx.renderPreview(seconds, cues);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      setCameraPitch: (deg) => {
        const iwer = (window as unknown as { __iwer?: { quaternion: { set(x: number, y: number, z: number, w: number): unknown } } }).__iwer;
        const a = (deg * Math.PI) / 180;
        if (iwer && this.world.session) iwer.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2));
        else this.world.camera.rotation.set(a, 0, 0, 'YXZ');
      },
      art: (on, camera, title, titleSize) => {
        this.artMode = on;
        this.artInkVersion = -1;
        this.artTitle = title ?? '';
        this.artTitleSize = titleSize ?? 150;
        // store art allows no text but the title: blank the tray labels too
        if (on) this.theater.drawLabels({ book: '', gentle: '', next: '' });
        else this.updateLabels();
        if (camera) {
          const cam = this.world.camera;
          cam.position.set(camera.pos[0], camera.pos[1], camera.pos[2]);
          cam.rotation.set((camera.pitch * Math.PI) / 180, 0, 0, 'YXZ');
          if (camera.fov) {
            cam.fov = camera.fov;
            cam.updateProjectionMatrix();
          }
        }
      },
      enterXR: () => {
        if (this.world.xrEnabled) this.world.launchXR();
      },
      posesFor: (id) => LEVELS.find((l) => l.id === id)?.hands ?? [],
      targetPoses: (dx, dy) =>
        this.level.hands.map((h) => ({ ...h, pos: [h.pos[0] + dx, h.pos[1] + dy, h.pos[2]] as [number, number, number] })),
      reset: () => {
        this.progress = { level: 0, found: [], gentle: false, dailyDay: -1, streak: 0, puzzle: 0, battle: false };
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

const motionTmp = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };

/** How a waking creature moves at time t: offset, stretch and turn. */
function creatureMotion(motion: Motion, t: number, out: { ox: number; oy: number; sx: number; sy: number; rot: number }) {
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
  out.ox = ox;
  out.oy = oy;
  out.sx = sx;
  out.sy = sy;
  out.rot = rot;
  return out;
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
  const { ox, oy, sx, sy, rot } = creatureMotion(motion, t, motionTmp);
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

/** Turn a point about (cx, cy) by deg, in place. */
function rotate2(p: [number, number], cx: number, cy: number, deg: number) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const x = p[0] - cx, y = p[1] - cy;
  p[0] = cx + c * x - s * y;
  p[1] = cy + s * x + c * y;
}

/** Turn every capsule of a SegmentBuffer about (cx, cy) on the wall, in place. */
function rotateSegs(buf: SegmentBuffer, cx: number, cy: number, deg: number) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const d = buf.data;
  for (let o = 0; o < d.length; o += 8) {
    if (d[o + 2] <= 0) continue;
    for (const e of [0, 4]) {
      const x = d[o + e] - cx, y = d[o + e + 1] - cy;
      d[o + e] = cx + c * x - s * y;
      d[o + e + 1] = cy + s * x + c * y;
    }
  }
}
