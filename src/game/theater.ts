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
import { LIGHT, MAX_SEGS, type SegmentBuffer, WALL_CY, WALL_H, WALL_W, WALL_Z } from './silhouette.js';

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

/**
 * Paints a SegmentBuffer into a texture: one instanced quad per capsule.
 * The texture holds light (1 = no shadow); each capsule multiplies in its own
 * light, so overlaps join without seams, like real overlapping shadows.
 */
export class ShadowPass {
  readonly rt = new WebGLRenderTarget(RT_W, RT_H, { depthBuffer: false });
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private a = new InstancedBufferAttribute(new Float32Array(MAX_SEGS * 4), 4);
  private b = new InstancedBufferAttribute(new Float32Array(MAX_SEGS * 4), 4);
  private clear = new Color();

  constructor() {
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
    geo.instanceCount = MAX_SEGS;
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
  }

  render(renderer: WebGLRenderer, buf: SegmentBuffer) {
    const d = buf.data;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    for (let i = 0; i < MAX_SEGS; i++) {
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
uniform sampler2D uLive;
uniform sampler2D uTarget;
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
uniform float uDotKind;      // 0 = raindrops, 1 = fireflies
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

  // ink overlay (text, book)
  vec4 ink = texture2D(uInk, vUv);
  col = mix(col, mix(vec3(0.32, 0.18, 0.1), vec3(0.05), uContrast) * lit, ink.a * 0.9);

  float live = cov(uLive, vUv) * uLiveAlpha;
  vec2 px = vec2(2.0 / 512.0, 2.0 / 352.0);
  float t0 = cov(uTarget, vUv);
  float edge = abs(t0 - cov(uTarget, vUv + vec2(px.x, 0.0)))
             + abs(t0 - cov(uTarget, vUv - vec2(px.x, 0.0)))
             + abs(t0 - cov(uTarget, vUv + vec2(0.0, px.y)))
             + abs(t0 - cov(uTarget, vUv - vec2(0.0, px.y)));
  float guide = clamp(edge * 1.5, 0.0, 1.0) * (1.0 - uTargetMode) * uTargetAlpha;
  float ghost = t0 * (1.0 - uTargetMode) * uTargetAlpha * 0.1;
  float creature = t0 * uTargetMode * uTargetAlpha;

  vec3 shadowCol = mix(vec3(0.11, 0.07, 0.05), vec3(0.0), uContrast);
  col = mix(col, shadowCol * lit * 2.0, ghost);
  col = mix(col, shadowCol, max(live, creature) * 0.93);
  vec3 gold = mix(vec3(1.0, 0.72, 0.3), vec3(0.95, 0.55, 0.0), uContrast);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.4);
  col = mix(col, gold * (1.1 + uHold), guide * pulse * (0.55 + 0.45 * (1.0 - live)));

  // puzzle dots: ink-blue raindrops or glowing fireflies
  for (int i = 0; i < 32; i++) {
    if (i >= uDotCount) break;
    vec4 d = uDots[i];
    float dd = length(p - d.xy);
    if (uDotKind < 0.5) {
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
  readonly target = new ShadowPass();

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
        uLive: { value: this.live.rt.texture },
        uTarget: { value: this.target.rt.texture },
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
      },
    });
    const wall = new Mesh(new PlaneGeometry(WALL_W, WALL_H), this.wallMat);
    wall.position.set(0, WALL_CY, WALL_Z);
    wall.name = 'Paper Wall';
    this.root.add(wall);

    const wood = new MeshStandardMaterial({ color: new Color(0.16, 0.085, 0.05), roughness: 0.7 });
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
