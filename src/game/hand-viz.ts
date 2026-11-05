/**
 * Visible hands for desktop demo and capture modes. In XR the headset
 * shows its own hand models, so this stays hidden there.
 */
import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { CAPSULES } from './silhouette.js';

const N = CAPSULES.length;
const UP = new Vector3(0, 1, 0);

export class HandViz {
  readonly root = new Group();
  private bones: InstancedMesh;
  private caps: InstancedMesh;
  private m = new Matrix4();
  private q = new Quaternion();
  private a = new Vector3();
  private b = new Vector3();
  private d = new Vector3();
  private s = new Vector3();
  private mid = new Vector3();

  constructor() {
    const mat = new MeshStandardMaterial({ color: new Color(0.6, 0.4, 0.3), roughness: 0.6 });
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 14, 1, true), mat, N * 2);
    this.caps = new InstancedMesh(new SphereGeometry(1, 14, 10), mat, N * 4);
    this.bones.frustumCulled = false;
    this.caps.frustumCulled = false;
    this.root.add(this.bones, this.caps);
    this.root.name = 'Simulated Hands';
    this.root.visible = false;
  }

  /** joints: theater-space 75-float arrays; null hides that hand. */
  update(hands: (Float32Array | null)[]) {
    let bi = 0;
    let ci = 0;
    for (const j of hands) {
      if (!j) continue;
      for (const [ja, jb, ra, rb] of CAPSULES) {
        this.a.set(j[ja * 3], j[ja * 3 + 1], j[ja * 3 + 2]);
        this.b.set(j[jb * 3], j[jb * 3 + 1], j[jb * 3 + 2]);
        this.d.subVectors(this.b, this.a);
        const len = this.d.length();
        const r = (ra + rb) * 0.5;
        if (len > 1e-5) {
          this.q.setFromUnitVectors(UP, this.d.multiplyScalar(1 / len));
          this.s.set(r, len, r);
          this.mid.copy(this.a).lerp(this.b, 0.5);
          this.m.compose(this.mid, this.q, this.s);
          this.bones.setMatrixAt(bi++, this.m);
        }
        this.q.identity();
        this.m.compose(this.a, this.q, this.s.set(ra, ra, ra));
        this.caps.setMatrixAt(ci++, this.m);
        this.m.compose(this.b, this.q, this.s.set(rb, rb, rb));
        this.caps.setMatrixAt(ci++, this.m);
      }
    }
    this.bones.count = bi;
    this.caps.count = ci;
    this.bones.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.root.visible = bi > 0;
  }
}
