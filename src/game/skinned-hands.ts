/**
 * Real-looking hands for desktop demo and capture modes: the standard WebXR
 * generic hand model, with every bone placed from our 25 joint positions.
 * WebXR joint frames: -Z runs along the bone toward the tip, +Y faces out of
 * the back of the hand. In XR the headset draws its own hands instead.
 */
import {
  AssetManager,
  type Bone,
  Color,
  Group,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from '@iwsdk/core';
import { type Handedness, JOINT_COUNT, JOINT_NAMES } from './hand-model.js';

/** For each joint, the joint its bone points toward (-1: use the parent instead). */
const NEXT = [11, 2, 3, 4, -1, 6, 7, 8, 9, -1, 11, 12, 13, 14, -1, 16, 17, 18, 19, -1, 21, 22, 23, 24, -1];

interface Rig {
  root: Object3D;
  bones: (Bone | null)[];
}

export class SkinnedHands {
  readonly root = new Group();
  readonly ready: Promise<boolean>;
  private rigs: Partial<Record<Handedness, Rig>> = {};
  private a = new Vector3();
  private d = new Vector3();
  private side = new Vector3();
  private y = new Vector3();
  private x = new Vector3();
  private z = new Vector3();
  private m = new Matrix4();

  constructor() {
    this.root.name = 'Skinned Hands';
    const skin = new MeshStandardMaterial({ color: new Color(0.72, 0.5, 0.38), roughness: 0.55, metalness: 0 });
    const load = async (hand: Handedness) => {
      const gltf = await AssetManager.loadGLTFById(`hand-${hand}`);
      const model = gltf.scene;
      model.traverse((o) => {
        const sm = o as SkinnedMesh;
        if (sm.isSkinnedMesh) {
          sm.material = skin;
          sm.frustumCulled = false;
        }
      });
      const bones = JOINT_NAMES.map((n) => (model.getObjectByName(n) as Bone | undefined) ?? null);
      model.visible = false;
      this.root.add(model);
      this.rigs[hand] = { root: model, bones };
    };
    this.ready = Promise.all([load('left'), load('right')])
      .then(() => true)
      .catch((e) => {
        console.warn('[shadowfolk] hand model failed to load; using capsule hands', e);
        return false;
      });
  }

  get loaded() {
    return !!this.rigs.left && !!this.rigs.right;
  }

  /** joints: theater-space 75-float arrays, or null to hide that hand. */
  update(left: Float32Array | null, right: Float32Array | null) {
    this.pose('left', left);
    this.pose('right', right);
  }

  private pose(hand: Handedness, j: Float32Array | null) {
    const rig = this.rigs[hand];
    if (!rig) return;
    rig.root.visible = !!j;
    if (!j) return;
    // radial axis: from the little-finger knuckle toward the index knuckle
    this.side.set(j[18] - j[63], j[19] - j[64], j[20] - j[65]).normalize();
    for (let i = 0; i < JOINT_COUNT; i++) {
      const bone = rig.bones[i];
      if (!bone) continue;
      this.a.set(j[i * 3], j[i * 3 + 1], j[i * 3 + 2]);
      const n = NEXT[i];
      if (n >= 0) this.d.set(j[n * 3], j[n * 3 + 1], j[n * 3 + 2]).sub(this.a);
      else this.d.set(j[i * 3] - j[i * 3 - 3], j[i * 3 + 1] - j[i * 3 - 2], j[i * 3 + 2] - j[i * 3 - 1]);
      this.d.normalize();
      // back of the hand: right hand d x side, left hand side x d
      if (hand === 'right') this.y.crossVectors(this.d, this.side);
      else this.y.crossVectors(this.side, this.d);
      if (this.y.lengthSq() < 1e-6) this.y.set(0, 1, 0);
      this.z.copy(this.d).negate();
      this.y.addScaledVector(this.z, -this.y.dot(this.z)).normalize();
      this.x.crossVectors(this.y, this.z);
      this.m.makeBasis(this.x, this.y, this.z);
      bone.quaternion.setFromRotationMatrix(this.m);
      bone.position.copy(this.a);
    }
  }
}
