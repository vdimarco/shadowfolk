/**
 * Stage scenes in the real game and save store images: gameplay screenshots
 * (2560x1440, in-game content only) and clean backgrounds for the covers.
 *
 * Run: npx tsx tools/store-art.ts <url> <outDir> [only]
 * Then: npx tsx tools/store-covers.ts <outDir>
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { HandPose } from '../src/game/hand-model.js';
import { LEVELS } from '../src/game/levels.js';
import { fliesPose, rainPose } from './puzzle-moves.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir, only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ids = LEVELS.map((l) => l.id);
const level = (id: string) => LEVELS.find((l) => l.id === id)!;
const shift = (hs: HandPose[], d: [number, number, number]) => hs.map((h) => ({ ...h, pos: [h.pos[0] + d[0], h.pos[1] + d[1], h.pos[2] + d[2]] as [number, number, number] }));

type Progress = { level: number; found: string[]; puzzle: number; battle: boolean };
async function open(p: Progress) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
  await page.addInitScript((prog: Progress) => {
    let now = 0;
    const start = Date.now();
    const cbs = new Map<number, FrameRequestCallback>();
    let id = 0;
    performance.now = () => now;
    Date.now = () => start + now;
    window.requestAnimationFrame = (cb) => (cbs.set(++id, cb), id);
    window.cancelAnimationFrame = (i) => void cbs.delete(i);
    (window as any).__advance = (ms: number) => {
      now += ms;
      const l = [...cbs.values()];
      cbs.clear();
      for (const cb of l) cb(now);
    };
    localStorage.setItem('shadowfolk.v1', JSON.stringify({ gentle: false, dailyDay: -1, streak: 0, ...prog }));
  }, p);
  await page.goto(url + '?capture=1');
  for (let i = 0; i < 600 && !(await page.evaluate(() => !!(window as any).__shadowfolk)); i++) {
    await page.evaluate(() => (window as any).__advance(16));
    await page.waitForTimeout(20);
  }
  await adv(page, 5);
  return page;
}
async function adv(page: any, frames: number, poses?: (t: number) => HandPose[] | null, t0 = 0) {
  for (let i = 0; i < frames; i++) {
    const p = poses ? poses(t0 + i / 30) : undefined;
    await page.evaluate(
      ({ p, set }: { p: HandPose[] | null; set: boolean }) => {
        const sf = (window as any).__shadowfolk;
        if (set) sf.setPoses(p);
        (window as any).__advance(33.3);
      },
      { p: p ?? null, set: !!poses },
    );
  }
}
const state = (page: any) => page.evaluate(() => (window as any).__shadowfolk.state());
async function until(page: any, pred: (s: any) => boolean, max = 600, poses?: (t: number) => HandPose[] | null) {
  for (let i = 0; i < max; i++) {
    await adv(page, 1, poses, i / 30);
    if (pred(await state(page))) return true;
  }
  return false;
}
async function shot(page: any, name: string, w = 2560, h = 1440) {
  if (process.env.SMALL) { await page.screenshot({ path: `${outDir}/${name}-small.png` }); }
  await page.setViewportSize({ width: w, height: h });
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(1500);
    await adv(page, 3);
    await page.waitForTimeout(1500);
    await adv(page, 1);
    const buf: Buffer = await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
    // a black frame means the canvas was caught between resize and draw: try again
    if (buf.length > 200000) break;
    console.log('blank frame, retrying', name);
  }
  await page.setViewportSize({ width: 960, height: 540 });
  console.log('saved', name);
}
const want = (n: string) => !only || only.split(',').includes(n);

// 1. a creature wakes: the owl, eye open, the player's hands still up
if (want('wake')) {
  const page = await open({ level: 8, found: ids.slice(0, 8), puzzle: 0, battle: false });
  await page.evaluate(() => (window as any).__shadowfolk.press('next'));
  await adv(page, 10);
  const owl = shift(level('owl').hands, [0.0, 0.02, 0]);
  await until(page, (s) => s.state === 'wake', 300, () => owl);
  await adv(page, 30, () => owl);
  await shot(page, 'shot-1-wake');
  await page.close();
}

// 2. magic: the dog shape held at its comfortable angle, almost there, glowing
if (want('magic')) {
  const page = await open({ level: 0, found: [], puzzle: 0, battle: false });
  await page.evaluate(() => (window as any).__shadowfolk.press('next'));
  // an open hand, fingers not yet spread: close to the starfish, glowing, not awake yet
  const near: HandPose[] = [{ hand: 'right', pos: [0.02, -0.25, -0.42], rot: [0, 0, 12], thumb: { out: 0.5, opp: 0 }, index: { curl: 0.48, splay: 3 }, middle: { curl: 0.48 }, ring: { curl: 0.48, splay: -3 }, pinky: { curl: 0.48, splay: -6 } }];
  await adv(page, 40, () => near);
  const st = await state(page);
  console.log('magic scene', st.state, st.score.toFixed(2));
  await shot(page, 'shot-2-magic');
  await page.close();
}

// 3. the rain puzzle: the hand and arm shadow is a slide
if (want('rain')) {
  const page = await open({ level: 10, found: ids, puzzle: 0, battle: false });
  await page.evaluate(() => (window as any).__shadowfolk.press('next'));
  await adv(page, 30 * 7, (t) => rainPose(t));
  await shot(page, 'shot-3-rain');
  await page.close();
}

// 4. the fireflies puzzle
if (want('flies')) {
  const page = await open({ level: 10, found: ids, puzzle: 1, battle: false });
  await page.evaluate(() => (window as any).__shadowfolk.press('next'));
  await adv(page, 30 * 4.5, (t) => fliesPose(t));
  await shot(page, 'shot-4-fireflies');
  await page.close();
}

// 5. the Ink Wolf: a dog spell lands, and a second shape is ready
if (want('battle')) {
  const page = await open({ level: 10, found: ids, puzzle: 2, battle: false });
  await page.evaluate(() => (window as any).__shadowfolk.press('next'));
  await adv(page, 20);
  const bird = shift(level('bird').hands, [-0.05, 0.02, 0]);
  const dog = shift(level('dog').hands, [-0.06, 0.02, 0]);
  // a bird first, then the dog; save frames around the dog's hit
  await until(page, () => false, 50, () => bird);
  await adv(page, 12, () => null);
  const n0 = (await page.evaluate(() => (window as any).__shadowfolk.battleLog())).length;
  for (let i = 0; i < 90; i++) {
    await adv(page, 1, () => dog);
    const log = await page.evaluate(() => (window as any).__shadowfolk.battleLog());
    if (log.slice(n0).some((e: any) => e.type === 'thump')) break;
  }
  await adv(page, 2, () => dog);
  await shot(page, 'shot-5-battle');
  // the wolf's eyes burn red before a bite
  await until(page, (s) => !!s.battle && s.battle.windup > 0.55, 400, () => dog);
  await shot(page, 'shot-6-battle-eyes');
  await page.close();
}

// covers: the title inked on the paper (no other text), the hands making the bird, the Ink Wolf facing it
if (want('cover')) {
  const sizes: [string, number, number, { pos: [number, number, number]; pitch: number; fov: number }][] = [
    ['cover-landscape', 2560, 1440, { pos: [0, 1.2, 0.6], pitch: 0, fov: 50 }],
    ['cover-hero', 3000, 900, { pos: [0, 1.2, 1.1], pitch: 0, fov: 34 }],
    ['cover-square', 1440, 1440, { pos: [0, 1.2, 0.36], pitch: 0, fov: 62 }],
    ['cover-portrait', 1008, 1440, { pos: [0, 1.2, 0.51], pitch: 0, fov: 70 }],
    ['cover-mini', 1080, 360, { pos: [0, 1.2, 1.13], pitch: 0, fov: 30 }],
  ];
  const page = await open({ level: 10, found: ids, puzzle: 2, battle: false });
  await page.evaluate(() => (window as any).__shadowfolk.press('next'));
  await adv(page, 20);
  const bird = shift(level('bird').hands, [-0.15, 0.0, -0.03]);
  // hold a shape that is not a spell yet (the hands rise), then the bird
  await adv(page, 40, () => bird);
  await page.evaluate(() => (window as any).__shadowfolk.art(true, undefined, 'Shadowfolk', 150));
  await adv(page, 4, () => bird);
  for (const [name, w, h, cam] of sizes) {
    await page.evaluate((c: any) => (window as any).__shadowfolk.art(true, c, 'Shadowfolk', 150), cam);
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    await adv(page, 3, () => bird);
    await page.waitForTimeout(800);
    await adv(page, 1, () => bird);
    await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
    console.log('saved', name);
  }
  await page.close();
}

await browser.close();
