/**
 * The world around the shadow theater, in a papercut storybook style: a
 * violet night sky with an aurora and a haloed moon, rings of cut-paper hills
 * and trees with glowing gold edges, a carved papercut arch around the screen,
 * paper lanterns, and drifting motes of light.
 * Everything is procedural: a few draw calls, no image files, motion in shaders.
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
  CylinderGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
} from '@iwsdk/core';
import { WALL_CY, WALL_H, WALL_W, WALL_Z } from './silhouette.js';

const FLOOR_Y = -1.2;
const STAGE_TOP = -0.98;

let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}`;

// ------------------------------------------------------------------ sky

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const skyFrag = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // violet dusk at the horizon, deep indigo above
  vec3 horizon = vec3(0.30, 0.13, 0.36);
  vec3 mid = vec3(0.07, 0.05, 0.20);
  vec3 zenith = vec3(0.01, 0.012, 0.05);
  vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, up));
  col = mix(col, zenith, smoothstep(0.22, 0.75, up));
  // aurora: slow ribbons of teal and rose
  // (only in its band of sky, to keep the full-screen sky cheap on the headset)
  if (up > 0.05 && up < 0.7) {
    vec2 a = vec2(atan(d.z, d.x) * 1.6, up * 4.0);
    float flow = fbm(vec2(a.x * 1.3 + uTime * 0.025, a.y * 0.6 - uTime * 0.04));
    float ribbon = exp(-pow((up - 0.32 - 0.12 * sin(a.x * 1.7 + flow * 3.0)) * 7.0, 2.0));
    if (ribbon > 0.01) {
      float curtain = smoothstep(0.35, 0.8, fbm(vec2(a.x * 5.0 + uTime * 0.05, up * 2.0)));
      vec3 aur = mix(vec3(0.15, 0.85, 0.7), vec3(0.85, 0.35, 0.8), smoothstep(0.2, 0.55, up + flow * 0.2));
      col += aur * ribbon * curtain * 0.32 * smoothstep(0.05, 0.25, up);
    }
  }
  // stars, a few bright, twinkling
  vec2 uv = vec2(atan(d.z, d.x), asin(clamp(up, -1.0, 1.0)));
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 90.0 : 220.0;
    vec2 g = uv * vec2(sc, sc * 0.5);
    vec2 cell = floor(g);
    float h = hash(cell + float(k) * 17.0);
    if (h > 0.982 && up > 0.04) {
      vec2 c = vec2(hash(cell + 3.1), hash(cell + 7.7));
      float dist = length(fract(g) - c);
      float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 80.0);
      float b = (h - 0.982) / 0.018;
      vec3 sc2 = mix(vec3(1.0, 0.92, 0.75), vec3(0.75, 0.9, 1.0), hash(cell + 1.0));
      col += sc2 * smoothstep(0.14, 0.0, dist) * b * tw * (k == 0 ? 1.6 : 0.8);
      // the brightest stars get a little cross of light
      if (k == 0 && h > 0.996) {
        vec2 q = fract(g) - c;
        col += sc2 * (exp(-abs(q.x) * 60.0) * exp(-abs(q.y) * 9.0) + exp(-abs(q.y) * 60.0) * exp(-abs(q.x) * 9.0)) * 0.5 * tw;
      }
    }
  }
  // a big full moon with papercut halo rings
  vec3 m = normalize(vec3(-0.42, 0.36, -0.83));
  float md = acos(clamp(dot(d, m), -1.0, 1.0));
  if (md < 0.08) {
    float disc = smoothstep(0.075, 0.07, md);
    float craters = fbm(vec2(d.x, d.y) * 40.0);
    col = mix(col, vec3(1.0, 0.93, 0.78) * (0.92 + 0.12 * craters), disc);
  }
  float rings = 0.0;
  for (int i = 1; i <= 3; i++) {
    float r = 0.075 + float(i) * 0.05;
    rings += smoothstep(0.004, 0.0, abs(md - r)) * (0.5 / float(i));
  }
  col += vec3(1.0, 0.85, 0.55) * rings * 0.35;
  col += vec3(0.55, 0.45, 0.75) * exp(-md * md * 28.0) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------- papercut hills

/** A cylinder of cut paper seen from inside: hills and trees, with a glowing gold edge. */
const hillVert = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const hillFrag = /* glsl */ `
precision highp float;
uniform float uSeed;
uniform float uHeight;
uniform float uTrees;
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uTime;
varying vec3 vP;
${NOISE}
void main() {
  float ang = atan(vP.x, vP.z);
  float t = ang * 6.0 + uSeed * 10.0;
  // rolling hills
  float h = uHeight * (0.55 + 0.25 * sin(t * 0.5) + 0.15 * sin(t * 1.3 + 1.7) + 0.08 * sin(t * 3.1));
  // stylized trees: rounded tips in clumps
  float cell = floor(t * uTrees);
  float f = fract(t * uTrees) - 0.5;
  float has = step(0.45, hash(vec2(cell, uSeed)));
  float th = uHeight * (0.35 + 0.45 * hash(vec2(cell, uSeed + 4.0))) * has;
  float tree = th * max(0.0, 1.0 - pow(abs(f) * 2.2, 1.6));
  float top = h + tree;
  float y = vP.y;
  if (y > top) discard;
  // the paper: a soft fibre texture and a shade that deepens downward
  float fib = noise(vec2(ang * 300.0, y * 40.0)) * 0.05;
  vec3 col = uColor * (0.85 + 0.25 * smoothstep(top - 1.5, top, y)) - fib * 0.3;
  // the gold edge where the paper was cut, catching the moonlight
  float edge = smoothstep(0.09, 0.0, top - y);
  float shimmer = 0.75 + 0.25 * sin(uTime * 1.3 + ang * 40.0 + uSeed);
  col = mix(col, uRim, edge * 0.85 * shimmer);
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------ ground

const groundVert = /* glsl */ `
varying vec3 vP;
void main() {
  vP = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;
const groundFrag = /* glsl */ `
precision highp float;
uniform float uFloor;
varying vec3 vP;
${NOISE}
void main() {
  vec2 p = vP.xz;
  float n = noise(p * 0.8) * 0.35 + noise(p * 1.7) * 0.15 + noise(p * 14.0) * 0.12;
  vec3 col = mix(vec3(0.03, 0.02, 0.07), vec3(0.07, 0.04, 0.12), n);
  // warm light pooled under the stage
  float warm = exp(-dot(p - vec2(0.0, -1.1), p - vec2(0.0, -1.1)) * 0.45);
  col += vec3(0.35, 0.18, 0.06) * warm * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------- papercut arch

/**
 * The stage arch: a sheet of cut paper with a window for the screen, an
 * arched top, scalloped outer edge, little cut-out stars, and a gold rim.
 * uLayer 0 is the front sheet, 1 the lighter sheet just behind it.
 */
const archVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const archFrag = /* glsl */ `
precision highp float;
uniform vec2 uHalf;      // half width and height of the sheet
uniform vec2 uWin;       // half width of the window, height of its straight sides
uniform float uArch;     // height of the arched top above the sides
uniform float uInset;    // the back sheet's window is a little smaller
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uTime;
varying vec2 vUv;
${NOISE}
float sdWindow(vec2 p, float grow) {
  float w = uWin.x - grow;
  float x = clamp(p.x / w, -1.0, 1.0);
  float topY = uWin.y + uArch * pow(1.0 - x * x, 0.6) - grow;
  float dx = abs(p.x) - w;
  float dyTop = p.y - topY;
  float dyBot = -uHalf.y - 1.0 - p.y; // open at the bottom
  return max(max(dx, dyTop), dyBot);
}
void main() {
  vec2 p = vUv;
  float win = sdWindow(p, uInset);
  if (win < 0.0) discard;
  // scalloped outer edge
  float sc = 0.05 * (0.5 + 0.5 * cos(p.x * 28.0));
  if (p.y > uHalf.y - sc) discard;
  // cut-out stars and moons in the paper
  vec2 g = p * vec2(9.0, 9.0);
  vec2 cell = floor(g);
  float h = hash(cell + uInset * 31.0);
  vec2 q = fract(g) - 0.5;
  float star = 0.0;
  if (h > 0.6 && win > 0.07) {
    float a = atan(q.y, q.x);
    float r = length(q);
    float rs = 0.11 + 0.06 * cos(a * 5.0 + h * 6.0);
    star = step(r, rs * (0.5 + h * 0.5));
    if (star > 0.5) discard;
  }
  float fib = noise(p * vec2(120.0, 30.0)) * 0.05;
  vec3 col = uColor * (0.9 + 0.2 * smoothstep(-uHalf.y, uHalf.y, p.y)) - fib * 0.2;
  // a gold line drawn just outside the window, and a glow on the cut edge
  float line = smoothstep(0.006, 0.0, abs(win - 0.045));
  float rim = smoothstep(0.018, 0.0, win);
  float shimmer = 0.8 + 0.2 * sin(uTime * 2.0 + p.x * 6.0 + p.y * 4.0);
  col = mix(col, uRim, max(line * 0.9, rim) * shimmer);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- motes

const moteVert = /* glsl */ `
uniform float uTime;
attribute float aPhase;
varying float vGlow;
varying float vHue;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.3 + aPhase * 6.0) * 0.35;
  p.y += sin(uTime * 0.45 + aPhase * 9.0) * 0.2 + mod(uTime * 0.04 + aPhase * 3.0, 1.0) * 0.4;
  p.z += cos(uTime * 0.27 + aPhase * 4.0) * 0.35;
  vGlow = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.8 + aPhase) + aPhase * 40.0), 3.0);
  vHue = aPhase;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 80.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const moteFrag = /* glsl */ `
precision highp float;
varying float vGlow;
varying float vHue;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = exp(-d * d * 30.0) + exp(-d * d * 200.0);
  vec3 gold = vec3(1.0, 0.82, 0.4);
  vec3 teal = vec3(0.45, 1.0, 0.85);
  gl_FragColor = vec4(mix(gold, teal, step(0.72, vHue)) * a * vGlow, 1.0);
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

export class NightWorld {
  readonly root = new Group();
  private timed: ShaderMaterial[] = [];
  private lanterns: { m: Mesh; s: Sprite; phase: number }[] = [];

  constructor() {
    this.root.name = 'Night World';
    seed = 3;

    // sky dome
    const skyMat = new ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: { uTime: { value: 0 } }, side: BackSide, depthWrite: false });
    this.timed.push(skyMat);
    const sky = new Mesh(new SphereGeometry(70, 32, 16), skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.root.add(sky);

    // the ground: dark paper, warm under the stage
    const ground = new Mesh(new CircleGeometry(60, 48), new ShaderMaterial({ vertexShader: groundVert, fragmentShader: groundFrag, uniforms: { uFloor: { value: FLOOR_Y } } }));
    ground.rotation.x = -Math.PI / 2;
    // keep the disc's center vertex away from the spot under the viewer: a vertex
    // there has a view depth of exactly zero when the head is level, and some
    // renderers clip those triangles wrong
    ground.position.set(0, FLOOR_Y, -4);
    this.root.add(ground);

    // rings of cut-paper hills: dark and close, then lighter and misty far away
    const layers: [number, number, number, Color, Color][] = [
      [34, 9.0, 0.6, new Color(0.2, 0.12, 0.34), new Color(0.75, 0.6, 0.95)],
      [22, 6.0, 0.9, new Color(0.13, 0.07, 0.25), new Color(0.95, 0.7, 0.55)],
      [13, 3.8, 1.3, new Color(0.07, 0.04, 0.16), new Color(1.0, 0.72, 0.35)],
      [7.5, 2.2, 1.8, new Color(0.035, 0.02, 0.08), new Color(1.0, 0.78, 0.38)],
    ];
    layers.forEach(([r, h, trees, col, rim], i) => {
      const mat = new ShaderMaterial({
        vertexShader: hillVert,
        fragmentShader: hillFrag,
        uniforms: {
          uSeed: { value: i * 1.37 + 0.4 },
          uHeight: { value: h },
          uTrees: { value: trees },
          uColor: { value: col },
          uRim: { value: rim },
          uTime: { value: 0 },
        },
        side: BackSide,
      });
      this.timed.push(mat);
      const geo = new CylinderGeometry(r, r, h * 2.2, 160, 1, true);
      geo.translate(0, h * 1.1, 0);
      const ring = new Mesh(geo, mat);
      ring.position.y = FLOOR_Y - 0.1;
      ring.renderOrder = -9 + i;
      ring.frustumCulled = false;
      this.root.add(ring);
    });

    // the stage: a dark plum deck with a gold edge
    const plum = new MeshStandardMaterial({ color: new Color(0.1, 0.04, 0.1), roughness: 0.85 });
    const gold = new MeshBasicMaterial({ color: new Color(1.0, 0.72, 0.32), toneMapped: false });
    const deck = new Mesh(new BoxGeometry(3.4, STAGE_TOP - FLOOR_Y, 1.2), plum);
    deck.position.set(0, (STAGE_TOP + FLOOR_Y) / 2, WALL_Z - 0.2);
    this.root.add(deck);
    const lip = new Mesh(new BoxGeometry(3.4, 0.012, 0.012), gold);
    lip.position.set(0, STAGE_TOP, WALL_Z + 0.4);
    this.root.add(lip);

    // the papercut arch around the screen: two sheets for depth
    const archW = 2.36, archH = 2.2;
    const cy = WALL_CY + 0.12;
    const sheets: [number, number, Color, Color][] = [
      [WALL_Z + 0.14, 0.06, new Color(0.22, 0.09, 0.3), new Color(0.6, 0.9, 1.0)],
      [WALL_Z + 0.2, 0.0, new Color(0.11, 0.035, 0.14), new Color(1.0, 0.76, 0.36)],
    ];
    for (const [z, inset, col, rim] of sheets) {
      const mat = new ShaderMaterial({
        vertexShader: archVert,
        fragmentShader: archFrag,
        uniforms: {
          uHalf: { value: new Vector2(archW / 2, archH / 2) },
          uWin: { value: new Vector2(WALL_W / 2 + 0.16, WALL_H / 2 + 0.04 - (cy - WALL_CY)) },
          uArch: { value: 0.32 },
          uInset: { value: inset },
          uColor: { value: col },
          uRim: { value: rim },
          uTime: { value: 0 },
        },
        side: DoubleSide,
      });
      this.timed.push(mat);
      const sheet = new Mesh(new PlaneGeometry(archW, archH, 1, 1), mat);
      sheet.position.set(0, cy, z);
      this.root.add(sheet);
    }

    // paper lanterns on a string, in front of the arch
    const glow = glowTexture();
    const string = new BufferGeometry();
    const pts: number[] = [];
    const ly = cy + archH / 2 + 0.05;
    const lz = WALL_Z + 0.34;
    for (let i = 0; i <= 24; i++) {
      const x = -1.7 + (3.4 * i) / 24;
      const sag = 0.22 * (1 - Math.pow(x / 1.7, 2));
      pts.push(x, ly - sag, lz);
    }
    string.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.root.add(new Line(string, new LineBasicMaterial({ color: 0x2a1a0e })));
    const colors = [new Color(1.0, 0.45, 0.6), new Color(1.0, 0.7, 0.3), new Color(0.45, 0.95, 0.85), new Color(1.0, 0.72, 0.3), new Color(0.95, 0.45, 0.75)];
    for (let i = 0; i < 5; i++) {
      const x = -1.3 + i * 0.65;
      const sag = 0.22 * (1 - Math.pow(x / 1.7, 2));
      const body = new Mesh(new SphereGeometry(0.05, 14, 10), new MeshBasicMaterial({ color: colors[i].clone().multiplyScalar(0.9), toneMapped: false }));
      body.scale.y = 1.25;
      body.position.set(x, ly - sag - 0.08, lz);
      const cord = new Mesh(new CylinderGeometry(0.0025, 0.0025, 0.06, 4), new MeshBasicMaterial({ color: 0x140c06 }));
      cord.position.set(x, ly - sag - 0.03, lz);
      const halo = new Sprite(new SpriteMaterial({ map: glow, color: colors[i], blending: AdditiveBlending, transparent: true, depthWrite: false }));
      halo.scale.set(0.42, 0.42, 1);
      halo.position.copy(body.position);
      this.root.add(body, cord, halo);
      this.lanterns.push({ m: body, s: halo, phase: rnd() * 6 });
    }
    const lanternLight = new PointLight(new Color(1.0, 0.6, 0.45), 0.5, 3.5, 1.6);
    lanternLight.position.set(0, ly - 0.2, lz);
    this.root.add(lanternLight);

    // motes of light drifting up all around: gold, and a few teal
    const F = 140;
    const fp = new Float32Array(F * 3);
    const ph = new Float32Array(F);
    for (let i = 0; i < F; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.4 + rnd() * 6;
      fp[i * 3] = Math.sin(a) * r;
      fp[i * 3 + 1] = FLOOR_Y + 0.2 + rnd() * 2.8;
      fp[i * 3 + 2] = Math.cos(a) * r;
      ph[i] = rnd();
    }
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(fp, 3));
    fg.setAttribute('aPhase', new BufferAttribute(ph, 1));
    const moteMat = new ShaderMaterial({ vertexShader: moteVert, fragmentShader: moteFrag, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.timed.push(moteMat);
    const motes = new Points(fg, moteMat);
    motes.frustumCulled = false;
    this.root.add(motes);
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
