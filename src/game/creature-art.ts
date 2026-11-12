/**
 * Illustrated creatures (Higgsfield art in public/creatures): when a shadow
 * wakes, its constellation creature dissolves in on the paper where the
 * shadow was, and acts out its motion. The battle uses the wolf and the
 * creatures as flying spells.
 */
import { AssetManager, Mesh, NoColorSpace, PlaneGeometry, ShaderMaterial, type Texture, Vector3 } from '@iwsdk/core';
import { WALL_CY, WALL_Z } from './silhouette.js';

export interface ArtInfo {
  /** Image width / height. */
  aspect: number;
  /** Height on the paper at scale 1 (meters). */
  height: number;
  /** Draw mirrored (the art faces right; flip when the creature moves left). */
  flip?: boolean;
}

/** Sizes come from tools/prep-creatures.py. */
export const ART: Record<string, ArtInfo> = {
  moth: { aspect: 1.037, height: 0.54 },
  hare: { aspect: 0.655, height: 0.62 },
  crocodile: { aspect: 1.91, height: 0.35, flip: true },
  dog: { aspect: 1.09, height: 0.54 },
  bird: { aspect: 1.077, height: 0.57 },
  deer: { aspect: 0.77, height: 0.68 },
  fox: { aspect: 0.656, height: 0.62 },
  butterfly: { aspect: 1.162, height: 0.51 },
  owl: { aspect: 0.681, height: 0.62 },
  spider: { aspect: 0.977, height: 0.57 },
  wolf: { aspect: 1.435, height: 0.52 },
};
/** Where the wolf's eye is in its image (u, v from the bottom left). */
export const WOLF_EYE_UV: [number, number] = [0.148, 0.585];

const tmp = new Vector3();

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uAlpha;
uniform float uReveal;   // 0..1: the creature dissolves in from sparks
uniform float uFlip;
uniform float uFlash;    // a hit: the creature flashes white
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 uv = vec2(uFlip > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec4 c = texture2D(uMap, uv);
  // dissolve: grows from the middle out, with a gold burning edge at the front
  float n = noise(vUv * 14.0) * 0.6 + length(vUv - 0.5) * 0.8;
  float front = uReveal * 1.5 - n;
  float vis = smoothstep(0.0, 0.06, front);
  float burn = (smoothstep(-0.02, 0.04, front) - smoothstep(0.04, 0.16, front)) * step(0.01, c.a);
  vec3 col = c.rgb * (1.0 + 0.08 * sin(uTime * 3.0 + vUv.x * 9.0));
  col += vec3(1.0, 0.82, 0.45) * burn * 2.2;
  col = mix(col, vec3(1.0), uFlash * c.a);
  float a = max(c.a * vis, burn * 0.9) * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}`;

/** One creature drawn on the paper. */
export class ArtSprite {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  id = '';
  constructor(renderOrder = 5) {
    this.mat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uMap: { value: null },
        uAlpha: { value: 0 },
        uReveal: { value: 1 },
        uFlip: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** Show creature `id` (if its art has loaded). Returns false if there is no art. */
  show(id: string): boolean {
    const tex = CreatureArt.texture(id);
    if (!tex) {
      this.hide();
      return false;
    }
    this.id = id;
    this.mat.uniforms.uMap.value = tex;
    this.mesh.visible = true;
    return true;
  }

  hide() {
    this.mesh.visible = false;
    this.id = '';
  }

  /**
   * Place it on the paper: center (x, y) in wall meters, height h, turn in
   * radians, stretch sx/sy, and whether to mirror it.
   */
  place(x: number, y: number, h: number, rot = 0, sx = 1, sy = 1, mirror = false) {
    const info = ART[this.id];
    if (!info) return;
    this.mesh.position.set(x, WALL_CY + y, WALL_Z + 0.006);
    this.mesh.rotation.set(0, 0, rot);
    this.mesh.scale.set(h * info.aspect * sx, h * sy, 1);
    this.mat.uniforms.uFlip.value = (info.flip ? 1 : 0) !== (mirror ? 1 : 0) ? 1 : 0;
  }

  /** Wall position of a point given in image coordinates (u, v from the bottom left). */
  pointAt(u: number, v: number, out: [number, number]): [number, number] {
    const flip = this.mat.uniforms.uFlip.value > 0.5;
    this.mesh.updateMatrix();
    tmp.set((flip ? 1 - u : u) - 0.5, v - 0.5, 0).applyMatrix4(this.mesh.matrix);
    out[0] = tmp.x;
    out[1] = tmp.y - WALL_CY;
    return out;
  }

  set(alpha: number, reveal = 1, time = 0, flash = 0) {
    const u = this.mat.uniforms;
    u.uAlpha.value = alpha;
    u.uReveal.value = reveal;
    u.uTime.value = time;
    u.uFlash.value = flash;
    this.mesh.visible = alpha > 0.001 && !!this.id;
  }
}

/** Loads every creature image once, in the background; the game falls back to shadow shapes until they arrive. */
export class CreatureArt {
  private static textures = new Map<string, Texture>();
  private static started = false;

  static load() {
    if (this.started) return;
    this.started = true;
    for (const id of Object.keys(ART)) {
      AssetManager.loadTexture(`./creatures/${id}.webp`, `creature-${id}`)
        .then((t) => {
          // the art holds display colors; the paper's shaders draw them as they are
          t.colorSpace = NoColorSpace;
          t.anisotropy = 4;
          t.needsUpdate = true;
          this.textures.set(id, t);
        })
        .catch((e) => console.warn('[shadowfolk] creature art failed to load', id, e));
    }
  }

  static texture(id: string): Texture | null {
    return this.textures.get(id) ?? null;
  }

  static has(id: string) {
    return this.textures.has(id);
  }
}

