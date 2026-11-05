const { chromium } = require('playwright');
(async () => {
  const [url, outDir, ...times] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  await p.goto(url);
  const t0 = Date.now();
  for (const t of times.map(Number)) {
    await p.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0)));
    const st = await p.evaluate(() => window.__shadowfolk?.state());
    const f = `${outDir}/flow-${t}.png`;
    await p.screenshot({ path: f });
    console.log(t, JSON.stringify(st), f);
  }
  console.log(errs.slice(0, 15).join('\n'));
  await b.close();
})();
