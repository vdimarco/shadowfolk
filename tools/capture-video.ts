/**
 * Scripted demo capture. Drives the real game with simulated hand poses,
 * steps a virtual clock one frame at a time, and saves numbered frames plus
 * an event list for the soundtrack.
 *
 * Run: npx tsx tools/capture-video.ts <url> <outDir> [width] [height]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type FingerSpec, type HandPose, poseToJoints } from '../src/game/hand-model.js';
import { dailyLevel, dayNumber } from '../src/game/daily.js';
import { LEVELS } from '../src/game/levels.js';
import { fliesPose, rainPose } from './puzzle-moves.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [url, outDir, W = '1920', H = '1080'] = process.argv.slice(2);
const FPS = 30;
const DT = 1000 / FPS;
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------ pose maths

type V3 = [number, number, number];
interface NPose {
  hand: 'left' | 'right';
  pos: V3;
  rot: V3;
  thumb: [number, number, number]; // out, opp, curl
  f: [number, number, number, number][]; // mcp, pip, dip, splay
}
const SPLAY = [6, 0, -5, -12];
function norm(p: HandPose): NPose {
  const fs = [p.index, p.middle, p.ring, p.pinky].map((s: FingerSpec | undefined, i) => {
    if (s === undefined || typeof s === 'number') {
      const c = s ?? 0;
      return [c * 85, c * 100, c * 65, SPLAY[i]] as [number, number, number, number];
    }
    const c = s.curl ?? 0;
    return [s.mcp ?? c * 85, s.pip ?? c * 100, s.dip ?? c * 65, s.splay ?? SPLAY[i]] as [number, number, number, number];
  });
  return {
    hand: p.hand,
    pos: [...p.pos] as V3,
    rot: [...(p.rot ?? [0, 0, 0])] as V3,
    thumb: [p.thumb?.out ?? 0.5, p.thumb?.opp ?? 0.2, p.thumb?.curl ?? 0],
    f: fs,
  };
}
function denorm(n: NPose): HandPose {
  const [index, middle, ring, pinky] = n.f.map(([mcp, pip, dip, splay]) => ({ mcp, pip, dip, splay }));
  return { hand: n.hand, pos: n.pos, rot: n.rot, thumb: { out: n.thumb[0], opp: n.thumb[1], curl: n.thumb[2] }, index, middle, ring, pinky };
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpPose(a: NPose, b: NPose, t: number): NPose {
  return {
    hand: b.hand,
    pos: a.pos.map((v, i) => mix(v, b.pos[i], t)) as V3,
    rot: a.rot.map((v, i) => mix(v, b.rot[i], t)) as V3,
    thumb: a.thumb.map((v, i) => mix(v, b.thumb[i], t)) as [number, number, number],
    f: a.f.map((fa, i) => fa.map((v, k) => mix(v, b.f[i][k], t)) as [number, number, number, number]),
  };
}
/** Minimum-jerk easing, like a real reach. */
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (10 - 15 * x + 6 * x * x);
};
const shift = (n: NPose, d: V3, r: V3 = [0, 0, 0]): NPose => ({
  ...n,
  pos: [n.pos[0] + d[0], n.pos[1] + d[1], n.pos[2] + d[2]],
  rot: [n.rot[0] + r[0], n.rot[1] + r[1], n.rot[2] + r[2]],
});

const REST: Record<'left' | 'right', NPose> = {
  right: norm({ hand: 'right', pos: [0.3, -0.56, -0.24], rot: [-50, 0, 10], thumb: { out: 0.3, curl: 0.3 }, index: 0.3, middle: 0.35, ring: 0.4, pinky: 0.45 }),
  left: norm({ hand: 'left', pos: [-0.3, -0.56, -0.24], rot: [-50, 0, -10], thumb: { out: 0.3, curl: 0.3 }, index: 0.3, middle: 0.35, ring: 0.4, pinky: 0.45 }),
};

/** A pointing hand, fingers down, with its index tip placed at `tip`. */
function pokePose(tip: V3): NPose {
  const p: HandPose = { hand: 'right', pos: [0, 0, 0], rot: [-160, 180, 0], thumb: { out: 0.1, opp: 0.8, curl: 0.8 }, index: 0, middle: 1, ring: 1, pinky: 1 };
  const j = poseToJoints(p);
  const off: V3 = [j[27] - j[0], j[28] - j[1], j[29] - j[2]];
  return norm({ ...p, pos: [tip[0] - off[0], tip[1] - off[1], tip[2] - off[2]] });
}
// Button layout from theater.ts: tray y -0.56, z -0.34; buttons x -0.16/0/0.16 at z -0.365, top y -0.529.
const BTN = { book: -0.16, gentle: 0, next: 0.16 };

// ------------------------------------------------------------ browser

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: Number(W), height: Number(H) } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.addInitScript(() => {
  let now = 0;
  const start = Date.now();
  const cbs = new Map<number, FrameRequestCallback>();
  let id = 0;
  performance.now = () => now;
  Date.now = () => start + now;
  window.requestAnimationFrame = (cb) => {
    cbs.set(++id, cb);
    return id;
  };
  window.cancelAnimationFrame = (i) => void cbs.delete(i);
  (window as any).__advance = (ms: number) => {
    now += ms;
    const list = [...cbs.values()];
    cbs.clear();
    for (const cb of list) cb(now);
  };
});
const ONLY_POKE = !!process.env.ONLY_POKE;
/** XR=1: record inside IWER, Meta's WebXR emulator, as an emulated Quest 3 in an immersive session. */
const XR = !!process.env.XR;
const ONLY_PUZZLES = !!process.env.ONLY_PUZZLES;
if (ONLY_PUZZLES) {
  // test mode: start right after chapter two and run the puzzle scenes only
  await page.addInitScript((ids: string[]) => {
    localStorage.setItem('shadowfolk.v1', JSON.stringify({ level: ids.length, found: ids, gentle: false, dailyDay: -1, streak: 0, puzzle: 0 }));
  }, LEVELS.map((l) => l.id));
}
if (ONLY_POKE) {
  // test mode: start at the end of the story and run the button section only
  await page.addInitScript(
    ({ d, day, ids }: { d: string; day: number; ids: string[] }) => {
      localStorage.setItem('shadowfolk.v1', JSON.stringify({ level: ids.length, found: [...ids, d], gentle: false, dailyDay: day, streak: 1, puzzle: 2 }));
    },
    { d: dailyLevel(dayNumber()).id, day: dayNumber(), ids: LEVELS.map((l) => l.id) },
  );
}
await page.goto(url + (url.includes('?') ? '&' : '?') + 'capture=1' + (XR ? '&iwer=1' : ''));
for (let i = 0; i < 600 && !(await page.evaluate(() => !!(window as any).__shadowfolk)); i++) {
  await page.evaluate(() => (window as any).__advance(16));
  await page.waitForTimeout(20);
}
await page.evaluate((keep: boolean) => {
  if (!keep) (window as any).__shadowfolk.reset();
  const css = document.createElement('style');
  css.textContent = `
    #sf-band { position: fixed; left: 0; right: 0; bottom: 0; height: 22%; z-index: 2147483645; pointer-events: none;
      background: linear-gradient(to top, rgba(4,3,4,.78), rgba(4,3,4,0)); }
    #sf-cap { position: fixed; left: 0; right: 0; bottom: 6%; text-align: center; z-index: 2147483646;
      font: italic 500 clamp(18px, 2.4vw, 46px) Georgia, serif; color: #f6e4c2;
      text-shadow: 0 2px 12px rgba(0,0,0,.9); pointer-events: none; }
    #sf-card { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column;
      align-items: center; justify-content: center; background: rgba(6,4,6,.93); color: #f6e4c2;
      font-family: Georgia, serif; text-align: center; pointer-events: none; }
    #sf-card h1 { font: italic 600 clamp(48px, 7vw, 140px) Georgia, serif; margin: 0 0 .2em; letter-spacing: .01em; }
    #sf-card p { font-size: clamp(18px, 2vw, 40px); margin: .25em 0; opacity: .9; }
    #sf-card small { position: absolute; bottom: 4%; font-size: clamp(12px, 1.1vw, 22px); opacity: .55; }`;
  document.head.appendChild(css);
  const cap = document.createElement('div');
  cap.id = 'sf-cap';
  const card = document.createElement('div');
  card.id = 'sf-card';
  card.style.opacity = '0';
  const band = document.createElement('div');
  band.id = 'sf-band';
  band.style.opacity = '0';
  document.body.append(band, cap, card);
}, ONLY_POKE || ONLY_PUZZLES);

// ------------------------------------------------------------ timeline

let frame = 0;
const events: { t: number; type: string }[] = [];
let hands: NPose[] = [REST.right];
let caption = '';
let captionAge = 0;
let card = { html: '', alpha: 0 };
let pitch = 0;
let lastState = '';
let lastLabel = '';

async function step() {
  const info = await page.evaluate(
    ({ poses, cap, capA, cardHtml, cardA, pitch, dt }: any) => {
      const sf = (window as any).__shadowfolk;
      sf.setPoses(poses);
      sf.setCameraPitch(pitch);
      const c = document.getElementById('sf-cap')!;
      if (c.textContent !== cap) c.textContent = cap;
      c.style.opacity = String(capA);
      document.getElementById('sf-band')!.style.opacity = String(cap ? Math.max(capA, 0.6) : 0);
      const k = document.getElementById('sf-card')!;
      if (k.innerHTML !== cardHtml) k.innerHTML = cardHtml;
      k.style.opacity = String(cardA);
      (window as any).__advance(dt);
      return sf.state();
    },
    {
      poses: hands.map(denorm),
      cap: caption,
      capA: caption ? Math.min(1, captionAge / 0.4) : 0,
      cardHtml: card.html,
      cardA: card.alpha,
      pitch,
      dt: DT,
    },
  );
  const t = frame / FPS;
  if (info.state !== lastState) {
    if (info.state === 'wake') events.push({ t, type: 'chime' });
    if (info.state === 'book' || lastState === 'book') console.log(`state ${lastState} -> ${info.state} at ${t.toFixed(2)}s`);
    // the intro chimes when it sees the hand, 2.2 s before the first level opens
    if (lastState === 'intro' && info.state === 'level') events.push({ t: t - 2.2, type: 'chime' });
    lastState = info.state;
  }
  if (info.level !== lastLabel) lastLabel = info.level;
  await page.screenshot({ path: `${outDir}/f${String(frame).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
  frame++;
  captionAge += 1 / FPS;
  if (frame % 150 === 0) console.log(`frame ${frame} (${t.toFixed(1)}s) state ${info.state}/${info.level}`);
  return info as { state: string; level: string; score: number };
}

function say(text: string) {
  if (text !== caption) {
    caption = text;
    captionAge = 0;
  }
}

/** Move hands from their current pose to `to` over `sec`, easing. */
async function move(to: NPose[], sec: number, during?: (k: number) => void) {
  const from = hands;
  const n = Math.round(sec * FPS);
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    hands = to.map((b, idx) => lerpPose(from.find((f) => f.hand === b.hand) ?? from[idx] ?? REST[b.hand], b, k));
    during?.(i / n);
    await step();
  }
}
async function hold(sec: number, during?: (k: number) => void) {
  const n = Math.round(sec * FPS);
  for (let i = 1; i <= n; i++) {
    during?.(i / n);
    await step();
  }
}
async function until(pred: (s: { state: string; level: string }) => boolean, maxSec: number) {
  for (let i = 0; i < maxSec * FPS; i++) {
    const s = await step();
    if (pred(s)) return s;
  }
  throw new Error(`timeout waiting; state ${lastState}/${lastLabel}`);
}

const TITLE = `<h1>Shadowfolk</h1><p>A hands-only shadow puppet game for Meta Quest</p>`;

if (XR) {
  // enter the immersive session before recording, without saving frames
  await page.evaluate(() => (window as any).__shadowfolk.enterXR());
  for (let i = 0; i < 120 && !(await page.evaluate(() => (window as any).__shadowfolk.state().xr)); i++) {
    await page.evaluate(() => (window as any).__advance(33.3));
    await page.waitForTimeout(20);
  }
  for (let i = 0; i < 15; i++) await page.evaluate(() => (window as any).__advance(33.3));
  if (!(await page.evaluate(() => (window as any).__shadowfolk.state().xr))) throw new Error('XR session did not start');
  console.log('XR session started in IWER');
}
if (ONLY_POKE || ONLY_PUZZLES) await page.evaluate(() => (window as any).__shadowfolk.press('next'));

try {
  if (ONLY_POKE) throw new Error('skip-story');
  if (!ONLY_PUZZLES) {
  // A. title card over the sleeping paper
  card = { html: TITLE, alpha: 0 };
  await hold(4.2, (k) => (card.alpha = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1));
  card = { html: '', alpha: 0 };

  // B. first contact: a hand rises into the lamplight
  say('Lift a hand into the lamplight.');
  const moth = LEVELS[0].hands.map(norm);
  await move([shift(moth[0], [0.02, -0.02, 0.02], [0, 0, 12])], 2.2);
  say('Your real hands cast the shadows.');
  await hold(0.6);
  await until((s) => s.state === 'level', 8);

  }
  const captions: Record<string, string> = {
    moth: 'Match the golden outline. Hold it, and the shadow wakes.',
    hare: 'Every creature is a classic hand shadow.',
    crocodile: 'Make the shape anywhere on the paper, at any size.',
    dog: 'A soft hum rises as you get close.',
    bird: 'Some shadows need both hands.',
    deer: 'Every target is a real hand pose.',
    turkey: 'Chapter two brings new shapes.',
    bat: 'Turn the bird upside down, and it hangs like a bat.',
    owl: 'When a creature wakes, its eye opens.',
    spider: 'Ten story shadows teach the shapes.',
  };
  const offsets: Record<string, { d: V3; r: V3 }> = {
    moth: { d: [0.03, 0.0, 0.0], r: [0, 0, 0] },
    hare: { d: [-0.02, 0.01, 0.03], r: [0, 0, 0] },
    crocodile: { d: [-0.06, 0.03, 0.04], r: [0, 0, 0] },
    dog: { d: [0.04, 0.0, -0.02], r: [0, 0, 0] },
    bird: { d: [0.01, 0.01, 0.0], r: [0, 0, 0] },
    deer: { d: [0.0, 0.0, 0.0], r: [0, 0, 0] },
  };

  async function playLevel(id: string, poses: HandPose[], text: string, off = { d: [0, 0, 0] as V3, r: [0, 0, 0] as V3 }) {
    say(text);
    const target = poses.map((p) => shift(norm(p), off.d, off.r));
    // a near miss first, so the meter can climb
    const near = target.map((t, i) => shift(t, [0.0, 0.015, 0.0], [10, -8 * (i ? -1 : 1), 14 * (i ? -1 : 1)]));
    await move(near, 1.6);
    await move(target, 1.2);
    await until((s) => s.state === 'wake', 6);
    await hold(0.6);
    const rests = target.map((t) => REST[t.hand]);
    await move(rests, 1.3);
    await until((s) => s.state !== 'wake', 6);
    void id;
  }

  if (!ONLY_PUZZLES) {
    for (const lv of LEVELS) {
      await playLevel(lv.id, lv.hands, captions[lv.id], offsets[lv.id]);
    }
  }

  // C2. chapter three: shadow puzzles, solved by the scripted moves in tools/puzzle-moves.ts
  async function follow(fn: (t: number) => HandPose[], done: (s: { state: string; level: string }) => boolean, maxSec: number) {
    await move(fn(0).map(norm), 0.6);
    const t0 = frame / FPS;
    for (let i = 0; i < maxSec * FPS; i++) {
      hands = fn(frame / FPS - t0).map(norm);
      const s = await step();
      if (done(s)) return s;
    }
    return null;
  }
  await until((s) => s.state === 'puzzle', 6);
  say('Chapter three: your shadow is solid. Guide the rain into the cup.');
  const rainEnd = await follow(rainPose, (s) => s.level !== 'puzzle-rain' || (s as any).puzzleDone, 40);
  console.log('rain', JSON.stringify(rainEnd));
  await move([REST.right], 1.0);
  await until((s) => s.level === 'puzzle-fireflies', 8);
  say('Fireflies flee from shadow. Herd them into the jar.');
  const fliesEnd = await follow(fliesPose, (s) => s.level !== 'puzzle-fireflies' || (s as any).puzzleDone, 50);
  console.log('fireflies', JSON.stringify(fliesEnd));
  await move([REST.right], 1.0);
  await until((s) => s.state === 'level', 8);
  if (ONLY_PUZZLES) throw new Error('skip-story');

  // C. daily shadow
  const daily = dailyLevel(dayNumber());
  await playLevel(daily.id, daily.hands, 'Then a new shadow wakes every day. Keep your streak.');

} catch (e) {
  if ((e as Error).message !== 'skip-story') {
    console.log('FAIL', (e as Error).message);
    errors.push((e as Error).message);
  }
}

try {
  if (ONLY_PUZZLES) throw new Error('puzzles only');
  // D. poke buttons on the tray: Book, then Gentle
  say('Every button is a fingertip poke. No controllers.');
  await move([REST.right], 0.3, (k) => (pitch = -38 * ease(k)));
  const above = (x: number): V3 => [x, -0.47, -0.365];
  const press = (x: number): V3 => [x, -0.533, -0.365];
  // turn into a pointing hand beside the tray, then travel high above the buttons
  await move([pokePose([0.3, -0.36, -0.3])], 0.9);
  await move([pokePose([BTN.book, -0.4, -0.365])], 0.7);
  await move([pokePose(above(BTN.book))], 0.35);
  await move([pokePose(press(BTN.book))], 0.35);
  events.push({ t: frame / FPS, type: 'tap' });
  await move([pokePose(above(BTN.book))], 0.35);
  await move([pokePose([BTN.gentle, -0.44, -0.365])], 0.5);
  await move([pokePose(above(BTN.gentle))], 0.2);
  say('Gentle mode: easier matching and high-contrast paper.');
  await move([pokePose(press(BTN.gentle))], 0.35);
  events.push({ t: frame / FPS, type: 'tap' });
  await move([pokePose(above(BTN.gentle))], 0.35);
  await move([pokePose([0.3, -0.36, -0.3])], 0.5);
  await move([REST.right], 0.8, (k) => (pitch = -38 * (1 - ease(k))));
  say('The Shadow Book keeps every creature you wake.');
  await hold(3.0);
  // turn gentle mode back off without showing it, close the book, open free play
  await page.evaluate(() => {
    const sf = (window as any).__shadowfolk;
    sf.press('gentle');
    sf.press('book');
    sf.press('next');
  });

  // F. free play: any shadow from the book wakes its creature
  say('Free play: make any shadow you know, anywhere.');
  const dog = LEVELS.find((l) => l.id === 'dog')!.hands.map(norm);
  await move([shift(dog[0], [0.1, 0.05, 0.03], [0, 0, 25])], 1.6);
  await move([shift(dog[0], [0.1, 0.05, 0.03])], 1.0);
  await until((s) => s.state === 'wake', 6);
  await hold(0.6);
  await move([REST.right], 1.3);
  await until((s) => s.state === 'free', 6);

  // E. end card
  say('');
  card = {
    html: `<h1>Shadowfolk</h1><p>Seated. Hands only. A new shadow every day.</p><p style="margin-top:1.2em">Play in the Meta Quest Browser:<br><b>shadowfolk.vercel.app</b></p><small>${XR ? 'Recorded in IWER, the WebXR emulator in Meta’s Immersive Web SDK, as an emulated Meta Quest 3 with scripted hand poses.' : 'Captured in a desktop browser with simulated hand poses.'}</small>`,
    alpha: 0,
  };
  await hold(5.5, (k) => (card.alpha = Math.min(1, k / 0.15)));
} catch (e) {
  if ((e as Error).message !== 'puzzles only') {
    console.log('FAIL', (e as Error).message);
    errors.push((e as Error).message);
  }
}

writeFileSync(`${outDir}/events.json`, JSON.stringify({ fps: FPS, frames: frame, events }, null, 1));
console.log(`done: ${frame} frames (${(frame / FPS).toFixed(1)}s), ${events.length} events`);
if (errors.length) console.log('errors:', errors.slice(0, 5));
await browser.close();
process.exit(errors.length ? 1 : 0);
