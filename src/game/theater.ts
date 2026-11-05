/**
 * The room: paper wall, wooden frame, side tray with poke buttons,
 * and the GPU shadow pass that paints projected hand capsules into a texture.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from '@iwsdk/core';
import { LIGHT, MAX_SEGS, type SegmentBuffer, WALL_CY, WALL_H, WALL_W, WALL_Z } from './silhouette.js';

const RT_W = 512;
const RT_H = 352;

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const shadowFrag = /* glsl */ `
precision highp float;
uniform vec4 uSeg[${MAX_SEGS * 2}];
uniform vec2 uWall;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uWall;
  float cov = 0.0;
  for (int i = 0; i < ${MAX_SEGS}; i++) {
    vec4 a = uSeg[i * 2];
    if (a.z <= 0.0) continue;
    vec4 b = uSeg[i * 2 + 1];
    vec2 pa = p - a.xy;
    vec2 ba = b.xy - a.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    float r = mix(a.z, b.z, h);
    float s = mix(a.w, b.w, h);
    float d = length(pa - ba * h) - r;
    cov = max(cov, 1.0 - smoothstep(-s, s, d));
  }
  gl_FragColor = vec4(cov, cov, cov, 1.0);
}`;

/** Paints a SegmentBuffer into a texture. */
export class ShadowPass {
  readonly rt = new WebGLRenderTarget(RT_W, RT_H, { depthBuffer: false });
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: ShaderMaterial;
  private seg = new Float32Array(MAX_SEGS * 8);

  constructor() {
    this.rt.texture.minFilter = LinearFilter;
    this.rt.texture.magFilter = LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.mat = new ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: shadowFrag,
      uniforms: {
        uSeg: { value: this.seg },
        uWall: { value: new Vector2(WALL_W, WALL_H) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(renderer: WebGLRenderer, buf: SegmentBuffer) {
    this.seg.set(buf.data);
    const prevTarget = renderer.getRenderTarget();
    const xrOn = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prevTarget);
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
varying vec2 vUv;

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

  float live = texture2D(uLive, vUv).r * uLiveAlpha;
  vec2 px = vec2(2.0 / 512.0, 2.0 / 352.0);
  float t0 = texture2D(uTarget, vUv).r;
  float edge = abs(t0 - texture2D(uTarget, vUv + vec2(px.x, 0.0)).r)
             + abs(t0 - texture2D(uTarget, vUv - vec2(px.x, 0.0)).r)
             + abs(t0 - texture2D(uTarget, vUv + vec2(0.0, px.y)).r)
             + abs(t0 - texture2D(uTarget, vUv - vec2(0.0, px.y)).r);
  float guide = clamp(edge * 1.5, 0.0, 1.0) * (1.0 - uTargetMode) * uTargetAlpha;
  float ghost = t0 * (1.0 - uTargetMode) * uTargetAlpha * 0.1;
  float creature = t0 * uTargetMode * uTargetAlpha;

  vec3 shadowCol = mix(vec3(0.11, 0.07, 0.05), vec3(0.0), uContrast);
  col = mix(col, shadowCol * lit * 2.0, ghost);
  col = mix(col, shadowCol, max(live, creature) * 0.93);
  vec3 gold = mix(vec3(1.0, 0.72, 0.3), vec3(0.95, 0.55, 0.0), uContrast);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.4);
  col = mix(col, gold * (1.1 + uHold), guide * pulse * (0.55 + 0.45 * (1.0 - live)));

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

    const floor = new Mesh(
      new PlaneGeometry(8, 8),
      new MeshStandardMaterial({ color: new Color(0.05, 0.035, 0.03), roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.2, -1);
    this.root.add(floor);

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
