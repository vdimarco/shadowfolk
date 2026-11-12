/**
 * 3D constellation creatures (Meshy models made from the Higgsfield art, in
 * public/creatures/3d). When a shadow wakes, its illustration appears on the
 * paper and then lifts off as a small 3D figure that steps out toward the
 * player, turns to look at them, hovers, and fades back into the night.
 * Models load one at a time, when their level starts; without one the 2D
 * illustration plays alone.
 */
import { AssetManager, Box3, Group, Mesh, MeshStandardMaterial, type Object3D, Vector3 } from '@iwsdk/core';
import { WALL_CY, WALL_Z } from './silhouette.js';

/** Creatures that have a 3D model (the Ink Wolf stays on the paper). */
const MODELS = new Set(['moth', 'hare', 'crocodile', 'dog', 'bird', 'deer', 'fox', 'butterfly', 'owl', 'spider']);
/** Height of each figure in the room (meters). */
const HEIGHT = 0.27;
/** Where the figure stands once it has stepped out (feet height, theater space). */
const STAND_Y = -0.3;

const box = new Box3();
const size = new Vector3();
const center = new Vector3();

export class Creature3D {
  readonly root = new Group();
  private models = new Map<string, Object3D>();
  private loading = new Set<string>();
  private current: Object3D | null = null;
  private mats: MeshStandardMaterial[] = [];
  private from = new Vector3();

  constructor() {
    this.root.name = 'Creature 3D';
  }

  /** Start loading a creature's model in the background (call when its level starts). */
  preload(id: string) {
    if (!MODELS.has(id) || this.models.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    AssetManager.loadGLTF(`./creatures/3d/${id}.glb`, `creature3d-${id}`)
      .then((gltf) => {
        const m = gltf.scene;
        // normalize: centered on x/z, feet at y = 0, HEIGHT tall
        box.setFromObject(m);
        box.getSize(size);
        box.getCenter(center);
        const s = HEIGHT / Math.max(size.y, 1e-3);
        const holder = new Group();
        m.position.set(-center.x, -box.min.y, -center.z);
        holder.add(m);
        holder.scale.setScalar(s);
        // self-lit, so the night sky texture glows in the dark theater
        m.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as MeshStandardMaterial;
          if (mat && mat.isMeshStandardMaterial) {
            mat.emissive.setRGB(1, 1, 1);
            mat.emissiveMap = mat.map;
            mat.emissiveIntensity = 0.75;
            mat.roughness = 0.6;
            mat.metalness = 0.1;
            mat.transparent = true;
            mat.depthWrite = true;
            mat.needsUpdate = true;
          }
        });
        holder.visible = false;
        this.root.add(holder);
        this.models.set(id, holder);
      })
      .catch((e) => console.warn('[shadowfolk] 3D creature failed to load', id, e))
      .finally(() => this.loading.delete(id));
  }

  /** Begin the step-out for `id` from wall point (x, y). Returns false if its model is not ready. */
  begin(id: string, x: number, y: number): boolean {
    this.end();
    const m = this.models.get(id);
    if (!m) return false;
    this.current = m;
    this.mats = [];
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) this.mats.push(mesh.material as MeshStandardMaterial);
    });
    this.from.set(x, WALL_CY + y - HEIGHT * 0.5, WALL_Z + 0.02);
    m.visible = true;
    return true;
  }

  /**
   * t: seconds since the wake began. The figure grows out of the paper from
   * t = 0.9, steps toward the player, turns to face them, hovers, and fades
   * out before `total`.
   */
  update(t: number, total: number, time: number) {
    const m = this.current;
    if (!m) return;
    const grow = smooth((t - 0.9) / 0.8);
    const step = smooth((t - 1.1) / 1.2);
    const fade = 1 - smooth((t - (total - 0.9)) / 0.8);
    const k = m.userData.k ?? (m.userData.k = m.scale.x);
    m.scale.setScalar(k * Math.max(0.001, grow));
    // out of the paper toward the player, rising a little, with a gentle bob
    // out of the paper toward the player, gliding to the middle of the stage
    // a little below eye level, with a gentle bob
    m.position.set(
      this.from.x * (1 - step),
      this.from.y + (STAND_Y - this.from.y) * step + Math.sin(time * 2.2) * 0.012 * step,
      this.from.z + step * 0.6,
    );
    // first in profile, like the shadow, then turning to look at the player
    m.rotation.set(0, (-Math.PI / 2) * (1 - step) + Math.sin(time * 0.9) * 0.25 * step, 0);
    const a = grow * fade;
    for (const mat of this.mats) {
      mat.opacity = a;
      mat.emissiveIntensity = 0.75 + 0.5 * (1 - step) + 0.15 * Math.sin(time * 3);
    }
    m.visible = a > 0.01;
  }

  end() {
    if (this.current) {
      this.current.visible = false;
      const k = this.current.userData.k;
      if (k) this.current.scale.setScalar(k);
    }
    this.current = null;
  }

  get active() {
    return !!this.current;
  }
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
