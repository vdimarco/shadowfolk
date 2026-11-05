const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2]; const out = process.argv[3]; const wait = Number(process.argv[4] ?? 4000);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const logs = [];
  p.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await p.goto(url);
  await p.waitForTimeout(wait);
  const st = await p.evaluate(() => window.__shadowfolk?.state());
  await p.screenshot({ path: out });
  console.log(JSON.stringify(st));
  console.log(logs.filter(l => !l.startsWith('debug')).slice(0, 25).join('\n'));
  await b.close();
})();
