/**
 * The night world around the shadow theater: a starry sky with a moon, a
 * forest silhouette, grass, a wooden stage with velvet curtains, paper
 * lanterns, and fireflies drifting around the player.
 * Everything is procedural and cheap: a handful of draw calls, no textures
 * except two small canvas sprites, and all motion in shaders.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { WALL_CY, WALL_H, WALL_W, WALL_Z } from './silhouette.js';

const FLOOR_Y = -1.2;
const STAGE_TOP = -0.98;
const HORIZON = new Color(0.07, 0.09, 0.17);

let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const skyFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uHorizon;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);
  vec3 zenith = vec3(0.008, 0.01, 0.03);
  vec3 col = mix(uHorizon, zenith, smoothstep(0.0, 0.55, up));
  col = mix(col, uHorizon * 0.5, smoothstep(0.0, -0.2, up));
  // a faint band of the Milky Way
  float band = exp(-pow((d.y - 0.35 * d.x) * 3.0, 2.0)) * smoothstep(-0.05, 0.3, up);
  col += vec3(0.05, 0.05, 0.08) * band;
  // stars: one candidate per cell, a few levels of brightness, gentle twinkle
  vec2 uv = vec2(atan(d.z, d.x), asin(up));
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 120.0 : 260.0;
    vec2 g = uv * vec2(sc, sc * 0.5);
    vec2 cell = floor(g);
    float h = hash(cell + float(k) * 17.0);
    if (h > 0.985 && up > 0.02) {
      vec2 c = vec2(hash(cell + 3.1), hash(cell + 7.7));
      float dist = length(fract(g) - c);
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 3.0) + h * 80.0);
      float b = (h - 0.985) / 0.015;
      col += vec3(0.85, 0.9, 1.0) * smoothstep(0.12, 0.0, dist) * b * tw * (k == 0 ? 1.2 : 0.7);
    }
  }
  // the moon: a soft crescent with a halo
  vec3 m = normalize(vec3(-0.55, 0.42, -0.72));
  float md = acos(clamp(dot(d, m), -1.0, 1.0));
  vec3 m2 = normalize(m + vec3(0.018, 0.012, 0.0));
  float md2 = acos(clamp(dot(d, m2), -1.0, 1.0));
  float disc = smoothstep(0.034, 0.03, md) * (1.0 - smoothstep(0.03, 0.026, md2) * 0.92);
  col += vec3(1.0, 0.95, 0.82) * disc * 1.2;
  col += vec3(0.25, 0.3, 0.45) * exp(-md * md * 90.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

const groundFrag = /* glsl */ `
precision highp float;
uniform vec3 uHorizon;
varying vec3 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float r = length(vP.xz);
  float n = noise(vP.xz * 1.5) * 0.6 + noise(vP.xz * 9.0) * 0.4;
  vec3 grass = mix(vec3(0.012, 0.03, 0.02), vec3(0.03, 0.06, 0.035), n);
  // warm spill from the theater near the stage
  float warm = exp(-dot(vP.xz - vec2(0.0, -1.3), vP.xz - vec2(0.0, -1.3)) * 0.35);
  grass += vec3(0.16, 0.09, 0.03) * warm;
  vec3 col = mix(grass, uHorizon * 0.7, smoothstep(6.0, 40.0, r));
  gl_FragColor = vec4(col, 1.0);
}`;
const groundVert = /* glsl */ `
varying vec3 vP;
void main() {
  vP = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;

const flyVert = /* glsl */ `
uniform float uTime;
attribute float aPhase;
varying float vGlow;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.35 + aPhase * 6.0) * 0.35;
  p.y += sin(uTime * 0.5 + aPhase * 9.0) * 0.18;
  p.z += cos(uTime * 0.3 + aPhase * 4.0) * 0.35;
  vGlow = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.8 + aPhase) + aPhase * 40.0), 3.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 70.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const flyFrag = /* glsl */ `
precision highp float;
varying float vGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = exp(-d * d * 30.0) + exp(-d * d * 180.0);
  gl_FragColor = vec4(vec3(1.0, 0.85, 0.35) * a * vGlow, 1.0);
}`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,150,1)');
  grd.addColorStop(0.3, 'rgba(255,170,80,0.45)');
  grd.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A hanging curtain panel with soft vertical folds. */
function curtain(width: number, height: number, folds: number, mat: MeshStandardMaterial) {
  const geo = new PlaneGeometry(width, height, folds * 6, 8);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // folds get deeper toward the floor
    const depth = 0.035 + 0.025 * (0.5 - y / height);
    pos.setZ(i, Math.sin((x / width) * Math.PI * 2 * folds) * depth);
  }
  geo.computeVertexNormals();
  return new Mesh(geo, mat);
}

export class NightWorld {
  readonly root = new Group();
  private timed: ShaderMaterial[] = [];
  private lanterns: { m: Mesh; s: Sprite; phase: number }[] = [];

  constructor() {
    this.root.name = 'Night World';
    seed = 3;

    // sky dome
    const skyMat = new ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: { uTime: { value: 0 }, uHorizon: { value: HORIZON } },
      side: BackSide,
      depthWrite: false,
    });
    this.timed.push(skyMat);
    const sky = new Mesh(new SphereGeometry(70, 32, 16), skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.root.add(sky);

    // grass, fading into the horizon
    const ground = new Mesh(
      new CircleGeometry(60, 48),
      new ShaderMaterial({ vertexShader: groundVert, fragmentShader: groundFrag, uniforms: { uHorizon: { value: HORIZON } } }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = FLOOR_Y;
    this.root.add(ground);

    // forest silhouette: two rings of pines, never in front of the stage
    const pine = new ConeGeometry(1, 1, 7);
    pine.translate(0, 0.5, 0);
    const treeMat = new MeshBasicMaterial({ color: new Color(0.012, 0.016, 0.03) });
    const N = 140;
    const trees = new InstancedMesh(pine, treeMat, N);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 14 + rnd() * 26;
      const h = 5 + rnd() * 8;
      p.set(Math.sin(a) * r, FLOOR_Y - 0.2, Math.cos(a) * r);
      s.set(h * (0.22 + rnd() * 0.12), h, h * (0.22 + rnd() * 0.12));
      m.compose(p, q, s);
      trees.setMatrixAt(i, m);
    }
    this.root.add(trees);

    // the stage: a wooden deck under the screen, reaching toward the player
    const wood = new MeshStandardMaterial({ color: new Color(0.22, 0.12, 0.06), roughness: 0.8 });
    const darkWood = new MeshStandardMaterial({ color: new Color(0.11, 0.055, 0.03), roughness: 0.7 });
    const deck = new Mesh(new BoxGeometry(3.4, STAGE_TOP - FLOOR_Y, 1.2), wood);
    deck.position.set(0, (STAGE_TOP + FLOOR_Y) / 2, WALL_Z - 0.2);
    this.root.add(deck);
    // proscenium: posts and a top beam around the screen
    const top = WALL_CY + WALL_H / 2 + 0.42;
    for (const x of [-1.62, 1.62]) {
      const post = new Mesh(new BoxGeometry(0.12, top - STAGE_TOP, 0.12), darkWood);
      post.position.set(x, (top + STAGE_TOP) / 2, WALL_Z + 0.06);
      this.root.add(post);
    }
    const beam = new Mesh(new BoxGeometry(3.44, 0.14, 0.14), darkWood);
    beam.position.set(0, top, WALL_Z + 0.06);
    this.root.add(beam);

    // velvet curtains drawn open on both sides, and a valance on top
    const velvet = new MeshStandardMaterial({ color: new Color(0.16, 0.012, 0.025), roughness: 1, side: DoubleSide });
    const ch = top - STAGE_TOP - 0.07;
    for (const side of [-1, 1]) {
      const c = curtain(0.42, ch, 3, velvet);
      c.position.set(side * 1.36, STAGE_TOP + ch / 2, WALL_Z + 0.12);
      this.root.add(c);
    }
    const valance = curtain(3.3, 0.22, 14, velvet);
    valance.position.set(0, top - 0.12, WALL_Z + 0.15);
    this.root.add(valance);
    // gold trim on the valance
    const trim = new Mesh(new BoxGeometry(3.3, 0.02, 0.02), new MeshStandardMaterial({ color: new Color(0.7, 0.5, 0.18), metalness: 0.6, roughness: 0.35 }));
    trim.position.set(0, top - 0.23, WALL_Z + 0.2);
    this.root.add(trim);

    // paper lanterns on a string in front of the stage
    const glow = glowTexture();
    const string = new BufferGeometry();
    const pts: number[] = [];
    const ly = top + 0.38;
    for (let i = 0; i <= 24; i++) {
      const x = -1.7 + (3.4 * i) / 24;
      const sag = 0.14 * (1 - Math.pow(x / 1.7, 2));
      pts.push(x, ly - sag, WALL_Z + 0.2);
    }
    string.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.root.add(new Line(string, new LineBasicMaterial({ color: 0x2a1a0e })));
    const colors = [new Color(1.0, 0.45, 0.12), new Color(1.0, 0.65, 0.2), new Color(0.95, 0.3, 0.18), new Color(1.0, 0.7, 0.3), new Color(1.0, 0.5, 0.15)];
    for (let i = 0; i < 5; i++) {
      const x = -1.3 + i * 0.65;
      const sag = 0.14 * (1 - Math.pow(x / 1.7, 2));
      const body = new Mesh(new SphereGeometry(0.05, 14, 10), new MeshBasicMaterial({ color: colors[i].clone().multiplyScalar(0.85), toneMapped: false }));
      body.scale.y = 1.25;
      body.position.set(x, ly - sag - 0.08, WALL_Z + 0.2);
      const cord = new Mesh(new CylinderGeometry(0.0025, 0.0025, 0.06, 4), new MeshBasicMaterial({ color: 0x140c06 }));
      cord.position.set(x, ly - sag - 0.03, WALL_Z + 0.2);
      const halo = new Sprite(new SpriteMaterial({ map: glow, color: colors[i], blending: AdditiveBlending, transparent: true, depthWrite: false }));
      halo.scale.set(0.38, 0.38, 1);
      halo.position.copy(body.position);
      this.root.add(body, cord, halo);
      this.lanterns.push({ m: body, s: halo, phase: rnd() * 6 });
    }
    const lanternLight = new PointLight(new Color(1.0, 0.6, 0.3), 0.45, 3.5, 1.6);
    lanternLight.position.set(0, ly - 0.2, WALL_Z + 0.2);
    this.root.add(lanternLight);

    // fireflies drifting all around the player
    const F = 90;
    const fp = new Float32Array(F * 3);
    const ph = new Float32Array(F);
    for (let i = 0; i < F; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.6 + rnd() * 7;
      fp[i * 3] = Math.sin(a) * r;
      fp[i * 3 + 1] = FLOOR_Y + 0.3 + rnd() * 2.6;
      fp[i * 3 + 2] = Math.cos(a) * r;
      ph[i] = rnd();
    }
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(fp, 3));
    fg.setAttribute('aPhase', new BufferAttribute(ph, 1));
    const flyMat = new ShaderMaterial({
      vertexShader: flyVert,
      fragmentShader: flyFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.timed.push(flyMat);
    const flies = new Points(fg, flyMat);
    flies.frustumCulled = false;
    this.root.add(flies);
  }

  update(time: number) {
    for (const m of this.timed) m.uniforms.uTime.value = time;
    for (const l of this.lanterns) {
      const sway = Math.sin(time * 0.8 + l.phase) * 0.012;
      l.m.rotation.z = sway * 4;
      const f = 0.9 + 0.1 * Math.sin(time * 7 + l.phase * 3) * Math.sin(time * 3.1 + l.phase);
      l.s.material.opacity = f;
    }
  }
}
