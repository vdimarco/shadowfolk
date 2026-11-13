// Drives the whole game with synthetic hand poses. Exit 1 on failure.
const { chromium } = require('playwright');
(async () => {
  const [url, outDir] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => !!window.__shadowfolk, null, { timeout: 30000 });
  const st = () => p.evaluate(() => window.__shadowfolk.state());
  const waitState = async (pred, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const s = await st(); if (pred(s)) return s; await p.waitForTimeout(150); }
    throw new Error('timeout; last ' + JSON.stringify(await st()));
  };
  let fail = false;
  try {
    await p.evaluate(() => window.__shadowfolk.reset());
    // intro: a hand in the light should move us on by itself
    await p.evaluate(() => window.__shadowfolk.setPoses([{ hand: 'right', pos: [0.08, -0.24, -0.42] }]));
    await waitState((s) => s.state === 'level', 60000);
    console.log('intro -> level ok');
    for (let i = 0; i < 20; i++) {
      // chapter three puzzles: the physics has its own tests; step past them here
      while ((await st()).state === 'puzzle') {
        const ps = await st();
        console.log(`${ps.level}: opened, skipping`);
        await p.evaluate(() => window.__shadowfolk.press('next'));
        await p.waitForTimeout(500);
      }
      // chapter four: fight the Ink Wolf with spells; block with the starfish when its eyes glow
      if ((await st()).state === 'battle') {
        const t0 = Date.now();
        let k = 0, shots = 0;
        while ((await st()).state === 'battle' && Date.now() - t0 < 300000) {
          const bs = (await st()).battle;
          if (!bs || bs.state !== 'fight') { await p.waitForTimeout(500); continue; }
          const id = bs.windup > 0 && !bs.warded ? 'moth' : k++ % 2 ? 'dog' : 'crocodile';
          const n0 = (await p.evaluate(() => window.__shadowfolk.battleLog())).filter((e) => e.type === 'whoosh').length;
          await p.evaluate((id) => window.__shadowfolk.setPoses(window.__shadowfolk.posesFor(id)), id);
          const tc = Date.now();
          while (Date.now() - tc < 8000) {
            const n = (await p.evaluate(() => window.__shadowfolk.battleLog())).filter((e) => e.type === 'whoosh').length;
            if (n > n0) { shots++; break; }
            await p.waitForTimeout(100);
          }
          if (shots === 3) await p.screenshot({ path: `${outDir}/battle.png` });
          await p.evaluate(() => window.__shadowfolk.setPoses(null));
          await p.waitForTimeout(400);
        }
        const after = await st();
        if (after.state === 'battle') throw new Error('battle did not end: ' + JSON.stringify(after.battle));
        console.log(`battle: won with ${shots} spells -> ${after.state}/${after.level}`);
        continue;
      }
      if ((await st()).level.startsWith('daily-')) break;
      const s0 = await st();
      if (s0.level === 'bird') {
        // Gentle mode: one hand is enough for a two-hand shape
        await p.evaluate(() => {
          const sf = window.__shadowfolk;
          sf.press('gentle');
          sf.setPoses([sf.targetPoses(0.03, 0.02)[0]]);
        });
        const sw = await waitState((s) => s.state === 'wake', 60000);
        console.log(`bird: woke with one hand in Gentle mode (score ${sw.score.toFixed(2)})`);
        await p.evaluate(() => window.__shadowfolk.press('gentle'));
      }
      // move the target pose a little to prove the matcher ignores position
      await p.evaluate(() => window.__shadowfolk.setPoses(window.__shadowfolk.targetPoses(0.03, 0.02)));
      const s1 = await waitState((s) => s.state === 'wake', 60000);
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${outDir}/wake-${s0.level}.png` });
      await p.evaluate(() => window.__shadowfolk.setPoses(null));
      const s2 = await waitState((s) => s.state !== 'wake', 90000);
      console.log(`${s0.level}: woke (score ${s1.score.toFixed(2)}) -> ${s2.state}/${s2.level}`);
    }
    const end = await st();
    console.log('end', JSON.stringify(end));
    if (end.found.length !== 6) throw new Error('expected 6 found');
    if (end.state !== 'level' || !end.level.startsWith('daily-')) throw new Error('expected daily level after story');
    await p.evaluate(() => window.__shadowfolk.setPoses(null));
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${outDir}/daily.png` });
    // finish the daily shadow, then free play: the bird shape should wake the bird
    await p.evaluate(() => window.__shadowfolk.setPoses(window.__shadowfolk.targetPoses(0.02, 0)));
    await waitState((s) => s.state === 'wake', 60000);
    await p.evaluate(() => window.__shadowfolk.setPoses(null));
    await waitState((s) => s.state === 'finale', 90000);
    await p.evaluate(() => window.__shadowfolk.press('next'));
    await waitState((s) => s.state === 'free', 10000);
    await p.evaluate(() => {
      const sf = window.__shadowfolk;
      sf.setPoses(sf.posesFor('bird').map((h) => ({ ...h, pos: [h.pos[0] - 0.05, h.pos[1] + 0.03, h.pos[2]] })));
    });
    const fw = await waitState((s) => s.state === 'wake', 60000);
    if (fw.level !== 'bird') throw new Error('free play woke ' + fw.level + ', expected bird');
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${outDir}/free-wake.png` });
    await p.evaluate(() => window.__shadowfolk.setPoses(null));
    await waitState((s) => s.state === 'free', 90000);
    await p.screenshot({ path: `${outDir}/free.png` });
    console.log('free play: bird woke, back in free play');
    await p.evaluate(() => window.__shadowfolk.press('book'));
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${outDir}/book.png` });
    // reload: progress must survive
    await p.reload();
    await p.waitForFunction(() => !!window.__shadowfolk, null, { timeout: 30000 });
    const after = await st();
    console.log('after reload', JSON.stringify(after));
    if (after.found.length !== 7) throw new Error('progress lost on reload');
  } catch (e) { console.log('FAIL', e.message); fail = true; }
  if (errs.length) console.log('errors:\n' + errs.slice(0, 10).join('\n'));
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
