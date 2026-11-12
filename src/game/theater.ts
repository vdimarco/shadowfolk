/**
 * The room: paper wall, wooden frame, side tray with poke buttons,
 * and the GPU shadow pass that paints projected hand capsules into a texture.
 */
import {
  AddEquation,
  BoxGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  SrcColorFactor,
  SRGBColorSpace,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type WebGLRenderer,
} from '@iwsdk/core';
import { LIGHT, MAX_SEGS, type SegmentBuffer, SEGS_PER_HAND, WALL_CY, WALL_H, WALL_W, WALL_Z } from './silhouette.js';

// High resolution: each capsule draws only its own small quad, so the cost
// follows the shadow's area rather than the texture size.
const RT_W = 1536;
const RT_H = 1056;

const segVert = /* glsl */ `
attribute vec4 iA; // ax, ay, ar, as  (wall meters)
attribute vec4 iB; // bx, by, br, bs
uniform vec2 uWall;
varying vec2 vP;
varying vec4 vA;
varying vec4 vB;
void main() {
  vA = iA;
  vB = iB;
  if (iA.z <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // unused slot: off screen
    return;
  }
  float ea = iA.z + iA.w * 1.2;
  float eb = iB.z + iB.w * 1.2;
  vec2 lo = min(iA.xy - ea, iB.xy - eb);
  vec2 hi = max(iA.xy + ea, iB.xy + eb);
  vP = mix(lo, hi, position.xy * 0.5 + 0.5);
  gl_Position = vec4(vP / (uWall * 0.5), 0.0, 1.0);
}`;

const segFrag = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec4 vA;
varying vec4 vB;
void main() {
  vec2 pa = vP - vA.xy;
  vec2 ba = vB.xy - vA.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  float r = mix(vA.z, vB.z, h);
  float s = mix(vA.w, vB.w, h);
  float d = length(pa - ba * h) - r;
  float light = smoothstep(-s, s, d);
  gl_FragColor = vec4(light, light, light, 1.0);
}`;

const blurVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 9-tap Gaussian along one axis. Joins the capsules into one smooth shape.
const blurFrag = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  float c = texture2D(uSrc, vUv).r * 0.2270270;
  c += texture2D(uSrc, vUv + uStep * 1.3846154).r * 0.3162162;
  c += texture2D(uSrc, vUv - uStep * 1.3846154).r * 0.3162162;
  c += texture2D(uSrc, vUv + uStep * 3.2307692).r * 0.0702703;
  c += texture2D(uSrc, vUv - uStep * 3.2307692).r * 0.0702703;
  gl_FragColor = vec4(c, c, c, 1.0);
}`;

/** Two-pass Gaussian blur from one texture into a smaller target. */
class Blur {
  readonly out: WebGLRenderTarget;
  private tmp: WebGLRenderTarget;
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: ShaderMaterial;
  constructor(
    w: number,
    h: number,
    private radius: number,
  ) {
    const opts = { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false };
    this.out = new WebGLRenderTarget(w, h, opts);
    this.tmp = new WebGLRenderTarget(w, h, opts);
    this.mat = new ShaderMaterial({
      vertexShader: blurVert,
      fragmentShader: blurFrag,
      uniforms: { uSrc: { value: null }, uStep: { value: new Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }
  setSize(w: number, h: number) {
    this.out.setSize(w, h);
    this.tmp.setSize(w, h);
  }
  /** Caller has turned XR off and saved the render target. */
  run(renderer: WebGLRenderer, src: WebGLRenderTarget['texture']) {
    const w = this.out.width, h = this.out.height;
    this.mat.uniforms.uSrc.value = src;
    this.mat.uniforms.uStep.value.set(this.radius / w, 0);
    renderer.setRenderTarget(this.tmp);
    renderer.render(this.scene, this.cam);
    this.mat.uniforms.uSrc.value = this.tmp.texture;
    this.mat.uniforms.uStep.value.set(0, this.radius / h);
    renderer.setRenderTarget(this.out);
    renderer.render(this.scene, this.cam);
  }
}

/**
 * Paints a SegmentBuffer into a texture: one instanced quad per capsule.
 * The texture holds light (1 = no shadow); each capsule multiplies in its own
 * light, so overlaps join without seams, like real overlapping shadows.
 */
export class ShadowPass {
  readonly rt = new WebGLRenderTarget(RT_W, RT_H, { depthBuffer: false });
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private a: InstancedBufferAttribute;
  private b: InstancedBufferAttribute;
  private clear = new Color();
  private readonly n: number;
  /** The shadow with its capsules joined into one smooth shape (half size). */
  private smooth = new Blur(RT_W / 2, RT_H / 2, 1.0);
  /** A wide blur of the shadow, for the magic glow around it (quarter size). */
  private wide = new Blur(RT_W / 4, RT_H / 4, 1.6);
  get soft() {
    return this.smooth.out.texture;
  }
  get glow() {
    return this.wide.out.texture;
  }

  /** `segs`: how many capsules the pass can draw. */
  constructor(segs = MAX_SEGS) {
    this.n = segs;
    this.a = new InstancedBufferAttribute(new Float32Array(segs * 4), 4);
    this.b = new InstancedBufferAttribute(new Float32Array(segs * 4), 4);
    this.rt.texture.minFilter = LinearFilter;
    this.rt.texture.magFilter = LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.a.setUsage(DynamicDrawUsage);
    this.b.setUsage(DynamicDrawUsage);
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(2, 2);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('iA', this.a);
    geo.setAttribute('iB', this.b);
    geo.instanceCount = segs;
    const mat = new ShaderMaterial({
      vertexShader: segVert,
      fragmentShader: segFrag,
      uniforms: { uWall: { value: new Vector2(WALL_W, WALL_H) } },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: ZeroFactor,
      blendDst: SrcColorFactor,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  setSize(w: number, h: number) {
    this.rt.setSize(w, h);
    this.smooth.setSize(Math.round(w / 2), Math.round(h / 2));
    this.wide.setSize(Math.round(w / 4), Math.round(h / 4));
  }

  render(renderer: WebGLRenderer, buf: SegmentBuffer) {
    const d = buf.data;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const n = Math.min(this.n, d.length / 8);
    for (let i = 0; i < this.n; i++) {
      if (i >= n) {
        A[i * 4 + 2] = 0;
        continue;
      }
      const o = i * 8;
      A[i * 4] = d[o]; A[i * 4 + 1] = d[o + 1]; A[i * 4 + 2] = d[o + 2]; A[i * 4 + 3] = d[o + 3];
      B[i * 4] = d[o + 4]; B[i * 4 + 1] = d[o + 5]; B[i * 4 + 2] = d[o + 6]; B[i * 4 + 3] = d[o + 7];
    }
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
    const prevTarget = renderer.getRenderTarget();
    const xrOn = renderer.xr.enabled;
    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clear);
    const clearAlpha = renderer.getClearAlpha();
    renderer.xr.enabled = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.cam);
    this.smooth.run(renderer, this.rt.texture);
    this.wide.run(renderer, this.smooth.out.texture);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clear, clearAlpha);
    renderer.autoClear = autoClear;
    renderer.xr.enabled = xrOn;
  }
}

const wallVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const wallFrag = /* glsl */ `
precision highp float;
uniform sampler2D uLiveSoft;
uniform sampler2D uLiveGlow;
uniform sampler2D uTargetSoft;
uniform sampler2D uTargetGlow;
uniform float uMagic;        // 0..1: how close the player's shadow is to the shape
uniform vec3 uTargetAura;    // glow color of the awake creature (gold; cold red for the wolf)
uniform sampler2D uInk;
uniform vec2 uWall;
uniform vec2 uLamp;
uniform float uTime;
uniform float uLiveAlpha;
uniform float uTargetMode;   // 0 = golden guide line, 1 = solid creature
uniform float uTargetAlpha;
uniform float uScore;
uniform float uThreshold;
uniform float uHold;
uniform float uMeter;
uniform float uContrast;     // 0 = warm paper, 1 = high contrast
uniform vec4 uEye;           // creature eye: x, y, radius, alpha
uniform vec4 uDots[32];      // puzzle dots: x, y, radius, brightness
uniform int uDotCount;
uniform float uDotKind;      // 0 = raindrops, 1 = fireflies, 2 = battle (ink drops; w < 0: gold sparks)
uniform vec4 uRedEye;        // the wolf's eye: x, y, radius, glow (0..1)
uniform vec4 uFlash;         // battle: hurt (red), hit (gold), ward, web
uniform vec4 uFxPos;         // ward center xy, web center zw
uniform float uFlames;       // battle: lamp flames left (-1 = hidden)
varying vec2 vUv;

float cov(sampler2D t, vec2 uv) { return 1.0 - texture2D(t, uv).r; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec2 p = (vUv - 0.5) * uWall;
  float fiber = noise(p * vec2(30.0, 140.0)) * 0.05 + noise(p * 260.0) * 0.035;
  vec3 paper = mix(vec3(0.97, 0.86, 0.64), vec3(0.95, 0.95, 0.92), uContrast) - fiber * (1.0 - uContrast);
  float flicker = 0.95 + 0.03 * sin(uTime * 11.0) * sin(uTime * 6.7) + 0.02 * sin(uTime * 23.0);
  float d = length((p - uLamp) * vec2(0.8, 1.0));
  float lit = mix(1.2 / (1.0 + d * d * 3.0), 1.0, uContrast * 0.7) * flicker;
  vec3 col = paper * lit;

  // a storybook page: a fine gold double border just inside the edge
  vec2 e = uWall * 0.5 - abs(p);
  float edgeD = min(e.x, e.y);
  float border = smoothstep(0.0025, 0.0, abs(edgeD - 0.03)) + 0.6 * smoothstep(0.0015, 0.0, abs(edgeD - 0.04));
  col = mix(col, mix(vec3(0.85, 0.6, 0.25), vec3(0.6, 0.4, 0.1), uContrast) * lit * 1.1, border * 0.8);

  // ink overlay (text, book)
  vec4 ink = texture2D(uInk, vUv);
  col = mix(col, mix(vec3(0.2, 0.09, 0.26), vec3(0.05), uContrast) * lit, ink.a * 0.92);

  // smooth shadows: the capsules are blurred together, then given a clean, soft edge
  float liveSoft = cov(uLiveSoft, vUv);
  float live = smoothstep(0.28, 0.72, liveSoft) * uLiveAlpha;
  float liveGlow = cov(uLiveGlow, vUv) * uLiveAlpha;
  float tSoft = cov(uTargetSoft, vUv);
  float t0 = smoothstep(0.28, 0.72, tSoft);
  float tGlow = cov(uTargetGlow, vUv);
  // the guide: a fine golden line along the smooth outline of the sleeping creature
  float guide = exp(-pow((tSoft - 0.5) / 0.17, 2.0)) * (1.0 - uTargetMode) * uTargetAlpha;
  float ghost = t0 * (1.0 - uTargetMode) * uTargetAlpha * 0.1;
  float creature = t0 * uTargetMode * uTargetAlpha;

  vec3 shadowCol = mix(vec3(0.11, 0.07, 0.05), vec3(0.0), uContrast);
  col = mix(col, shadowCol * lit * 2.0, ghost);
  col = mix(col, shadowCol, max(live, creature) * 0.93);
  vec3 gold = mix(vec3(1.0, 0.72, 0.3), vec3(0.95, 0.55, 0.0), uContrast);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.4);
  col = mix(col, gold * (1.1 + uHold), guide * pulse * (0.55 + 0.45 * (1.0 - live)));

  // magic: a glow rises around your shadow as it gets close to the shape,
  // with sparks drifting up through it; an awake creature always glows
  float aura = clamp((liveGlow - live) * 2.4, 0.0, 1.0);
  float tAura = clamp((tGlow - t0) * 2.4, 0.0, 1.0) * uTargetMode * uTargetAlpha;
  float m = aura * uMagic;
  col += vec3(0.42, 0.3, 0.85) * aura * 0.035 * (1.0 - uContrast);
  col += gold * m * 0.6 * (0.85 + 0.15 * sin(uTime * 3.1));
  col += uTargetAura * tAura * 0.6 * (0.85 + 0.15 * sin(uTime * 2.3));
  m = max(m, tAura * step(0.5, uTargetAura.g));
  vec2 g = p * vec2(70.0, 70.0) + vec2(0.0, -uTime * 2.2);
  vec2 cell = floor(g);
  float h = hash(cell);
  vec2 sp = vec2(hash(cell + 1.7), hash(cell + 9.3)) - 0.5;
  float tw = pow(max(0.0, sin(uTime * (1.5 + h * 4.0) + h * 40.0)), 6.0);
  float spark = (1.0 - smoothstep(0.0, 0.11, length(fract(g) - 0.5 - sp * 0.6))) * step(0.78, h) * tw;
  col += vec3(1.0, 0.92, 0.65) * spark * clamp(m * 2.2, 0.0, 1.0) * 1.6;
  // holding the right shape: light flows into the shadow
  float flow = noise(p * 26.0 + vec2(uTime * 0.7, -uTime * 1.1));
  col = mix(col, gold * 1.15, live * uHold * uMagic * (0.12 + 0.18 * flow));

  // puzzle dots: ink-blue raindrops or glowing fireflies
  for (int i = 0; i < 32; i++) {
    if (i >= uDotCount) break;
    vec4 d = uDots[i];
    float dd = length(p - d.xy);
    if (uDotKind > 1.5) {
      if (d.w >= 0.0) {
        float a = 1.0 - smoothstep(d.z * 0.6, d.z, dd);
        col = mix(col, mix(vec3(0.06, 0.03, 0.08), vec3(0.0), uContrast), a * 0.92);
      } else {
        float core = 1.0 - smoothstep(d.z * 0.2, d.z * 0.55, dd);
        float halo = exp(-dd * dd / (d.z * d.z * 4.0));
        col += vec3(1.0, 0.78, 0.32) * (core * 1.2 + halo * 0.6) * -d.w;
      }
    } else if (uDotKind < 0.5) {
      float a = 1.0 - smoothstep(d.z * 0.75, d.z, length((p - d.xy) * vec2(1.0, 0.8)));
      col = mix(col, mix(vec3(0.16, 0.3, 0.55), vec3(0.05, 0.1, 0.2), uContrast) * lit, a * 0.9);
      float hl = 1.0 - smoothstep(0.0, d.z * 0.35, length(p - d.xy - vec2(-d.z * 0.3, d.z * 0.3)));
      col += vec3(0.7, 0.85, 1.0) * hl * a * 0.45;
    } else {
      float core = 1.0 - smoothstep(d.z * 0.25, d.z * 0.6, dd);
      float halo = exp(-dd * dd / (d.z * d.z * 6.0));
      col += vec3(1.0, 0.86, 0.38) * (core * 1.1 + halo * 0.55) * d.w;
    }
  }

  // a glowing eye on the awake creature
  if (uEye.w > 0.0) {
    float de = length((p - uEye.xy) * vec2(1.0, 1.5));
    float core = 1.0 - smoothstep(uEye.z * 0.45, uEye.z, de);
    float halo = exp(-de * de / (uEye.z * uEye.z * 6.0));
    col = mix(col, vec3(1.0, 0.86, 0.5) * 1.5, core * uEye.w);
    col += vec3(1.0, 0.55, 0.18) * halo * 0.45 * uEye.w;
  }

  // the Ink Wolf's eye: dark at rest, red and bright as it gathers to strike
  if (uRedEye.z > 0.0) {
    float de = length((p - uRedEye.xy) * vec2(1.0, 1.6));
    float core = 1.0 - smoothstep(uRedEye.z * 0.4, uRedEye.z, de);
    float halo = exp(-de * de / (uRedEye.z * uRedEye.z * (4.0 + 10.0 * uRedEye.w)));
    col = mix(col, mix(vec3(0.55, 0.12, 0.05), vec3(1.0, 0.25, 0.1) * 1.4, uRedEye.w), core);
    col += vec3(1.0, 0.15, 0.05) * halo * 0.7 * uRedEye.w;
  }

  // the starfish ward: a ring of gold light in front of the flames
  if (uFlash.z > 0.0) {
    float dr = length((p - uFxPos.xy) * vec2(1.6, 1.0));
    float ring = exp(-pow((dr - 0.2) / 0.012, 2.0)) * (0.7 + 0.3 * sin(uTime * 7.0 + p.y * 40.0));
    float fill = (1.0 - smoothstep(0.0, 0.2, dr)) * 0.12;
    col += gold * (ring + fill) * uFlash.z;
  }

  // the spider web on the wolf: spokes and rings of pale thread
  if (uFlash.w > 0.0) {
    vec2 q = p - uFxPos.zw;
    float r = length(q);
    if (r < 0.2) {
      float ang = atan(q.y, q.x);
      float spoke = 1.0 - smoothstep(0.0, 0.004, abs(sin(ang * 4.0)) * r);
      float ringw = 1.0 - smoothstep(0.0, 0.004, abs(fract(r * 22.0) - 0.5) / 22.0);
      float a = max(spoke, ringw) * (1.0 - smoothstep(0.15, 0.2, r));
      col = mix(col, vec3(0.92, 0.9, 0.84), a * 0.75 * uFlash.w);
    }
  }

  // three lamp flames in the lower left: the player's life
  if (uFlames >= 0.0) {
    for (int i = 0; i < 3; i++) {
      vec2 c = vec2(-0.7 + float(i) * 0.075, -0.38);
      // candle
      if (abs(p.x - c.x) < 0.012 && p.y < c.y - 0.018 && p.y > c.y - 0.085) col = mix(col, vec3(0.86, 0.8, 0.68) * lit, 0.95);
      float on = clamp(uFlames - float(i), 0.0, 1.0);
      vec2 f = (p - c) * vec2(1.0, 0.55);
      float sway = sin(uTime * 9.0 + float(i) * 2.1) * 0.003;
      f.x -= sway * (p.y - c.y + 0.02) * 30.0;
      float fd = length(f);
      float flame = 1.0 - smoothstep(0.008, 0.014, fd);
      float halo = exp(-fd * fd / 0.0012);
      col = mix(col, vec3(1.0, 0.9, 0.6) * 1.5, flame * on);
      col += vec3(1.0, 0.55, 0.18) * halo * 0.5 * on;
      // a spent flame leaves a curl of smoke
      float smoke = (1.0 - on) * exp(-pow((p.x - c.x - 0.006 * sin(p.y * 90.0 + uTime * 2.0)) / 0.003, 2.0)) * step(c.y - 0.015, p.y) * (1.0 - smoothstep(c.y, c.y + 0.07, p.y));
      col = mix(col, vec3(0.35, 0.3, 0.28), smoke * 0.5);
    }
  }

  // hits: a gold flash; hurts: the paper reddens at the edges
  float vign = smoothstep(0.35, 0.85, length(p / (uWall * 0.5)));
  col = mix(col, vec3(0.75, 0.08, 0.04), uFlash.x * (0.25 + 0.6 * vign));
  col += gold * uFlash.y * 0.3;

  // closeness meter along the bottom of the paper
  if (uMeter > 0.0) {
    float y0 = -uWall.y * 0.5 + 0.035;
    float w = 0.5;
    if (abs(p.y - y0) < 0.006 && abs(p.x) < w) {
      float x01 = (p.x + w) / (2.0 * w);
      float fill = step(x01, uScore);
      vec3 bar = mix(vec3(0.55, 0.4, 0.3), gold * (1.0 + uHold * 0.8), fill);
      col = mix(col, bar, 0.85 * uMeter);
    }
    float tx = -w + 2.0 * w * uThreshold;
    if (abs(p.x - tx) < 0.0025 && abs(p.y - y0) < 0.014) col = mix(col, vec3(0.2, 0.1, 0.05), uMeter);
  }
  // colors above are display (sRGB) values; no color-space conversion
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Button {
  id: string;
  /** Theater-space top center. */
  x: number;
  y: number;
  z: number;
  mesh: Mesh;
  pressed: boolean;
  cooldown: number;
}

export class Theater {
  readonly root = new Group();
  readonly wallMat: ShaderMaterial;
  readonly ink: HTMLCanvasElement;
  readonly inkTex: CanvasTexture;
  readonly labels: HTMLCanvasElement;
  readonly labelTex: CanvasTexture;
  readonly buttons: Button[] = [];
  readonly live = new ShadowPass();
  /** Guide and creatures; in the battle also the wolf and a flying spell, so room for four hands. */
  readonly target = new ShadowPass(SEGS_PER_HAND * 4);

  constructor() {
    this.root.name = 'Shadowfolk Theater';

    this.ink = document.createElement('canvas');
    this.ink.width = 1024;
    this.ink.height = 704;
    this.inkTex = new CanvasTexture(this.ink);
    this.inkTex.colorSpace = SRGBColorSpace;

    const lampProjY = LIGHT[1] - WALL_CY; // lamp sits straight back from this wall point
    this.wallMat = new ShaderMaterial({
      vertexShader: wallVert,
      fragmentShader: wallFrag,
      uniforms: {
        uLiveSoft: { value: this.live.soft },
        uLiveGlow: { value: this.live.glow },
        uTargetSoft: { value: this.target.soft },
        uTargetGlow: { value: this.target.glow },
        uMagic: { value: 0 },
        uTargetAura: { value: new Color(1.0, 0.72, 0.3) },
        uInk: { value: this.inkTex },
        uWall: { value: new Vector2(WALL_W, WALL_H) },
        uLamp: { value: new Vector2(LIGHT[0], lampProjY + 0.1) },
        uTime: { value: 0 },
        uLiveAlpha: { value: 1 },
        uTargetMode: { value: 0 },
        uTargetAlpha: { value: 0 },
        uScore: { value: 0 },
        uThreshold: { value: 0.7 },
        uHold: { value: 0 },
        uMeter: { value: 0 },
        uContrast: { value: 0 },
        uEye: { value: new Vector4(0, 0, 0.01, 0) },
        uDots: { value: new Float32Array(32 * 4) },
        uDotCount: { value: 0 },
        uDotKind: { value: 0 },
        uRedEye: { value: new Vector4(0, 0, 0, 0) },
        uFlash: { value: new Vector4(0, 0, 0, 0) },
        uFxPos: { value: new Vector4(0, 0, 0, 0) },
        uFlames: { value: -1 },
      },
    });
    const wall = new Mesh(new PlaneGeometry(WALL_W, WALL_H), this.wallMat);
    wall.position.set(0, WALL_CY, WALL_Z);
    wall.name = 'Paper Wall';
    this.root.add(wall);

    const wood = new MeshStandardMaterial({ color: new Color(0.13, 0.05, 0.12), roughness: 0.6, metalness: 0.1 });
    const frame = (w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.05), wood);
      m.position.set(x, WALL_CY + y, WALL_Z - 0.01);
      this.root.add(m);
    };
    const t = 0.06;
    frame(WALL_W + 2 * t, t, 0, WALL_H / 2 + t / 2);
    frame(WALL_W + 2 * t, t, 0, -WALL_H / 2 - t / 2);
    frame(t, WALL_H, -WALL_W / 2 - t / 2, 0);
    frame(t, WALL_H, WALL_W / 2 + t / 2, 0);
    // a gold edge around the paper, like a gilded storybook frame
    const gilt = new MeshBasicMaterial({ color: new Color(1.0, 0.74, 0.34), toneMapped: false });
    const edge = (w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.012), gilt);
      m.position.set(x, WALL_CY + y, WALL_Z + 0.02);
      this.root.add(m);
    };
    const g = 0.008;
    edge(WALL_W + 2 * g, g, 0, WALL_H / 2 + g / 2);
    edge(WALL_W + 2 * g, g, 0, -WALL_H / 2 - g / 2);
    edge(g, WALL_H, -WALL_W / 2 - g / 2, 0);
    edge(g, WALL_H, WALL_W / 2 + g / 2, 0);
    // legs to the floor
    for (const x of [-WALL_W / 2 - t / 2, WALL_W / 2 + t / 2]) {
      const leg = new Mesh(new BoxGeometry(t, 0.8, t), wood);
      leg.position.set(x, WALL_CY - WALL_H / 2 - 0.4, WALL_Z - 0.01);
      this.root.add(leg);
    }

    // the ground, stage and sky come from NightWorld (world.ts)

    // warm lamp light for the wood
    const lamp = new PointLight(new Color(1.0, 0.7, 0.4), 1.6, 4, 1.5);
    lamp.position.set(LIGHT[0], LIGHT[1], LIGHT[2]);
    this.root.add(lamp);
    const fill = new PointLight(new Color(1.0, 0.75, 0.5), 0.5, 3, 1.5);
    fill.position.set(0, WALL_CY, WALL_Z + 0.4);
    this.root.add(fill);

    // tray with three poke buttons, low and close, easy to reach when seated
    const trayY = -0.56;
    const trayZ = -0.34;
    const tray = new Mesh(new BoxGeometry(0.52, 0.03, 0.16), wood);
    tray.position.set(0, trayY, trayZ);
    this.root.add(tray);

    this.labels = document.createElement('canvas');
    this.labels.width = 1024;
    this.labels.height = 256;
    this.labelTex = new CanvasTexture(this.labels);
    this.labelTex.colorSpace = SRGBColorSpace;
    const labelPlane = new Mesh(
      new PlaneGeometry(0.5, 0.125),
      new MeshStandardMaterial({ map: this.labelTex, transparent: true, roughness: 1 }),
    );
    labelPlane.rotation.x = -Math.PI / 2;
    labelPlane.position.set(0, trayY + 0.0155, trayZ + 0.045);
    this.root.add(labelPlane);

    const ids = ['book', 'gentle', 'next'];
    ids.forEach((id, i) => {
      const x = (i - 1) * 0.16;
      const btn = new Mesh(
        new CylinderGeometry(0.026, 0.028, 0.016, 32),
        new MeshStandardMaterial({ color: new Color(0.75, 0.5, 0.22), roughness: 0.35, metalness: 0.4 }),
      );
      btn.position.set(x, trayY + 0.023, trayZ - 0.025);
      btn.name = `Button ${id}`;
      this.root.add(btn);
      this.buttons.push({ id, x, y: trayY + 0.031, z: trayZ - 0.025, mesh: btn, pressed: false, cooldown: 0 });
    });
  }

  drawLabels(labels: Record<string, string>) {
    const g = this.labels.getContext('2d')!;
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = 'rgba(250, 225, 180, 0.95)';
    g.font = '600 58px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['book', 'gentle', 'next'].forEach((id, i) => {
      g.fillText(labels[id] ?? '', 512 + (i - 1) * 328, 170);
    });
    this.labelTex.needsUpdate = true;
  }

  /** Light a button for a short moment after a press. */
  flash(id: string, on: boolean) {
    const b = this.buttons.find((x) => x.id === id);
    if (!b) return;
    const m = b.mesh.material as MeshStandardMaterial;
    m.emissive.setRGB(on ? 0.6 : 0, on ? 0.35 : 0, on ? 0.1 : 0);
    b.mesh.position.y = b.y - 0.008 + (on ? -0.006 : 0);
  }
}
