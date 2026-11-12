/**
 * One Euro filter for tracked hand joints: strong smoothing when the hand is
 * still (no shimmer on the shadow's edge), little smoothing when it moves fast
 * (no lag). Casiez, Roussel and Vogel, CHI 2012.
 */
import { JOINT_COUNT } from './hand-model.js';

const TAU = Math.PI * 2;
const alpha = (cutoff: number, dt: number) => {
  const r = TAU * cutoff * dt;
  return r / (r + 1);
};

export class JointFilter {
  private x = new Float32Array(JOINT_COUNT * 3);
  private dx = new Float32Array(JOINT_COUNT * 3);
  private primed = false;

  /**
   * @param minCutoff Hz: lower is smoother when still.
   * @param beta how fast the cutoff rises with speed (per m/s).
   * @param dCutoff Hz: smoothing of the speed estimate.
   */
  constructor(
    private minCutoff = 1.6,
    private beta = 6,
    private dCutoff = 1.0,
  ) {}

  reset() {
    this.primed = false;
  }

  /** Filter `joints` in place. */
  apply(joints: Float32Array, dt: number) {
    if (!this.primed || dt <= 0) {
      this.x.set(joints);
      this.dx.fill(0);
      this.primed = true;
      return;
    }
    const ad = alpha(this.dCutoff, dt);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 3;
      // speed of this joint, smoothed
      let sp = 0;
      for (let k = 0; k < 3; k++) {
        const d = (joints[o + k] - this.x[o + k]) / dt;
        this.dx[o + k] += (d - this.dx[o + k]) * ad;
        sp += this.dx[o + k] * this.dx[o + k];
      }
      const a = alpha(this.minCutoff + this.beta * Math.sqrt(sp), dt);
      for (let k = 0; k < 3; k++) {
        this.x[o + k] += (joints[o + k] - this.x[o + k]) * a;
        joints[o + k] = this.x[o + k];
      }
    }
  }
}
