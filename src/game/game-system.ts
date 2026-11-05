import { createSystem, Matrix4, Vector3, VisibilityState, type WebGLRenderer } from '@iwsdk/core';
import { Sfx } from './audio.js';
import { dailyLevel, dayNumber } from './daily.js';
import { type HandPose, JOINT_COUNT, JOINT_NAMES, poseToJoints } from './hand-model.js';
import { LEVELS, type Level, type Motion } from './levels.js';
import {
  clearHand,
  GRID_H,
  GRID_W,
  gridToWall,
  Matcher,
  projectHand,
  rasterize,
  SegmentBuffer,
  SEGS_PER_HAND,
} from './silhouette.js';
import { loadProgress, type Progress, saveProgress } from './storage.js';
import { Theater } from './theater.js';

type State = 'intro' | 'level' | 'wake' | 'book' | 'finale';

const HOLD_TIME = 0.7;
const WAKE_TIME = 4.5;
const INTRO_AREA = 120;

interface DebugApi {
  setPoses(poses: HandPose[] | null): void;
  state(): { state: State; level: string; score: number; found: string[]; hands: number };
  press(id: string): void;
  reset(): void;
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
        this.loadTarget();
        u.uTargetMode.value = 0;
        u.uLiveAlpha.value = 1;
        u.uMeter.value = 1;
        u.uThreshold.value = this.threshold();
        this.ink(
          [this.level.name],
          wrap(this.level.hint, 52),
          this.isDaily ? `Daily shadow  ·  streak ${this.progress.streak}` : `Shadow ${this.progressIndex() + 1} of ${LEVELS.length}`,
        );
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
        this.ink(
          ['Every shadow is awake'],
          ['A new shadow wakes each day.', 'Press Daily to meet it.'],
          `Found ${this.progress.found.length}  ·  streak ${this.progress.streak}`,
        );
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
    this.level.hands.forEach((h, k) => projectHand(poseToJoints(h), this.targetSegs, k * SEGS_PER_HAND));
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
      if (this.state === 'level') this.theater.wallMat.uniforms.uThreshold.value = this.threshold();
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
      else if (this.state === 'finale') this.startDaily();
      else if (this.state === 'level') {
        // skip: move on without marking the shape found
        if (!this.isDaily && this.progress.level < LEVELS.length) {
          this.progress.level++;
          saveProgress(this.progress);
        }
        this.startNextLevel();
      } else if (this.state === 'wake') this.startNextLevel();
    }
  }

  private resumeFromBook() {
    if (this.progress.found.length === 0 && this.progress.level === 0) this.enter('intro');
    else this.startNextLevel();
  }

  private updateLabels() {
    const next =
      this.state === 'intro' ? 'Begin' : this.state === 'book' ? 'Back' : this.state === 'finale' ? 'Daily' : this.state === 'wake' ? 'Next' : 'Skip';
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
      for (const side of ['left', 'right'] as const) {
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

    // live shadow from tracked hands
    this.live.clear();
    for (const side of ['right', 'left'] as const) {
      const slot = side === 'right' ? 0 : SEGS_PER_HAND;
      if (this.present[side]) projectHand(this.joints[side], this.live, slot, { forearm: true, shoulderX: side === 'right' ? 0.18 : -0.18 });
      else clearHand(this.live, slot);
    }
    const renderer = this.world.renderer as WebGLRenderer;
    this.theater.live.render(renderer, this.live);

    const area = this.present.left || this.present.right ? rasterize(this.live, this.mask) : 0;

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
        this.theater.target.render(renderer, this.targetSegs);
        const raw = area > 0 ? this.matcher.score(this.mask, true) : 0;
        this.score += (raw - this.score) * Math.min(1, dt * 8);
        u.uScore.value = this.score;
        const thr = this.threshold();
        this.sfx.setCloseness(this.score, thr);
        this.hold = raw >= thr ? this.hold + dt : Math.max(0, this.hold - dt * 2);
        u.uHold.value = Math.min(1, this.hold / HOLD_TIME);
        if (this.hold >= HOLD_TIME) {
          const st = this.matcher.lastStats;
          const ts = this.matcher.targetStats;
          const [px, py] = gridToWall(st.cx, st.cy);
          const [tx, ty] = gridToWall(ts.cx, ts.cy);
          this.wakeFrom = { x: px - tx, y: py - ty, s: Math.sqrt(st.area / ts.area), mirror: this.matcher.lastMirrored };
          this.wakeCenter = [tx, ty];
          this.enter('wake');
        }
        break;
      }
      case 'wake': {
        const k = Math.min(1, this.stateTime / WAKE_TIME);
        u.uLiveAlpha.value = Math.max(0.15, 1 - this.stateTime * 1.5);
        u.uTargetAlpha.value = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
        animateCreature(this.targetSegs, this.creature, this.level.motion, this.stateTime, this.wakeFrom, this.wakeCenter);
        this.theater.target.render(renderer, this.creature);
        if (this.stateTime > WAKE_TIME + 0.4) {
          u.uLiveAlpha.value = 1;
          this.startNextLevel();
        }
        break;
      }
      default:
        break;
    }
  }

  private wakeCenter: [number, number] = [0, 0];
  private introDone = false;
  private wasImmersive = false;

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
    const cols = 3;
    const cw = 280, ch = 220;
    const buf = new SegmentBuffer();
    const m = new Uint8Array(GRID_W * GRID_H);
    const all: Level[] = [...LEVELS];
    const today = dailyLevel(dayNumber());
    if (this.progress.found.includes(today.id)) all.push(today);
    const img = g.createImageData(GRID_W, GRID_H);
    const off = document.createElement('canvas');
    off.width = GRID_W;
    off.height = GRID_H;
    const og = off.getContext('2d')!;
    all.slice(0, 9).forEach((lv, i) => {
      const x0 = 512 + ((i % cols) - 1) * (cw + 30) - cw / 2;
      const y0 = 120 + Math.floor(i / cols) * (ch + 10);
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
      g.font = '28px Georgia, serif';
      g.globalAlpha = found ? 0.9 : 0.4;
      g.fillText(found ? lv.name : '? ? ?', x0 + cw / 2, y0 + ch - 6);
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
    document.body.appendChild(btn);
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((vs) => {
        btn.style.display = vs === VisibilityState.NonImmersive ? 'block' : 'none';
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
        level: this.level.id,
        score: this.score,
        found: [...this.progress.found],
        hands: (this.present.left ? 1 : 0) + (this.present.right ? 1 : 0),
      }),
      press: (id) => this.press(id),
      targetPoses: (dx, dy) =>
        this.level.hands.map((h) => ({ ...h, pos: [h.pos[0] + dx, h.pos[1] + dy, h.pos[2]] as [number, number, number] })),
      reset: () => {
        this.progress = { level: 0, found: [], gentle: false, dailyDay: -1, streak: 0 };
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
) {
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
  }
  const s = from.s;
  const mir = from.mirror ? -1 : 1;
  const c = Math.cos(rot), sn = Math.sin(rot);
  const a = src.data, d = dst.data;
  d.set(a);
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
}
